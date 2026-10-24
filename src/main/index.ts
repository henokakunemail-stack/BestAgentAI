import { app, BrowserWindow, globalShortcut } from 'electron'
import { terminalManager } from './terminal/ptyManager'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow, getMainWindow } from './windows/mainWindow'
import { createLauncherWindow, toggleLauncherWindow } from './windows/launcherWindow'
import { initTray } from './windows/trayManager'
import { registerIpcHandlers } from './ipc/registerHandlers'
import { mcpManager } from './mcp/mcpClientManager'
import { initDatabase } from './storage/db'
import { killAllJobs } from './agent/bgJobs'
import { discardAll as discardAllSkillInstalls } from './install/skillInstaller'

let endAllSessions: () => Promise<void> = async () => {}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.ai.desktop')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Init storage & MCP
    await initDatabase()
    mcpManager.initialize().catch((err) => {
      console.warn('Initial MCP sync warning:', err.message)
    })

    // Register IPC
    endAllSessions = registerIpcHandlers()

    // Windows & Tray
    createMainWindow()
    createLauncherWindow()
    initTray()

    // Register global shortcut: Ctrl+Space (or Command+Space)
    globalShortcut.register('CommandOrControl+Space', () => {
      toggleLauncherWindow()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      }
    })
  })

  // SessionEnd hooks are async and the app would exit before they finish: hold the quit once, bounded to 3 s.
  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) return
    quitting = true
    e.preventDefault()
    void Promise.race([endAllSessions(), new Promise((r) => setTimeout(r, 3000))])
      .catch(() => {})
      .finally(() => app.quit())
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    terminalManager.dispose()
    killAllJobs()
    void mcpManager.dispose()
    void discardAllSkillInstalls()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
