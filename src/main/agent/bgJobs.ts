// Background shell jobs (Antigravity command_status/send_command_input, Codex write_stdin).
// A job belongs to the run that started it and is killed when that run ends, is aborted, or the app quits.
import { spawn, spawnSync, execFile, type ChildProcess } from 'node:child_process'

const CAP = 200 * 1024 // ring buffer: newest 200 KB per job
const MAX_JOBS_PER_OWNER = 8
const MAX_READ = 30_000

interface Job {
  id: string
  owner: string
  command: string
  child: ChildProcess
  buf: string
  total: number // chars ever produced; buf holds the last buf.length of them
  exit: number | null | undefined // undefined = still running
}

const jobs = new Map<string, Job>()
let seq = 0

const killTree = (child: ChildProcess, sync = false): void => {
  if (!child.pid || child.exitCode !== null) return
  // shell:true on Windows spawns cmd.exe; taskkill /T takes the whole tree
  if (process.platform === 'win32') {
    if (sync) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    else execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
  } else child.kill('SIGKILL') // ponytail: kills the shell only; grandchildren survive on POSIX. Spawn detached + kill(-pid) when POSIX is a target.
}

export function startJob(owner: string, cwd: string, command: string): string {
  if ([...jobs.values()].filter((j) => j.owner === owner && j.exit === undefined).length >= MAX_JOBS_PER_OWNER) {
    throw new Error(`Too many running background jobs (max ${MAX_JOBS_PER_OWNER}). Kill one first.`)
  }
  const child = spawn(command, { cwd, shell: true, windowsHide: true })
  const job: Job = { id: `job${++seq}`, owner, command, child, buf: '', total: 0, exit: undefined }
  const add = (d: string) => {
    job.total += d.length
    job.buf += d
    if (job.buf.length > CAP) job.buf = job.buf.slice(job.buf.length - CAP)
  }
  child.stdout!.setEncoding('utf8').on('data', add)
  child.stderr!.setEncoding('utf8').on('data', add)
  child.stdin!.on('error', () => {}) // EPIPE after the process exited
  child.on('error', (e) => { add(`\nspawn error: ${e.message}`); job.exit = null })
  child.on('close', (code) => { job.exit = code })
  jobs.set(job.id, job)
  return job.id
}

const get = (owner: string, id: string): Job => {
  const j = jobs.get(String(id))
  if (!j || j.owner !== owner) throw new Error(`No such background job: ${id}`)
  return j
}

/** `since` = the "next" value of the previous read (absolute char offset). Omit for everything still buffered. */
export function readJob(owner: string, id: string, since?: number): string {
  const j = get(owner, id)
  const start = j.total - j.buf.length
  const want = Number(since) || 0
  const from = Math.max(want, start)
  let text = j.buf.slice(from - start)
  const lost = since !== undefined && want < start ? `[output before offset ${start} was dropped from the buffer]\n` : ''
  let next = j.total
  if (text.length > MAX_READ) {
    text = text.slice(0, MAX_READ)
    next = from + MAX_READ // the rest is returned by the next read
  }
  const state = j.exit === undefined ? 'running' : `exited with code ${j.exit ?? 'null'}`
  return `${lost}${text}${text && !text.endsWith('\n') ? '\n' : ''}[${j.id} ${state}; next=${next}]`
}

export function writeJob(owner: string, id: string, text: string): string {
  const j = get(owner, id)
  if (j.exit !== undefined) throw new Error(`${id} already exited`)
  j.child.stdin!.write(text)
  return `Sent ${text.length} chars to ${id}.`
}

export function killJob(owner: string, id: string): string {
  const j = get(owner, id)
  if (j.exit !== undefined) return `${id} already exited with code ${j.exit ?? 'null'}.`
  killTree(j.child)
  return `Killed ${id}.`
}

/** Run end / abort: kill every job of this owner and forget it. */
export function killOwner(owner: string): void {
  for (const [id, j] of jobs) {
    if (j.owner !== owner) continue
    killTree(j.child)
    jobs.delete(id)
  }
}

/** App quit: synchronous so the process tree is dead before Electron exits. */
export function killAllJobs(): void {
  for (const j of jobs.values()) killTree(j.child, true)
  jobs.clear()
}

export const listJobs = (owner: string) => [...jobs.values()].filter((j) => j.owner === owner).map((j) => ({ id: j.id, command: j.command, running: j.exit === undefined }))
