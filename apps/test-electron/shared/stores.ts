import { syncedAtom } from '@whisperflow/nanostore-ipc-bridge/universal'

export type SettingsState = {
  theme: 'light' | 'dark'
  hotkey: string
}

export const $counter = syncedAtom<number>('counter', 0, { warnIfNoIPC: true })

export const $settings = syncedAtom<SettingsState>('settings', {
  theme: 'dark',
  hotkey: 'CmdOrCtrl+Shift+Space'
}, { warnIfNoIPC: true })
