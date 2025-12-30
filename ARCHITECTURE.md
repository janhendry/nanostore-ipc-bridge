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

The API is exposed under `window.nanostoreIPC` by default (configurable).

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

- `wf:ns:get` (invoke)
- `wf:ns:set` (invoke)
- `wf:ns:update` (event broadcast)

If no prefix: `ns:get`, `ns:set`, `ns:update`.

Use a prefix in real apps to avoid collisions.

---

## Error handling

### Error types

All IPC errors are typed as `NanoStoreIPCError` with the following codes:

- `STORE_NOT_FOUND` - Store ID not registered in main
- `RENDERER_WRITE_DISABLED` - Renderer tried to write when `allowRendererSet=false`
- `SERIALIZATION_FAILED` - Value not structured-clone-serializable (or validation failed)
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
     }
   );
   ```

---

## Constraints and assumptions

### Serialization

IPC payloads must be structured-clone-serializable. Avoid:

- class instances, functions
- `Map`, `Set` (unless you convert to arrays)
- DOM objects, Electron objects

Recommended: plain objects, arrays, numbers, strings, booleans.

### Single instance / single main process

This design targets one Electron app instance with one main process controlling windows.
If you run multiple app instances concurrently, you need a shared persistence layer (DB/file locks).

### Store discovery

“Automatic” store discovery is achieved via module import:

- When the shared store module is imported in main, those `syncedAtom()` calls register stores.
  There is no robust runtime way to discover arbitrary stores without importing their modules.

---

## Security model

DX-first defaults:

- `allowRendererSet: true` enables direct writes from renderer.
- No runtime validation by default (performance).

For stricter production posture:

- Set `allowRendererSet: false`
- Expose only actions/commands (explicit IPC endpoints) for mutations
- Validate inputs on main side using `validateSerialization: true` or per-store `validateValue`
- Consider read-only renderer stores (`syncedAtom(..., { rendererCanSet: false })`)
- Implement error tracking via `onError` callback
- Use schema validation (e.g., Zod) for critical stores

Threat considerations:

- Renderer is less trusted. Treat incoming values as untrusted input.
- Keep preload API surface small (this design does).
- All errors include store IDs - be careful not to leak sensitive info in error messages.
- `validateSerialization` has performance cost - use sparingly in production.

---

## Extensibility

Implemented features:

1. **✅ Error handling**

   - Custom `NanoStoreIPCError` with typed error codes
   - Error callbacks for tracking and logging
   - Structured error propagation

2. **✅ Value validation**

   - Optional `validateValue` per store
   - Optional `validateSerialization` in main
   - Ready for schema validators (Zod, Yup, etc.)

3. **✅ Memory leak prevention**
   - Proper event cleanup using `once()` instead of `on()`
   - Destroyed window removal
   - Complete `destroy()` implementation

Common enhancements (future work):

1. **Actions / commands**

   - Replace raw `set(id,value)` with `dispatch(action,args)`
   - Enforce mutation rules centrally in main

2. **Selective sync / throttling**

   - throttle high-frequency stores (e.g., mouse position)
   - batch updates per animation frame

3. **Persistence**

   - Persist store values in main (electron-store/SQLite)
   - Replay persisted values on startup before windows load

4. **DevTools**
   - Log store updates in development
   - Provide store inspector window
   - Time-travel debugging

---

## Testing strategy

- Unit test the renderer proxy logic by providing a mock `nanostoreIPC` object:
  - simulate `subscribe` callbacks and `get` responses
  - verify `rev` gating and loop prevention
- For integration tests, run Electron with two windows and assert synchronization.

The provided demo app covers the basic integration flow.
