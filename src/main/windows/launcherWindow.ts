import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { hardenWebContents } from './harden'

let launcherWindow: BrowserWindow | null = null

export function createLauncherWindow(): BrowserWindow {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    return launcherWindow
  }

  launcherWindow = new BrowserWindow({
    width: 680,
    height: 420,
    frame: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    backgroundColor: '#18181b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  hardenWebContents(launcherWindow.webContents)

  if (process.env.ELECTRON_RENDERER_URL) {
    launcherWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#launcher`)
  } else {
    launcherWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'launcher' })
  }

  launcherWindow.on('blur', () => {
    launcherWindow?.hide()
  })

  launcherWindow.on('closed', () => {
    launcherWindow = null
  })

  return launcherWindow
}

export function toggleLauncherWindow(): void {
  if (!launcherWindow || launcherWindow.isDestroyed()) {
    createLauncherWindow()
  }

  if (launcherWindow?.isVisible()) {
    launcherWindow.hide()
  } else {
    launcherWindow?.show()
    launcherWindow?.focus()
  }
}
