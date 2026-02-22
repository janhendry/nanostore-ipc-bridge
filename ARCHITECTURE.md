# Architecture

This document describes the architecture of the **Zero-Config NanoStore IPC Bridge**.

The design goal is extremely simple developer experience:

- Define a store once using `syncedAtom(id, initial)`
- Import the same module in **Main** and **Renderer**
- All Electron windows stay synchronized automatically

No manual per-store IPC mapping, no duplicated configuration, no per-window store wiring.

---

## High-level overview

Electron applications run in multiple isolated contexts:

- **Main process** (Node.js context, app lifecycle, windows, privileged operations)
- **Renderer processes** (one per window, UI)
- **Preload** (bridge between renderer and Electron APIs; used with contextIsolation)

There is **no shared memory** between these processes. Synchronization requires IPC.

This bridge implements a minimal protocol:

- `invoke(ns:get, id)` → snapshot `{ id, rev, value }`
- `invoke(ns:set, id, value)` → sets store value (optional/disableable)
- `event(ns:update, snapshot)` → broadcast updates to all windows

A monotonic revision number (`rev`) guarantees race-safety.

---

## Components

### 1) Main: `initNanoStoreIPC()`

Responsibilities:

- Registers generic IPC handlers (`ns:get`, `ns:set`)
- Tracks all registered stores and their `rev`
- Subscribes to each main NanoStore and broadcasts updates to all windows
- Optionally auto-registers windows (`autoRegisterWindows: true`)
- Pushes current snapshots to newly loaded windows (`did-finish-load`, using `once()` to prevent memory leaks)
- Handles errors via optional error callback
- Validates serialization (optional, development mode)

Internal state:

- `stores: Map<id, StoreEntry<T>>` (generic, type-safe)
- `windows: Set<BrowserWindow>`

Options:

- `channelPrefix?: string` - Prefix for IPC channels (e.g., `'wf'`)
- `enableLogging?: boolean` - Enable console logging (default: `false`)
- `autoRegisterWindows?: boolean` - Auto-register windows (default: `true`)
- `allowRendererSet?: boolean` - Allow renderer writes (default: `true`)
- `onError?: ErrorHandler` - Error callback for IPC failures and validation errors
- `validateSerialization?: boolean` - Runtime check for serializable values (default: `false`, recommended for dev only)

Security lever:

- `allowRendererSet` can disable direct writes from renderer.

Memory management:

- Uses `once()` instead of `on()` for window event listeners to prevent leaks
- Removes destroyed windows from broadcast set immediately
- `destroy()` method fully cleans up IPC handlers, subscriptions, and global references

### 2) Preload: `exposeNanoStoreIPC()`

Responsibilities:

- Exposes a safe API via `contextBridge`:
  - `get(id)`
  - `set(id, value)`
  - `subscribe(id, cb)`
  - `subscribeAll(cb)`
  - `callService(serviceId, method, ...args)`
  - `subscribeServiceEvent(serviceId, eventName, cb)`
- **Security**: Validates all IPC inputs at the preload boundary
  - ID validation (type, length, format)
  - Value validation (serializability, prototype pollution protection)
  - Callback type checking
  - Prevents dangerous object structures

The API is exposed under `window.nanostoreIPC` by default (configurable).

**Security features:**

- Rejects non-string IDs or IDs exceeding 256 characters
- Validates values are structured-clone-serializable
- Prevents prototype pollution via `__proto__`, `constructor`, or `prototype` manipulation
- Rejects class instances (except Date, RegExp, Error)
- Validates callbacks are functions

### 3) Universal: `syncedAtom(id, initial, options?)`

Responsibilities:

- Single call-site across processes
- **Main**:
  - Creates a real `atom(initial)`
  - Registers it with the main IPC runtime
  - If `initNanoStoreIPC()` was not yet called, the store is queued and registered later
- **Renderer**:
  - Creates a local `atom(initial)` as a proxy (fully type-safe, no `any` casts)
  - Subscribes to `nanostoreIPC.subscribe(id, ...)` (remote → local)
  - Fetches initial snapshot via `nanostoreIPC.get(id)` (subscribe-before-get)
  - On local changes, calls `nanostoreIPC.set(id, value)` (local → remote), with safeguards
  - Optional value validation before sending to main

Options:

- `rendererCanSet?: boolean` - Allow renderer writes (default: `true`)
- `warnIfNoIPC?: boolean` - Warn if IPC unavailable (default: `false`)
- `channelPrefix?: string` - Must match init/expose prefix
- `globalName?: string` - Window global name (default: `'nanostoreIPC'`)
- `onError?: ErrorHandler` - Error callback for IPC failures
- `validateValue?: (value: T) => boolean` - Optional value validator (e.g., for Zod integration)

Outside Electron:

- Falls back to a plain local atom (optionally warns).

### 4) Services: `defineService(options)`

Responsibilities:

- Define RPC methods that execute in Main process
- Type-safe remote procedure calls from Renderer
- Event broadcasting for reactive updates across all windows
- Automatic registration (zero-config, like `syncedAtom`)
- Optional middleware hooks for cross-cutting concerns

**Definition (shared file):**

```typescript
import { defineService } from "@janhendry/nanostore-ipc-bridge/services";

export const todoService = defineService({
  id: "todos",
  handlers: {
  // RPC handlers - always execute in Main process
  addTodo: async (data: { title: string; description?: string }) => {
    const todo = await db.todos.create(data);
    // Manual event broadcast to all windows
    todoService.broadcast("todoAdded", todo);
    return todo;
  },

  deleteTodo: async (id: string) => {
    await db.todos.delete(id);
    todoService.broadcast("todoDeleted", id);
  },

  // Optional: Hooks for cross-cutting concerns
  beforeAll: async (methodName, args) => {
    // Run before any handler
    if (!isAuthenticated()) {
      throw new Error("Authentication required");
    }
  },

  afterAll: async (methodName, result, duration) => {
    // Run after any handler
    console.log(`${methodName} completed in ${duration}ms`);
  },
});
```

**Main process (auto-registration):**

```typescript
import { initNanoStoreIPC } from "@janhendry/nanostore-ipc-bridge/main";
import "../shared/services/todoService"; // Import = auto-register!

initNanoStoreIPC({ channelPrefix: "wf" });
// todoService is now registered and ready to handle RPC calls
```

**Renderer process (type-safe RPC):**

```typescript
import { todoService } from "../shared/services/todoService";

// Call RPC method - executes in Main, returns result
const newTodo = await todoService.addTodo({
  title: "Buy milk",
  description: "Whole milk, 1 gallon",
});

// Listen to events broadcasted from Main
const unsubscribe = todoService.on("todoAdded", (todo) => {
  console.log("Todo added:", todo);
  // Update UI reactively
});

// Cleanup
unsubscribe();
```

**Key features:**

- **Zero-config**: Import = register (same pattern as `syncedAtom`)
- **Type-safe**: Full TypeScript inference for method signatures and event payloads
- **Explicit events**: Manual `broadcast()` for full control over what gets published
- **Permissive**: Renderer can call all methods by default (can be restricted later)
- **Composable**: Services can import and call other services
- **Middleware**: Optional `beforeAll`/`afterAll` hooks
- **Error propagation**: Errors in Main are thrown back to Renderer

**Service composition example:**

```typescript
import { notificationService } from "./notificationService";
import { analyticsService } from "./analyticsService";

export const todoService = defineService({
  id: "todos",
  handlers: {
  addTodo: async (data) => {
    const todo = await db.todos.create(data);

    // Services can call other services - no extra setup
    await notificationService.show({
      title: "Todo added",
      body: todo.title,
    });
    await analyticsService.track("todo.created", { id: todo.id });

    todoService.broadcast("todoAdded", todo);
    return todo;
  },
});
```

**Integration with syncedAtom:**

```typescript
import { $todos } from "../stores";

export const todoService = defineService({
  id: "todos",
  handlers: {
  addTodo: async (data) => {
    const todo = await db.todos.create(data);

    // Directly mutate synced store
    // All renderers will receive update automatically!
    $todos.set([...$todos.get(), todo]);

    return todo;
  },

  deleteTodo: async (id) => {
    await db.todos.delete(id);
    $todos.set($todos.get().filter((t) => t.id !== id));
  },
});
```

**IPC protocol:**

- `invoke(svc:call, { serviceId, method, args })` → result or error
- `event(svc:event, { serviceId, eventName, data })` → broadcast to all windows

**Error handling:**

- Errors thrown in Main handlers are serialized and re-thrown in Renderer
- Use `NanoStoreIPCError` for typed errors
- Errors respect the global `onError` callback

**Middleware execution order:**

1. `beforeAll(methodName, args)` - can throw to abort
2. Handler method (e.g., `addTodo(data)`) - main logic
3. `afterAll(methodName, result, duration)` - always runs (even on error)

---

## Data flow

### Renderer startup (race-safe)

1. Renderer calls `syncedAtom(id, initial)`
2. `syncedAtom` registers IPC listener first:
   - `subscribe(id, onSnapshot)`
3. Then it requests the current snapshot:
   - `get(id)`
4. Both update events and the initial snapshot are passed through the same gate:
   - accept only if `snap.rev > lastRev`

This prevents the classic race:

- update arrives after subscribe but before get returns
- get returns older state and would overwrite the newer update

With `rev`, stale snapshots are ignored.

### Remote → Local update path

- Main store changes
- Main increments `rev` for that store
- Main broadcasts `ns:update({ id, rev, value })` to all windows
- Renderer proxy store receives it and updates local atom
- `@nanostores/react` triggers component re-render

### Local → Remote update path

- Renderer code calls `$store.set(value)`
- Proxy store subscribes to local changes
- If change did not originate from a remote update and renderer writes are allowed:
  - call `nanostoreIPC.set(id, value)`
- Main store sets value, triggering broadcast to all windows

Loop prevention:

- `syncedAtom` uses an `applyingRemote` flag to avoid rebroadcasting the same value back to main.

---

## IPC channels

If `channelPrefix = 'wf'`:

**Store sync:**

- `wf:ns:get` (invoke)
- `wf:ns:set` (invoke)
- `wf:ns:update` (event broadcast)

**Services:**

- `wf:svc:call` (invoke) - RPC method calls
- `wf:svc:event` (event broadcast) - Service events

If no prefix: `ns:get`, `ns:set`, `ns:update`, `svc:call`, `svc:event`.

Use a prefix in real apps to avoid collisions.

---

## Error handling

### Error types

All IPC errors are typed as `NanoStoreIPCError` with the following codes:

**Store errors:**

- `STORE_NOT_FOUND` - Store ID not registered in main
- `RENDERER_WRITE_DISABLED` - Renderer tried to write when `allowRendererSet=false`
- `SERIALIZATION_FAILED` - Value not structured-clone-serializable (or validation failed)

**Service errors:**

- `SERVICE_NOT_FOUND` - Service ID not registered in main
- `SERVICE_METHOD_NOT_FOUND` - Method doesn't exist on service

**Initialization errors:**

- `ALREADY_INITIALIZED` - `initNanoStoreIPC()` called more than once

**General errors:**

- `IPC_FAILED` - IPC operation failed (network, destroyed window, etc.)

Each error includes:

- `message: string` - Human-readable description
- `code: string` - Error type identifier
- `storeId?: string` - Store ID if applicable
- `originalError?: unknown` - Original error if wrapped

### Error propagation

**Main process:**

- Errors are logged via `handleError()` if `enableLogging: true`
- Errors are passed to `onError` callback if provided
- IPC handler errors are thrown back to renderer (e.g., store not found)

**Renderer process:**

- `get()` failures are caught and passed to `onError` or logged as warnings
- `set()` failures are caught and passed to `onError` (silent by default for non-breaking behavior)
- `destroy()` cleanup errors are caught and passed to `onError`

### Error handling strategies

1. **Development**: Enable logging and validation

   ```ts
   initNanoStoreIPC({
     enableLogging: true,
     validateSerialization: true,
     onError: (err) => console.error(err),
   });
   ```

2. **Production**: Use error tracking

   ```ts
   initNanoStoreIPC({
     onError: (err) => Sentry.captureException(err),
   });
   ```

3. **Per-store validation**: Use `validateValue`

   ```ts
   import { z } from "zod";

   const schema = z.object({ name: z.string() });

   syncedAtom(
     "user",
     { name: "" },
     {
       validateValue: (val) => schema.safeParse(val).success,
     },
   );
   ```

---

## Constraints and assumptions

### Serialization

IPC payloads must be structured-clone-serializable. The preload layer automatically validates inputs to prevent:

- Functions, symbols, undefined
- Class instances (except Date, RegExp, Error which are structured-cloneable)
- Prototype pollution attempts (`__proto__`, `constructor`, `prototype` manipulation)
- Non-serializable values

**Rejected values:**

- class instances, functions, symbols
- `Map`, `Set` (unless you convert to arrays)
- DOM objects, Electron objects
- Objects with modified prototypes (except whitelisted types)

**Accepted values:**

- Plain objects, arrays, numbers, strings, booleans, null
- Date, RegExp, Error instances

The validation layer throws `TypeError` on invalid inputs, preventing them from reaching the main process.

### Single instance / single main process

This design targets one Electron app instance with one main process controlling windows.

**Singleton enforcement:**

- `initNanoStoreIPC()` can only be called once per app lifecycle
- Calling it multiple times throws `ALREADY_INITIALIZED` error
- This prevents duplicate IPC handler registration and state conflicts

If you run multiple app instances concurrently, you need a shared persistence layer (DB/file locks).

### Store discovery

“Automatic” store discovery is achieved via module import:

- When the shared store module is imported in main, those `syncedAtom()` calls register stores.
  There is no robust runtime way to discover arbitrary stores without importing their modules.

---

## Security model

**Built-in security features:**

- ✅ **Input validation**: All IPC inputs validated at preload boundary
- ✅ **Prototype pollution protection**: Rejects dangerous object structures
- ✅ **Serialization checks**: Only structured-cloneable values accepted
- ✅ **ID validation**: Enforces string IDs with length limits (max 256 chars)
- ✅ **Type safety**: Full TypeScript coverage prevents runtime errors
- ✅ **Singleton enforcement**: Prevents multiple initialization and handler conflicts
- ✅ **Update batching**: Mitigates high-frequency update spam (automatic via microtask queue)

**DX-first defaults:**

- `allowRendererSet: true` enables direct writes from renderer
- No additional runtime validation by default (validation at preload is sufficient)

**For stricter production posture:**

- Set `allowRendererSet: false` to disable renderer writes entirely
- Expose only actions/commands (explicit IPC endpoints via services) for mutations
- Validate inputs on main side using `validateSerialization: true` or per-store `validateValue`
- Consider read-only renderer stores (`syncedAtom(..., { rendererCanSet: false })`)
- Implement error tracking via `onError` callback
- Use schema validation (e.g., Zod) for critical stores

**Threat considerations:**

- ✅ **Mitigated**: Prototype pollution (validated at preload)
- ✅ **Mitigated**: Non-serializable values (validated at preload)
- ✅ **Mitigated**: IPC spam (update batching via microtask queue)
- ✅ **Mitigated**: Multiple initialization (singleton enforcement)
- ⚠️ **Consider**: Renderer is less trusted - validate business logic constraints on main side
- ⚠️ **Consider**: Error messages may expose store structure - sanitize in production if needed
- ⚠️ **Consider**: Rate limiting for service calls (not yet implemented)

---

## Extensibility

Implemented features:

1. **✅ Error handling**
   - Custom `NanoStoreIPCError` with typed error codes
   - Error callbacks for tracking and logging
   - Structured error propagation

2. **✅ Value validation**
   - Automatic input validation at preload boundary
   - Optional `validateValue` per store for business logic
   - Optional `validateSerialization` in main for runtime checks
   - Prototype pollution protection
   - Ready for schema validators (Zod, Yup, etc.)

3. **✅ Memory leak prevention**
   - Proper event cleanup using `once()` instead of `on()`
   - Destroyed window removal
   - Complete `destroy()` implementation

4. **✅ Performance optimization**
   - Automatic update batching via microtask queue
   - Reduces IPC overhead for high-frequency updates
   - Batches multiple store updates into single broadcast round

5. **✅ Services / Actions**
   - Zero-config RPC services with `defineService()`
   - Type-safe method calls from Renderer to Main
   - Event broadcasting for reactive updates
   - Optional middleware hooks
   - Service composition support

Future enhancements:

1. **Rate limiting**
   - Per-window rate limiting for service calls
   - Configurable thresholds
   - DOS protection

2. **Selective sync**
   - Track which stores each window subscribes to
   - Only broadcast to interested windows
   - Additional throttling options for high-frequency stores

3. **Persistence**
   - Persist store values in main (electron-store/SQLite)
   - Replay persisted values on startup before windows load

4. **DevTools**
   - Log store updates in development
   - Provide store inspector window
   - Time-travel debugging
   - Service call tracing

5. **Computed store support**
   - Add `syncedComputed()` for derived values
   - Efficient synchronization of computed stores

---

## Testing strategy

- Unit test the renderer proxy logic by providing a mock `nanostoreIPC` object:
  - simulate `subscribe` callbacks and `get` responses
  - verify `rev` gating and loop prevention
- For integration tests, run Electron with two windows and assert synchronization.

The provided demo app covers the basic integration flow.
