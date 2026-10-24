import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// connect-src 'self': renderer talks to main via IPC only. frame-src data: = artifact preview (sandboxed, no same-origin).
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src data:; object-src 'none'; base-uri 'none'; form-action 'none'"

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
        name: 'csp',
        apply: 'build',
        transformIndexHtml: (html) =>
          html.replace('<head>', `<head>
    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
      }
    ]
  }
})
