# @janhendry/nanostore-ipc-bridge

**Zero-config Electron IPC bridge for NanoStores** – Synchronize nanostores between main and renderer processes with full TypeScript support.

## Features

✅ **Zero-config** – Import once, works everywhere  
✅ **Type-safe** – Full TypeScript support with inference  
✅ **Multi-window sync** – All renderer windows stay in sync automatically  
✅ **Race-condition free** – Monotonic revision tracking prevents stale updates  
✅ **Services/RPC** – Define type-safe services with events  
✅ **Developer-friendly** – No boilerplate, no manual registration

---

## Installation

```bash
npm install @janhendry/nanostore-ipc-bridge nanostores
```

## Quick Start

### 1. Define a synced store (shared file)

```typescript
// shared/stores.ts
import { syncedAtom } from "@janhendry/nanostore-ipc-bridge/universal";

export const $counter = syncedAtom("counter", 0);
export const $settings = syncedAtom("settings", { theme: "dark" });
```

### 2. Initialize in Main process

```typescript
// electron/main.ts
import { initNanoStoreIPC } from "@janhendry/nanostore-ipc-bridge/main";
import "../shared/stores"; // Import stores to register them

const mainWindow = new BrowserWindow({
  webPreferences: { preload: path.join(__dirname, "preload.js") },
});

initNanoStoreIPC({ autoRegisterWindows: true });
```

### 3. Expose API in Preload script

```typescript
// electron/preload.ts
import { exposeNanoStoreIPC } from "@janhendry/nanostore-ipc-bridge/preload";

exposeNanoStoreIPC();
```

### 4. Use in Renderer

```typescript
// renderer/App.tsx
import { useStore } from "@nanostores/react";
import { $counter, $settings } from "../shared/stores";

export function App() {
  const counter = useStore($counter);
  const settings = useStore($settings);

  return (
    <div>
      <p>Counter: {counter}</p>
      <button onClick={() => $counter.set(counter + 1)}>+1</button>

      <p>Theme: {settings.theme}</p>
      <button onClick={() => $settings.set({ ...settings, theme: "light" })}>
        Toggle Theme
      </button>
    </div>
  );
}
```

**That's it!** All windows will stay in sync automatically.

---

## Services (RPC + Events)

Define type-safe services for complex operations:

```typescript
// shared/todoService.ts
import { defineService } from "@janhendry/nanostore-ipc-bridge/services";

export const todoService = defineService("todos", {
  addTodo: async (text: string) => {
    const todo = { id: Date.now(), text, completed: false };
    todos.push(todo);
    todoService.broadcast("todoAdded", todo);
    return todo;
  },

  deleteTodo: async (id: number) => {
    todos = todos.filter((t) => t.id !== id);
    todoService.broadcast("todoDeleted", id);
  },
});
```

Use in Renderer:

```typescript
// Add todo via RPC
const todo = await todoService.addTodo("Buy milk");

// Listen to events
todoService.on("todoAdded", (todo) => {
  console.log("New todo:", todo);
});
```

---

## API Reference

### `syncedAtom(id, initialValue)`

Creates a synchronized atom that works in both Main and Renderer.

- **Main process**: Real nanostore with automatic registration
- **Renderer process**: IPC-backed proxy that syncs with Main
- **Returns**: Standard nanostore atom with `.get()`, `.set()`, `.subscribe()`

### `initNanoStoreIPC(options?)`

Initialize the IPC bridge in Main process.

**Options:**

- `channelPrefix?: string` – IPC channel prefix (default: `'ns'`)
- `autoRegisterWindows?: boolean` – Auto-register new windows (default: `true`)
- `allowRendererSet?: boolean` – Allow renderer to modify stores (default: `true`)

### `exposeNanoStoreIPC(options?)`

Expose IPC API in Preload script.

**Options:**

- `channelPrefix?: string` – Must match Main process (default: `'ns'`)
- `globalName?: string` – Global variable name (default: `'nanostoreIPC'`)

### `defineService(name, handlers)`

Define a type-safe service with RPC methods and events.

- **Main process**: Handlers execute locally
- **Renderer process**: Returns RPC proxy
- **Events**: Use `.broadcast(event, data)` in handlers, `.on(event, cb)` in renderer

---

## How it works

1. **Main process** creates real nanostores and handles IPC requests
2. **Renderer processes** get IPC-backed proxies that forward operations
3. **Revision tracking** prevents race conditions (subscribe-before-get is safe)
4. **Auto-sync** broadcasts changes to all connected windows

---

## Demo App

This repository includes a demo Electron app in `apps/test-electron`:

```bash
npm install
npm run dev
```

Opens two windows with synchronized counter, settings, and todo list.

---

## Documentation

- **[DEV_README.md](./DEV_README.md)** – Development guide, architecture details
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** – In-depth technical documentation

---

## License

MIT
