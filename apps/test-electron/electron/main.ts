import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initNanoStoreIPC } from '@whisperflow/nanostore-ipc-bridge/main'

// IMPORTANT: import the shared stores in main so they are created/registered in the main process.
import '../shared/stores'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

initNanoStoreIPC({
  channelPrefix: 'wf',
  enableLogging: true,
  autoRegisterWindows: true,
  allowRendererSet: true
})

function createWindow(title: string) {
  const win = new BrowserWindow({
    width: 520,
    height: 420,
    title,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  createWindow('Window A')
  createWindow('Window B')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
