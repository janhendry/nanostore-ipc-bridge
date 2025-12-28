import { contextBridge, ipcRenderer } from 'electron'
import type { Snapshot } from '../internal/types'

export interface ExposeNanoStoreIPCOptions {
  channelPrefix?: string
  /**
   * Name under which the API is exposed to window.
   * Default: "nanostoreIPC"
   */
  globalName?: string
}

export type NanoStoreIPC = {
  get: <T = any>(id: string) => Promise<Snapshot<T>>
  set: <T = any>(id: string, value: T) => Promise<void>
  subscribe: <T = any>(id: string, cb: (snap: Snapshot<T>) => void) => () => void
  subscribeAll: (cb: (snap: Snapshot<any>) => void) => () => void
}

function ch(prefix: string, c: string) {
  return prefix ? `${prefix}:${c}` : c
}

export function exposeNanoStoreIPC(opts: ExposeNanoStoreIPCOptions = {}) {
  const channelPrefix = opts.channelPrefix ?? ''
  const globalName = opts.globalName ?? 'nanostoreIPC'

  const api: NanoStoreIPC = {
    get: (id) => ipcRenderer.invoke(ch(channelPrefix, 'ns:get'), id),
    set: (id, value) => ipcRenderer.invoke(ch(channelPrefix, 'ns:set'), id, value),
    subscribe: (id, cb) => {
      const channel = ch(channelPrefix, 'ns:update')
      const handler = (_: unknown, snap: Snapshot<any>) => {
        if (snap.id !== id) return
        cb(snap)
      }
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    subscribeAll: (cb) => {
      const channel = ch(channelPrefix, 'ns:update')
      const handler = (_: unknown, snap: Snapshot<any>) => cb(snap)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    }
  }

  contextBridge.exposeInMainWorld(globalName, api)
  return api
}
