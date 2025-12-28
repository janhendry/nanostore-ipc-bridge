# Developer README

This repository is a **workspace** containing:

- `packages/nanostore-ipc-bridge` — the library (TypeScript, built with `tsup`)
- `apps/test-electron` — a minimal Electron + Vite + React demo app (two windows)

The library provides a **zero-config** primitive:

- `syncedAtom<T>(id, initial)` — same call-site for Main and Renderer
  - **Main**: creates a real NanoStore atom and registers it for IPC broadcasting
  - **Renderer**: creates an IPC-backed proxy atom that mirrors the Main store and keeps all windows in sync

---

## Quick start

From repo root:

```bash
npm install
npm run dev
```

Expected behavior:
- Two Electron windows open.
- Counter and settings changes sync across both windows instantly.

---

## Workspace scripts

### Root

```bash
npm run build     # builds all workspaces
npm run dev       # runs the demo app in dev mode
```

### Library

```bash
npm run -w @whisperflow/nanostore-ipc-bridge build
```

Build outputs:
- `packages/nanostore-ipc-bridge/dist/*` (ESM + CJS + DTS)

### Demo app

```bash
npm run -w @demo/test-electron dev
npm run -w @demo/test-electron build
```

---

## Library usage (in your app)

### 1) Main

1. Initialize IPC once:
   ```ts
   import { initNanoStoreIPC } from '@whisperflow/nanostore-ipc-bridge/main'

   initNanoStoreIPC({
     channelPrefix: 'wf',        // optional but recommended
     autoRegisterWindows: true,  // default true
     allowRendererSet: true      // DX-first (can be hardened later)
   })
   ```

2. Ensure your shared store module is imported in Main **after** init (recommended) or anytime (works via queue):
   ```ts
   import '../shared/stores'
   ```

> Note: `syncedAtom()` can run before `initNanoStoreIPC()`. Stores created early are queued and registered when `initNanoStoreIPC()` is called.

### 2) Preload

Expose the IPC API once:

```ts
import { exposeNanoStoreIPC } from '@whisperflow/nanostore-ipc-bridge/preload'

exposeNanoStoreIPC({
  channelPrefix: 'wf',
  globalName: 'nanostoreIPC' // default is "nanostoreIPC"
})
```

### 3) Shared store module (imported in Main and Renderer)

```ts
import { syncedAtom } from '@whisperflow/nanostore-ipc-bridge/universal'

export const $counter = syncedAtom<number>('counter', 0)
export const $settings = syncedAtom('settings', { theme: 'dark' as const, hotkey: 'Ctrl+K' })
```

### 4) Renderer

Use it like a normal NanoStore (example with `@nanostores/react`):

```tsx
import { useStore } from '@nanostores/react'
import { $settings } from '../shared/stores'

export function SettingsPanel() {
  const settings = useStore($settings)
  return (
    <button onClick={() => $settings.set({ ...settings, theme: settings.theme === 'dark' ? 'light' : 'dark' })}>
      Toggle theme
    </button>
  )
}
```

---

## Development notes

### Electron process detection

`syncedAtom()` determines runtime mode as:
- Main: `process.versions.electron` exists and there is **no** `window`
- Renderer: `window` exists and the preload-exposed API is present

Outside Electron (tests/SSR), it falls back to a plain local NanoStore and can optionally warn.

### Channel prefix

For non-trivial apps, always set `channelPrefix` to avoid IPC channel collisions:

- Main: `initNanoStoreIPC({ channelPrefix: 'wf' })`
- Preload: `exposeNanoStoreIPC({ channelPrefix: 'wf' })`

### Cleanup

The proxy store created in the renderer provides an optional `.destroy()` method that removes IPC listeners.
Most apps do not need to call this unless you dynamically create/destroy stores at runtime.

---

## Hardening options (recommended for production)

The demo is DX-first. For production you may want:

- Disable direct renderer writes:
  - Main: `allowRendererSet: false`
  - Then mutate via explicit IPC actions (commands), not raw `set`.
- Validate/serialize state:
  - Ensure all store values are structured-clone-serializable.
  - Optionally validate snapshots (e.g. zod) in main before broadcasting.

See `ARCHITECTURE.md` for details and extension points.
