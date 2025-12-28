# @whisperflow/nanostore-ipc-bridge

Zero-config NanoStores synchronization across Electron windows via IPC.

## The primitive

```ts
import { syncedAtom } from '@whisperflow/nanostore-ipc-bridge/universal'
export const $settings = syncedAtom('settings', { theme: 'dark' })
```

Import the same module in **Main** and **Renderer**.

## Main

```ts
import { initNanoStoreIPC } from '@whisperflow/nanostore-ipc-bridge/main'
initNanoStoreIPC({ channelPrefix: 'wf', autoRegisterWindows: true })
import './shared/stores'
```

## Preload

```ts
import { exposeNanoStoreIPC } from '@whisperflow/nanostore-ipc-bridge/preload'
exposeNanoStoreIPC({ channelPrefix: 'wf' })
```

## Renderer

Use `$settings` like any NanoStore (e.g. with `@nanostores/react`).

See the demo app under `apps/test-electron`.
