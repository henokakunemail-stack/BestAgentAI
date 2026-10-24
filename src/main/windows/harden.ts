import { shell, WebContents } from 'electron'
import { isSafeExternalUrl } from '../ipc/validate'

/** Renderer may not navigate away or open windows; only https links go to the system browser. */
export function hardenWebContents(wc: WebContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (e, url) => {
    // dev server reloads stay on the same origin; anything else is blocked
    const dev = process.env.ELECTRON_RENDERER_URL
    if (dev && url.startsWith(dev)) return
    if (url.startsWith('file://') && wc.getURL().startsWith('file://')) return // hash/reload within the app bundle
    e.preventDefault()
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
  })
  wc.on('will-attach-webview', (e) => e.preventDefault())
}
