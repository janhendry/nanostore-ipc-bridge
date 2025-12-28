import { exposeNanoStoreIPC } from '@whisperflow/nanostore-ipc-bridge/preload'

exposeNanoStoreIPC({
  channelPrefix: 'wf',
  globalName: 'nanostoreIPC'
})
