import { app, BrowserWindow, ipcMain } from 'electron'
import type { Store } from 'nanostores'
import { WF_NS_QUEUE, WF_NS_MAIN_API } from '../internal/symbols'
import type { MainApi, Snapshot } from '../internal/types'

export interface InitNanoStoreIPCOptions {
  channelPrefix?: string
  enableLogging?: boolean
  autoRegisterWindows?: boolean
  /**
   * If false, renderer cannot call set() (write access). Reads + updates still work.
   * Default: true (DX-first).
   */
  allowRendererSet?: boolean
}

type StoreEntry = {
  store: Store<any>
  rev: number
  unsubscribe: () => void
}

type Queue = Map<string, Store<any>>

function ch(prefix: string, c: string) {
  return prefix ? `${prefix}:${c}` : c
}

/**
 * Initializes a minimal IPC surface:
 * - invoke: ns:get(id) -> {id,rev,value}
 * - invoke: ns:set(id,value) -> void
 * - event:  ns:update({id,rev,value}) broadcast to all registered windows
 *
 * Windows are auto-registered by default.
 *
 * Stores can be created before init; they are kept in a global queue and registered on init.
 */
export function initNanoStoreIPC(opts: InitNanoStoreIPCOptions = {}) {
  const channelPrefix = opts.channelPrefix ?? ''
  const enableLogging = opts.enableLogging ?? false
  const autoRegisterWindows = opts.autoRegisterWindows ?? true
  const allowRendererSet = opts.allowRendererSet ?? true

  const windows = new Set<BrowserWindow>()
  const stores = new Map<string, StoreEntry>()

  const queue: Queue = (globalThis as any)[WF_NS_QUEUE] ?? new Map<string, Store<any>>()
  ;(globalThis as any)[WF_NS_QUEUE] = queue

  const log = (...args: any[]) => {
    if (enableLogging) console.log('[nanostore-ipc]', ...args)
  }

  const broadcast = (snap: Snapshot<any>) => {
    const channel = ch(channelPrefix, 'ns:update')
    for (const win of windows) {
      if (win.isDestroyed()) continue
      win.webContents.send(channel, snap)
    }
  }

  const registerStore = (id: string, store: Store<any>) => {
    if (stores.has(id)) {
      // Do not re-register (can happen if modules are imported multiple times across build boundaries)
      return
    }

    let entry: StoreEntry = {
      store,
      rev: 0,
      unsubscribe: () => {}
    }

    const unsubscribe = store.subscribe((value) => {
      entry.rev += 1
      broadcast({ id, rev: entry.rev, value })
    })

    entry.unsubscribe = unsubscribe
    stores.set(id, entry)

    log('store registered:', id)
  }

  const api: MainApi = {
    registerStore,
    isInitialized: () => true
  }
  ;(globalThis as any)[WF_NS_MAIN_API] = api

  // Register queued stores (created before init)
  for (const [id, store] of queue.entries()) {
    registerStore(id, store)
  }
  queue.clear()

  // IPC handlers (generic, no per-store handlers)
  const getChannel = ch(channelPrefix, 'ns:get')
  const setChannel = ch(channelPrefix, 'ns:set')

  if (ipcMain.listenerCount(getChannel) === 0) {
    ipcMain.handle(getChannel, (_e, id: string) => {
      const entry = stores.get(id)
      if (!entry) throw new Error(`Store not found: ${id}`)
      return { id, rev: entry.rev, value: entry.store.get() } satisfies Snapshot<any>
    })
  }

  if (ipcMain.listenerCount(setChannel) === 0) {
    ipcMain.handle(setChannel, (_e, id: string, value: any) => {
      if (!allowRendererSet) {
        throw new Error('Renderer writes are disabled for syncedAtom (allowRendererSet=false).')
      }
      const entry = stores.get(id)
      if (!entry) throw new Error(`Store not found: ${id}`)
      // This will trigger broadcast via subscribe()
      ;(entry.store as any).set?.(value)
    })
  }

  const registerWindow = (win: BrowserWindow) => {
    if (windows.has(win)) return
    windows.add(win)

    win.on('closed', () => windows.delete(win))

    // Push snapshots on load (helps new windows)
    win.webContents.on('did-finish-load', () => {
      for (const [id, entry] of stores.entries()) {
        const snap: Snapshot<any> = { id, rev: entry.rev, value: entry.store.get() }
        if (!win.isDestroyed()) win.webContents.send(ch(channelPrefix, 'ns:update'), snap)
      }
    })

    log('window registered')
  }

  if (autoRegisterWindows) {
    app.on('browser-window-created', (_event, win) => {
      registerWindow(win)
    })
  }

  log('IPC initialized', { channelPrefix, autoRegisterWindows, allowRendererSet })

  return {
    registerStore,
    registerWindow,
    destroy: () => {
      for (const entry of stores.values()) {
        try { entry.unsubscribe() } catch {}
      }
      stores.clear()
      windows.clear()
      ipcMain.removeHandler(getChannel)
      ipcMain.removeHandler(setChannel)
      log('destroyed')
    }
  }
}
