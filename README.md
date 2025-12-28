# whisperflow-nanostore-ipc-bridge-demo

This ZIP contains:

- `packages/nanostore-ipc-bridge` — a small library that provides a **zero-config** `syncedAtom()` for Electron:
  - In **Main**: creates a real NanoStore and registers it automatically.
  - In **Renderer**: creates an IPC-backed NanoStore proxy (same ID), keeping all windows in sync.

- `apps/test-electron` — a minimal Electron + Vite + React test app that opens **two windows** and shows a shared counter + shared settings, fully synchronized.

## Quick start (local)

Prereqs:
- Node.js 18+ recommended
- A package manager (npm works)

```bash
npm install
npm run dev
```

The demo opens two windows. Changing the counter or theme in either window should update the other.

## Notes

- The IPC surface is intentionally tiny: `get(id)`, `set(id,value)`, and `subscribe(id, cb)`.
- State sync uses a monotonic `rev` to avoid race conditions (subscribe-before-get cannot roll state back).
