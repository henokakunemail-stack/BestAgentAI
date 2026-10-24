import { spawn, ChildProcess } from 'node:child_process'
import { sanitizeTerminalOutput } from '../agent/rtkProxy'

// Real PTY via prebuilt @lydell/node-pty (N-API, no electron-rebuild); falls back to piped child_process.
let ptyLib: typeof import('@lydell/node-pty') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ptyLib = require('@lydell/node-pty')
} catch {
  ptyLib = null
}

// Keep colors out of the plain <pre> view, but unlike sanitizeTerminalOutput do not drop "noise" lines in an interactive shell.
const stripAnsi = (s: string) =>
  s
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b[\\])/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '')

export class TerminalManager {
  private child: ChildProcess | null = null
  private pty: import('@lydell/node-pty').IPty | null = null
  private onDataCallback: ((data: string) => void) | null = null

  private kill(): void {
    this.pty?.kill()
    this.pty = null
    this.child?.kill()
    this.child = null
  }

  isAlive(): boolean {
    return !!(this.pty || this.child)
  }

  /** cwd: workspace folder; falls back to the app's own cwd. */
  spawnTerminal(cwd: string = process.cwd()): void {
    this.kill()
    const isWin = process.platform === 'win32'
    const shell = isWin ? 'powershell.exe' : process.env.SHELL || 'bash'
    const emit = (t: string) => this.onDataCallback?.(t)

    if (ptyLib) {
      try {
        const p = ptyLib.spawn(shell, [], {
          name: 'xterm-256color',
          cols: 120,
          rows: 30,
          cwd,
          env: process.env as Record<string, string>
        })
        p.onData((d) => emit(stripAnsi(d)))
        p.onExit(() => {
          if (this.pty === p) this.pty = null
        })
        this.pty = p
        return
      } catch {
        // fall through to child_process
      }
    }

    const c = spawn(shell, [], { env: process.env, cwd })
    const onChunk = (chunk: Buffer) => {
      const text = chunk.toString()
      emit(sanitizeTerminalOutput(text) || text)
    }
    c.stdout?.on('data', onChunk)
    c.stderr?.on('data', onChunk)
    c.on('exit', () => {
      if (this.child === c) this.child = null
    })
    this.child = c
  }

  write(data: string): void {
    if (this.pty) this.pty.write(data.replace(/\n/g, '\r'))
    else if (this.child?.stdin && !this.child.stdin.destroyed) this.child.stdin.write(data)
  }

  onOutput(callback: (data: string) => void): void {
    this.onDataCallback = callback
  }

  dispose(): void {
    this.kill()
  }
}

export const terminalManager = new TerminalManager()
