import { Tray, Menu, app, nativeImage } from 'electron'
import { getMainWindow, createMainWindow } from './mainWindow'
import { toggleLauncherWindow } from './launcherWindow'

// 32x32 amber disc (generated; swap for a branded PNG when one exists)
const ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAyElEQVR42s2XsQ3EIAxFU13JbozAFDcAK3iF7MIKmcErIOVcGAlFRApH4Lt4TRT0n4ID9nZ8PxuS3gVeICEJLGSF9RnpO68KOCFqyPkQ1jVuVCB0BrdEwr8CNBB8hXoF9hfDC/tTAZoQfvslWnt+TibcCbjBguspTNcSiAvCC7ElwAsF+CrgF4YXfC1AAAGqBRJAINUCDBDgWiADBLIpAfgWwIsQ/hvCDyL4UWziMoJfx/CGxERLZqIpNdGWmxhMTIxmJobTqfwAlHsYBalEd2sAAAAASUVORK5CYII='

let tray: Tray | null = null

export function initTray(): Tray {
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${ICON_PNG_BASE64}`).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('AI Desktop')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open AI Desktop',
      click: () => {
        const win = getMainWindow() || createMainWindow()
        win.show()
        win.focus()
      }
    },
    {
      label: 'Toggle Spotlight Launcher (Ctrl+Space)',
      click: () => toggleLauncherWindow()
    },
    { type: 'separator' },
    {
      label: 'Quit AI Desktop',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    const win = getMainWindow() || createMainWindow()
    win.show()
    win.focus()
  })

  return tray
}
