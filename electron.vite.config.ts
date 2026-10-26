import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// connect-src 'self': renderer talks to main via IPC only. frame-src data: = artifact preview (sandboxed, no same-origin).
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src data:; object-src 'none'; base-uri 'none'; form-action 'none'"
// Dev server: the React refresh preamble is an inline script and HMR talks over a websocket. Still no remote origins.
const CSP_DEV = CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("connect-src 'self'", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*")

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [
      react(),
      {
        // Applied in dev and build: a renderer without CSP in dev would hide policy breakage until the packaged app.
        name: 'csp',
        transformIndexHtml: (html, ctx) =>
          html.replace('<head>', `<head>
    <meta http-equiv="Content-Security-Policy" content="${ctx.server ? CSP_DEV : CSP}" />`)
      }
    ]
  }
})
