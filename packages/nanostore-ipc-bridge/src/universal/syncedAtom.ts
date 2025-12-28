import { atom } from 'nanostores'
import type { Store } from 'nanostores'
import { WF_NS_QUEUE, WF_NS_MAIN_API } from '../internal/symbols'
import type { MainApi, Snapshot } from '../internal/types'

export interface SyncedAtomOptions<T> {
  /**
   * If true, renderer writes are blocked even if main allows writes.
   * Useful to force "actions only" mutability later without breaking API.
   */
  rendererCanSet?: boolean
  /**
   * Optional: warn when IPC is not available (e.g. during SSR/tests).
   */
  warnIfNoIPC?: boolean
  /**
   * Optional: channel prefix to match init/expose
   * If you set it here, you must also pass it to expose/init.
   * If omitted, uses unprefixed channels.
   */
  channelPrefix?: string
  /**
   * Window global name used by preload exposure.
   * Default: "nanostoreIPC"
   */
  globalName?: string
}

function isElectronMain(): boolean {
  // In Electron main, `process.versions.electron` exists and there is no window/document.
  return (
    typeof process !== 'undefined' &&
    !!(process as any).versions?.electron &&
    typeof window === 'undefined'
  )
}

function getRendererIPC(globalName: string): any | null {
  if (typeof window === 'undefined') return null
  return (window as any)[globalName] ?? null
}

function getMainApi(): MainApi | null {
  return (globalThis as any)[WF_NS_MAIN_API] ?? null
}

function getQueue(): Map<string, Store<any>> {
  const q: Map<string, Store<any>> = (globalThis as any)[WF_NS_QUEUE] ?? new Map()
  ;(globalThis as any)[WF_NS_QUEUE] = q
  return q
}

/**
 * syncedAtom(id, initial):
 * - In Electron Main: creates a real atom and registers it for IPC broadcast.
 * - In Electron Renderer: creates a proxy atom and syncs it via preload-exposed IPC API.
 * - Outside Electron: behaves as a normal atom(initial).
 *
 * No central "bridge definition" required; ID is the single piece of shared contract.
 */
export function syncedAtom<T>(id: string, initial: T, options: SyncedAtomOptions<T> = {}) {
  const globalName = options.globalName ?? 'nanostoreIPC'

  // MAIN: real store + registration
  if (isElectronMain()) {
    const $store = atom<T>(initial)

    const api = getMainApi()
    if (api) {
      api.registerStore(id, $store)
    } else {
      // initNanoStoreIPC not called yet -> queue for later
      getQueue().set(id, $store)
    }

    return $store
  }

  // RENDERER: IPC-backed proxy store (if IPC is available)
  const ipc = getRendererIPC(globalName)

  const $local = atom<T>(initial) as any

  if (!ipc) {
    if (options.warnIfNoIPC) {
      // eslint-disable-next-line no-console
      console.warn(`[syncedAtom] IPC not available for "${id}". Falling back to local atom().`)
    }
    return $local
  }

  let applyingRemote = false
  let lastRev = -1
  let hasRemote = false
  let readyForOutbound = false
  const rendererCanSet = options.rendererCanSet ?? true

  // remote -> local (subscribe first)
  const unsubscribeRemote = ipc.subscribe(id, (snap: Snapshot<T>) => {
    if (snap.rev <= lastRev) return
    lastRev = snap.rev
    hasRemote = true
    applyingRemote = true
    $local.set(snap.value)
    applyingRemote = false
    readyForOutbound = true
  })

  // then get snapshot (rev-gated)
  ipc.get(id)
    .then((snap: Snapshot<T>) => {
      if (snap.rev <= lastRev) return
      lastRev = snap.rev
      hasRemote = true
      applyingRemote = true
      $local.set(snap.value)
      applyingRemote = false
      readyForOutbound = true
    })
    .catch((err: any) => {
      // If store not registered in main, keep local store
      if (options.warnIfNoIPC) {
        // eslint-disable-next-line no-console
        console.warn(`[syncedAtom] get("${id}") failed. Keeping local atom().`, err)
      }
      readyForOutbound = true // allow local usage even if remote missing
    })

  // local -> remote (after first remote snapshot or after get failed)
  const unsubscribeLocal = $local.subscribe((value: T) => {
    if (!rendererCanSet) return
    if (!readyForOutbound) return
    if (applyingRemote) return
    // If remote doesn't exist (hasRemote=false + get failed), set() will likely fail; ignore silently.
    ipc.set(id, value).catch(() => {})
  })

  // Optional cleanup hook
  $local.destroy = () => {
    try { unsubscribeRemote() } catch {}
    try { unsubscribeLocal() } catch {}
  }

  return $local
}
