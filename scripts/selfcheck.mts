// Run: npx tsx scripts/selfcheck.mts   (assert-based, no framework)
import assert from 'node:assert/strict'
import { parsePatch, applyChunks } from '../src/main/agent/applyPatch.ts'
import { extractSummary, safeSplit, capToolResult } from '../src/main/agent/compactor.ts'

// patch parse + apply (CRLF preserved)
const ops = parsePatch(`*** Begin Patch
*** Update File: a.ts
@@ function f() {
-  return 1
+  return 2
*** End Patch`)
assert.equal(ops[0].kind, 'update')
const out = applyChunks('x\r\nfunction f() {\r\n  return 1\r\n}\r\n', (ops[0] as any).chunks, 'a.ts')
assert.equal(out, 'x\r\nfunction f() {\r\n  return 2\r\n}\r\n')
assert.throws(() => parsePatch('bad'), /Begin Patch/)
assert.throws(() => parsePatch('*** Begin Patch\n*** Nope: x\n*** End Patch'), /not a valid hunk header/)
assert.throws(() => applyChunks('a', [{ lines: ['-zzz', '+y'] }], 'f'), /could not locate/)
assert.throws(() => applyChunks('a', [{ lines: [' a'] }], 'f'), /no-op/)

// compactor
assert.equal(extractSummary('<analysis>x</analysis><summary> hi </summary>'), 'hi')
const msgs: any[] = [
  { role: 'user', content: 'a' }, { role: 'assistant', content: [{ type: 'tool_use', id: '1', name: 'n', input: {} }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: '1', content: 'r' }] },
  { role: 'assistant', content: 'done' }, { role: 'user', content: 'next' }
]
assert.equal(safeSplit(msgs, 3), 4) // never starts tail on an orphan tool_result
assert.ok(capToolResult('x'.repeat(50000)).length < 21000)
// file tools
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileTool, writeFileTool, editFileTool, globTool, grepTool, bashTool, globToRegExp, resolveInWorkspace } from '../src/main/agent/fileTools.ts'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'selfcheck-'))
await writeFileTool(root, { path: 'src/a.ts', content: 'const a = 1\nconst b = 1\n' })
await writeFileTool(root, { path: 'src/a.ts', content: 'const a = 1\nconst b = 1\n' }) // overwrite ok after own write
await assert.rejects(editFileTool(root, { path: 'src/a.ts', old_string: '= 1', new_string: '= 2' }), /matches 2 places/)
await editFileTool(root, { path: 'src/a.ts', old_string: '= 1', new_string: '= $&', replace_all: true })
assert.equal(await fs.readFile(path.join(root, 'src/a.ts'), 'utf8'), 'const a = $&\nconst b = $&\n')
await fs.writeFile(path.join(root, 'src/a.ts'), 'changed externally\n')
await assert.rejects(editFileTool(root, { path: 'src/a.ts', old_string: 'changed', new_string: 'x' }), /changed since/)
assert.match(await readFileTool(root, { path: 'src/a.ts' }), /1\tchanged externally/)
assert.equal(await globTool(root, { pattern: '**/*.ts' }), 'src/a.ts')
assert.match(await grepTool(root, { pattern: 'EXTERNAL', ignore_case: true }), /^src\/a\.ts:1:/)
assert.ok(globToRegExp('src/**/*.{ts,tsx}').test('src/x/y.tsx') && !globToRegExp('*.ts').test('a/b.ts'))
assert.throws(() => resolveInWorkspace(root, '../x', { mustBeInside: true }), /outside the workspace/)
assert.match(await bashTool(root, { command: 'echo hi' }), /hi[\s\S]*exit code 0/)
assert.match(await bashTool(root, { command: 'node -e "setTimeout(()=>{},9000)"', timeout_ms: 1000 }), /timed out/)
await fs.rm(root, { recursive: true, force: true })

// skill frontmatter (nested metadata block must not leak into top-level keys)
import { parseFrontmatter } from '../src/main/agent/skillsLoader.ts'
const fm = parseFrontmatter('---\nname: automation\ndescription: "Do cron things."\nmetadata:\n  icon: schedule\n---\n# Body\n')
assert.deepEqual(fm.meta, { name: 'automation', description: 'Do cron things.', metadata: '' })
assert.equal(fm.body, '# Body\n')
assert.deepEqual(parseFrontmatter('no frontmatter').meta, {})

// slash commands + cost + compaction token accounting
import { parseSlash, isBuiltin, expandCustomCommand, estimateCost } from '../src/main/agent/slashCommands.ts'
import { currentTokens, shouldCompact } from '../src/main/agent/compactor.ts'
assert.deepEqual(parseSlash('/compact  keep the API notes'), { name: 'compact', args: 'keep the API notes' })
assert.equal(parseSlash('hello /compact'), null)
assert.ok(isBuiltin('plan') && !isBuiltin('deploy'))
assert.equal(await expandCustomCommand('..', '', root), null)
const cmdRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cmd-'))
await fs.mkdir(path.join(cmdRoot, '.claude', 'commands'), { recursive: true })
await fs.writeFile(path.join(cmdRoot, '.claude', 'commands', 'fix.md'), '---\ndescription: x\n---\nFix issue: $ARGUMENTS now\n')
assert.equal(await expandCustomCommand('fix', '#12', cmdRoot), 'Fix issue: #12 now\n')
await fs.rm(cmdRoot, { recursive: true, force: true })
assert.equal(estimateCost('claude-opus-5-5', { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }), 15)
assert.equal(estimateCost('gpt-x', { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }), null)
const two: any[] = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]
assert.ok(currentTokens(two, { tokens: 1000, len: 2 }) <= 1001) // API figure used when nothing was appended (+1 for the empty "[]" tail)
assert.ok(currentTokens([...two, { role: 'user', content: 'x'.repeat(3500) }], { tokens: 1000, len: 2 }) > 2000)
assert.ok(shouldCompact(160_000) && !shouldCompact(159_999) && shouldCompact(80_000, 100_000))

// permission policy (pure; the gate itself imports electron via storage/db.ts and is not covered)
import { decide, ruleKey, isWriteLike } from '../src/main/mcp/permissionPolicy.ts'
const none = { allow: [], deny: [] }
assert.equal(decide('plan', 'write_file', 'write_file', none), 'deny')
assert.equal(decide('plan', 'read_file', 'read_file', none), 'allow')
assert.equal(decide('plan', 'skill', 'skill', none), 'allow') // bookkeeping stays usable in plan mode
assert.equal(decide('default', 'bash', 'bash:ls', none), 'ask')
assert.equal(decide('default', 'bash', 'bash:ls', { allow: ['bash:ls'], deny: [] }), 'allow')
assert.equal(decide('bypass', 'bash', 'bash:rm', { allow: [], deny: ['bash:rm'] }), 'deny') // deny beats bypass
assert.equal(decide('acceptEdits', 'edit_file', 'edit_file', none), 'allow')
assert.equal(decide('acceptEdits', 'bash', 'bash', none), 'ask')
assert.equal(decide('plan', 'exit_plan_mode', 'exit_plan_mode', { allow: ['exit_plan_mode'], deny: [] }), 'ask') // allow rule cannot skip approval
assert.equal(decide('default', 'exit_plan_mode', 'exit_plan_mode', none), 'deny')
assert.equal(decide('default', 'bash_kill', 'bash_kill', none), 'ask')
assert.equal(decide('default', 'bash_input', 'bash_input', none), 'ask')
assert.equal(decide('plan', 'bash_output', 'bash_output', none), 'allow')
assert.equal(decide('dontAsk', 'bash', 'bash:ls', none), 'deny')
assert.equal(decide('dontAsk', 'bash', 'bash:ls', { allow: ['bash:ls'], deny: [] }), 'allow')
assert.equal(decide('dontAsk', 'read_file', 'read_file', none), 'allow')
assert.equal(decide('dontAsk', 'edit_file', 'edit_file', none), 'deny')
assert.equal(decide('dontAsk', 'exit_plan_mode', 'exit_plan_mode', none), 'deny')
assert.equal(ruleKey('bash', { command: '  git status' }), 'bash:git')
assert.ok(isWriteLike('builtin__edit_file') && !isWriteLike('builtin__read_file'))
// chain-aware keys: an allow rule for one program must not cover a chain that runs another
import { splitCommand, ruleKeys } from '../src/main/mcp/permissionPolicy.ts'
const k = (c: string) => ruleKeys('bash', { command: c })
const gitOnly = { allow: ['bash:git'], deny: [] }
assert.deepEqual(k('git status'), ['bash:git'])
assert.deepEqual(k('git status && rm x'), ['bash:git', 'bash:rm'])
assert.equal(decide('default', 'bash', k('git status'), gitOnly), 'allow')
assert.equal(decide('default', 'bash', k('git status && rm x'), gitOnly), 'ask')
assert.equal(decide('default', 'bash', k('git status && git log'), gitOnly), 'allow') // same program twice
assert.equal(decide('default', 'bash', k('git $(rm x)'), gitOnly), 'ask')
assert.deepEqual(k('git $(rm x)'), [])
assert.deepEqual(k('git `rm x`'), [])
assert.deepEqual(k('git status > out.txt'), []) // file redirect = write
assert.deepEqual(k('git status 2>&1'), ['bash:git'])
assert.deepEqual(k('git log >/dev/null'), ['bash:git'])
assert.deepEqual(splitCommand('a | b'), ['a', 'b'])
assert.deepEqual(splitCommand('a; b'), ['a', 'b'])
assert.deepEqual(splitCommand('a || b'), ['a', 'b'])
assert.deepEqual(splitCommand('a & b'), ['a', 'b'])
assert.deepEqual(splitCommand('a\nb'), ['a', 'b'])
assert.deepEqual(splitCommand('echo "a && b"'), ['echo "a && b"']) // operators inside quotes are data
assert.equal(splitCommand('echo "unterminated'), null)
assert.equal(splitCommand('echo "$(rm x)"'), null) // substitution runs inside double quotes
assert.deepEqual(splitCommand("echo '$(not run)'"), ["echo '$(not run)'"]) // single quotes: literal
assert.deepEqual(k('FOO=1 git log'), []) // env prefix changes behaviour: always ask
assert.deepEqual(k(''), [])
assert.deepEqual(ruleKeys('read_file', { path: 'x' }), ['read_file'])
assert.equal(decide('default', 'bash', k('git x && rm y'), { allow: ['bash:git'], deny: ['bash:rm'] }), 'deny')
assert.equal(decide('bypass', 'bash', k('git x && rm y'), { allow: [], deny: ['bash:rm'] }), 'deny')
assert.equal(decide('default', 'mcp_tool', ['mcp_tool'], { allow: ['mcp__a__mcp_tool'], deny: [] }, 'mcp__a__mcp_tool'), 'allow')
assert.equal(decide('default', 'mcp_tool', ['mcp_tool'], { allow: ['mcp__a__mcp_tool'], deny: [] }, 'mcp__b__mcp_tool'), 'ask') // other server: no shared rule
assert.equal(decide('default', 'spawn_agent', ['spawn_agent'], none), 'allow') // bookkeeping, not read-only
assert.ok(!isWriteLike('spawn_agent'))

// frontmatter lists + agents loader
import { parseList } from '../src/main/agent/skillsLoader.ts'
import { loadAgents, mapTools, mapToolName } from '../src/main/agent/agentsLoader.ts'
assert.deepEqual(parseList('[Read, "Grep"]'), ['Read', 'Grep'])
assert.deepEqual(parseFrontmatter('---\ntools:\n  - Read\n  - Grep\nname: x\n---\n').meta, { tools: 'Read, Grep', name: 'x' })
assert.equal(mapToolName('mcp__rea__open_binary'), 'rea__open_binary')
assert.deepEqual(mapTools(['Read', 'Edit', 'MultiEdit', 'Task', 'exit_plan_mode']).sort(), ['builtin__edit_file', 'builtin__read_file', 'builtin__spawn_agent'].sort()) // exit_plan_mode is never whitelisted
assert.ok(!mapTools(['ExitPlanMode']).includes('builtin__exit_plan_mode'))
const agRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-'))
await fs.mkdir(path.join(agRoot, '.claude', 'agents'), { recursive: true })
await fs.writeFile(path.join(agRoot, '.claude', 'agents', 'reader.md'), '---\nname: selfcheck-reader\ndescription: Reads code\ntools: Read, Grep\nmodel: sonnet\n---\nYou only read.\n')
await fs.writeFile(path.join(agRoot, '.claude', 'agents', 'free.md'), '---\nname: selfcheck-free\ndescription: Anything\n---\nBody\n')
const agents = await loadAgents(agRoot)
const rd = agents.find((a) => a.name === 'selfcheck-reader')!
assert.deepEqual(rd.tools, ['builtin__read_file', 'builtin__grep'])
assert.equal(rd.model, 'sonnet')
assert.equal(rd.prompt, 'You only read.')
assert.equal(agents.find((a) => a.name === 'selfcheck-free')!.tools, undefined) // no tools line = inherit all
await fs.rm(agRoot, { recursive: true, force: true })

// hooks: block, additionalContext, payload cannot overwrite hook_event_name, cwd, matcher targets, timeout kills the tree
import { runHooksWithConfig, validateHookConfig } from '../src/main/agent/hooks.ts'
const hk = await fs.mkdtemp(path.join(os.tmpdir(), 'hooks-'))
const node = (code: string) => `node -e "${code.replace(/"/g, '\\"')}"`
assert.equal((await runHooksWithConfig({ PreToolUse: [{ command: node('process.stderr.write(`no`);process.exit(2)') }] }, 'PreToolUse', 'bash', {})).blocked, true)
const ctxOut = await runHooksWithConfig(
  { SessionStart: [{ matcher: 'startup', command: node('let d=\'\';process.stdin.on(`data`,c=>d+=c).on(`end`,()=>{const j=JSON.parse(d);console.log(JSON.stringify({hookSpecificOutput:{additionalContext:[j.hook_event_name,j.source,j.session_id,process.cwd()===require(`fs`).realpathSync(j.cwd)].join(`|`)}}))})') }] },
  'SessionStart', '', { source: 'startup', hook_event_name: 'EVIL' }, { sessionId: 's1', cwd: hk }
)
assert.equal(ctxOut.additionalContext, 'SessionStart|startup|s1|true')
assert.equal((await runHooksWithConfig({ SessionStart: [{ matcher: 'resume', command: node('process.exit(2)') }] }, 'SessionStart', '', { source: 'startup' })).blocked, false) // matcher tests `source`
const t0 = Date.now()
await runHooksWithConfig({ Stop: [{ command: node('setTimeout(()=>{},20000)'), timeoutMs: 700 }] }, 'Stop', '', {})
assert.ok(Date.now() - t0 < 6000, 'timeout must end the hook')
assert.equal(validateHookConfig({ Stop: [{ command: 'x', matcher: '(' }] }) !== null, true)
// abort: kills the running hook and skips the rest
const hookAbort = new AbortController()
const ta = Date.now()
setTimeout(() => hookAbort.abort(), 300)
await runHooksWithConfig({ Stop: [{ command: node('setTimeout(()=>{},20000)' ) }, { command: node('process.exit(2)') }] }, 'Stop', '', {}, { signal: hookAbort.signal })
assert.ok(Date.now() - ta < 5000, 'abort must kill the hook')
const pre = new AbortController(); pre.abort()
assert.equal((await runHooksWithConfig({ Stop: [{ command: node('process.exit(2)') }] }, 'Stop', '', {}, { signal: pre.signal })).blocked, false) // already aborted: no hook runs
assert.equal(validateHookConfig({ Nope: [] }) !== null, true)
assert.equal(validateHookConfig({ Stop: [{ command: 'x' }] }), null)
await fs.rm(hk, { recursive: true, force: true })

// dangling tool_use is closed so the next API call cannot 400
import { closeDanglingToolUse } from '../src/main/agent/compactor.ts'
import { resolveModelAlias } from '../src/main/agent/agentsLoader.ts'
const dangling: any[] = [{ role: 'user', content: 'x' }, { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'n', input: {} }, { type: 'tool_use', id: 't2', name: 'n', input: {} }] }]
closeDanglingToolUse(dangling)
assert.deepEqual(dangling[2].content.map((b: any) => b.tool_use_id), ['t1', 't2'])
const okHist: any[] = [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'hi' }]
closeDanglingToolUse(okHist)
assert.equal(okHist.length, 2)
assert.equal(resolveModelAlias('Sonnet'), 'claude-sonnet-5-5')
assert.equal(resolveModelAlias('claude-x'), 'claude-x')

// command listing: built-ins win over custom commands, commands over skills
import { listCommands, BUILTIN_COMMANDS } from '../src/main/agent/slashCommands.ts'
const lc = await fs.mkdtemp(path.join(os.tmpdir(), 'lc-'))
await fs.mkdir(path.join(lc, '.claude', 'commands'), { recursive: true })
await fs.writeFile(path.join(lc, '.claude', 'commands', 'ship.md'), '---\ndescription: Ship it\n---\nbody')
await fs.writeFile(path.join(lc, '.claude', 'commands', 'clear.md'), 'shadowed')
const cl = await listCommands(lc, [{ name: 'ship', description: 'skill ship' }, { name: 'zz', description: 'a skill' }])
assert.equal(cl.filter((c) => c.name === 'clear').length, 1)
assert.equal(cl.find((c) => c.name === 'clear')!.kind, 'builtin')
assert.deepEqual(cl.find((c) => c.name === 'ship'), { name: 'ship', description: 'Ship it', kind: 'command' })
assert.equal(cl.find((c) => c.name === 'zz')!.kind, 'skill')
assert.ok(['permissions', 'mcp', 'agents'].every((n) => BUILTIN_COMMANDS.includes(n as any)))
await fs.rm(lc, { recursive: true, force: true })

// trust: exact or parent match only; sibling with shared prefix is not trusted
import { isTrusted } from '../src/main/agent/trust.ts'
const tr = path.join(os.tmpdir(), 'proj')
assert.ok(isTrusted([tr], tr) && isTrusted([tr + path.sep], path.join(tr, 'sub')))
assert.ok(!isTrusted([tr], tr + '-evil') && !isTrusted([], tr))

// checkpoints: snapshot once per turn, restore newest-first so the earliest snapshot wins, new files are removed
import { beginTurn, snapshot, listTurns, restore, writeTargets } from '../src/main/agent/checkpoints.ts'
const cpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cp-'))
const cpDir = path.join(cpRoot, '.cp')
const fa = path.join(cpRoot, 'a.txt')
const fnew = path.join(cpRoot, 'sub', 'new.txt')
await fs.writeFile(fa, 'v0')
await beginTurn(cpDir, 's', 0, 'first')
await snapshot(cpDir, 's', 0, [fa, fnew])
await fs.writeFile(fa, 'v1'); await fs.mkdir(path.dirname(fnew)); await fs.writeFile(fnew, 'x')
await beginTurn(cpDir, 's', 2, 'second')
await snapshot(cpDir, 's', 2, [fa])
await snapshot(cpDir, 's', 2, [fa]) // second call in the same turn keeps the first snapshot
await fs.writeFile(fa, 'v2')
assert.deepEqual((await listTurns(cpDir, 's')).map((t) => [t.turn, t.preview, t.files]), [[0, 'first', 2], [2, 'second', 1]])
await restore(cpDir, 's', [2])
assert.equal(await fs.readFile(fa, 'utf8'), 'v1')
await restore(cpDir, 's', [0])
assert.equal(await fs.readFile(fa, 'utf8'), 'v0')
assert.equal(await fs.stat(fnew).then(() => true, () => false), false)
assert.equal((await listTurns(cpDir, 's')).length, 0)
assert.deepEqual(writeTargets('write_file', { path: 'a.txt' }, cpRoot), [fa])
assert.deepEqual(writeTargets('write_file', { path: '../x' }, cpRoot), []) // outside workspace: the tool itself rejects it
assert.deepEqual(writeTargets('apply_patch', { patch: '*** Begin Patch\n*** Add File: n.txt\n+x\n*** End Patch' }, cpRoot), [path.join(cpRoot, 'n.txt')])
assert.deepEqual(writeTargets('read_file', { path: 'a.txt' }, cpRoot), [])
await fs.rm(cpRoot, { recursive: true, force: true })

// background jobs: incremental reads, stdin, kill tree, owner isolation, cleanup on run end
import { startJob, readJob, writeJob, killJob, killOwner, killAllJobs } from '../src/main/agent/bgJobs.ts'
const waitFor = async (f: () => boolean, ms = 8000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('waitFor timeout'); await new Promise((r) => setTimeout(r, 50)) } }
const jid = startJob('run1', os.tmpdir(), 'node -e "console.log(`one`);setTimeout(()=>console.log(`two`),400);setTimeout(()=>{},1500)"')
await waitFor(() => readJob('run1', jid).includes('one'))
const r1 = readJob('run1', jid)
const next = Number(/next=(\d+)/.exec(r1)![1])
await waitFor(() => readJob('run1', jid, next).includes('two'))
assert.ok(!readJob('run1', jid, next).includes('one')) // since= returns only new output
await waitFor(() => /exited with code 0/.test(readJob('run1', jid, next)))
assert.throws(() => readJob('run2', jid), /No such background job/) // other runs cannot see it
const echo = startJob('run1', os.tmpdir(), 'node -e "process.stdin.on(`data`,d=>console.log(`got:`+d))"')
writeJob('run1', echo, 'hi\n')
await waitFor(() => readJob('run1', echo).includes('got:hi'))
assert.match(killJob('run1', echo), /Killed/)
await waitFor(() => /exited/.test(readJob('run1', echo)))
const sleeper = startJob('run3', os.tmpdir(), 'node -e "setTimeout(()=>{},30000)"')
killOwner('run3')
assert.throws(() => readJob('run3', sleeper), /No such background job/)
killAllJobs()

// attachments: @file -> <file> block, image -> base64 block, outside-workspace / missing / binary stay plain text
import { buildUserContent, textOf } from '../src/main/agent/attachments.ts'
const adir = await fs.mkdtemp(path.join(os.tmpdir(), 'att-'))
await fs.writeFile(path.join(adir, 'a.txt'), 'hello')
await fs.writeFile(path.join(adir, 'p.png'), Buffer.from([1, 2, 3]))
await fs.writeFile(path.join(adir, 'b.bin'), Buffer.from([0, 1, 2]))
const ac = (await buildUserContent('see @a.txt and @p.png', adir)) as any[]
assert.equal(ac[0].text, 'see @a.txt and @p.png')
assert.match(ac[1].text, /<file path="a.txt">\nhello\n<\/file>/)
assert.equal(ac[3].source.data, Buffer.from([1, 2, 3]).toString('base64'))
assert.equal(textOf(ac), 'see @a.txt and @p.png<file path="a.txt">\nhello\n</file><file path="p.png" type="image">')
for (const p of ['mail me@x.com', '@nope.txt', '@b.bin', '@../outside.txt']) assert.equal(await buildUserContent(p, adir), p)

// MCP transport spec: stdio default, url -> http, sse explicit, bad urls rejected
import { transportSpec } from '../src/main/mcp/mcpConfig.ts'
assert.equal(transportSpec({ command: 'npx', args: ['x'] }).kind, 'stdio')
assert.equal(transportSpec({ url: 'https://a.b/mcp', headers: { Authorization: 'x' } }).kind, 'http')
assert.equal(transportSpec({ type: 'sse', url: 'http://localhost:1/sse' }).kind, 'sse')
assert.throws(() => transportSpec({ url: 'file:///etc/passwd' }), /http\(s\)/)
assert.throws(() => transportSpec({ type: 'http' }), /valid "url"/)
assert.throws(() => transportSpec({}), /command/)

for (const ev of ['SessionEnd', 'PermissionRequest', 'PermissionDenied', 'Notification', 'StopFailure']) assert.equal(validateHookConfig({ [ev]: [{ command: 'x' }] }), null)

// ponytail: permissionGate (the class) is not covered; it imports electron via storage/db.ts. Add when db.ts gets a path injection point.

// providers: client factory
import { normalizeBaseUrl, clientConfig, parseModelIds, isLoopback } from '../src/main/agent/clientFactory.ts'
assert.equal(normalizeBaseUrl('http://localhost:20128/'), 'http://localhost:20128')
assert.equal(normalizeBaseUrl('http://localhost:20128/v1'), 'http://localhost:20128')
assert.equal(normalizeBaseUrl('https://x.io/v1/'), 'https://x.io')
assert.throws(() => normalizeBaseUrl('ftp://x'), /http/)
assert.throws(() => normalizeBaseUrl('nope'), /invalid URL/)
const base = { provider: 'anthropic' as const, anthropicApiKey: '', routerBaseUrl: 'http://localhost:20128', routerApiKey: '' }
assert.ok('error' in clientConfig(base, {}))
assert.deepEqual(clientConfig({ ...base, anthropicApiKey: 'k' }, {}), { apiKey: 'k' })
assert.deepEqual(clientConfig(base, { ANTHROPIC_API_KEY: 'e' }), { apiKey: 'e' })
assert.deepEqual(clientConfig({ ...base, provider: '9router' }, {}), { apiKey: 'no-key', baseURL: 'http://localhost:20128' })
const bad = clientConfig({ ...base, provider: '9router', routerBaseUrl: 'ftp://x' }, {})
assert.ok('error' in bad && bad.error.startsWith('9router: '))
assert.deepEqual(parseModelIds({ data: [{ id: 'a' }, { id: 'b' }, {}] }), ['a', 'b'])
assert.deepEqual(parseModelIds(null), [])
assert.ok(isLoopback('http://127.0.0.1:1') && isLoopback('http://localhost') && !isLoopback('http://10.0.0.5'))

// phase A: trust boundary + atomic storage
import { isSessionId, validateSettingsPatch, maskSecrets, isSafeExternalUrl, SECRET_MASK } from '../src/main/ipc/validate.ts'
import { writeFileAtomic, readJsonFile, updateJsonFile, withLock } from '../src/main/storage/atomic.ts'
assert.ok(isSessionId('session_1700000000000_ab3x9'))
for (const bad of ['../data/settings', 'session_/../x', 'session_a.json', '', 'x', 42, null, 'session_' + 'a'.repeat(80)]) assert.ok(!isSessionId(bad), String(bad))
assert.ok(isSafeExternalUrl('https://x.io/a') && !isSafeExternalUrl('http://x.io') && !isSafeExternalUrl('file:///c:/x') && !isSafeExternalUrl('javascript:alert(1)') && !isSafeExternalUrl('nope'))
assert.deepEqual(validateSettingsPatch({ model: 'm', maxTurns: 5 }), { ok: true, patch: { model: 'm', maxTurns: 5 } })
for (const bad of [{ evil: 1 }, { permissionMode: 'root' }, { maxTurns: 0 }, { maxTurns: 1.5 }, { enableThinking: 'yes' }, { provider: 'x' }, null, [], 'str'])
  assert.equal((validateSettingsPatch(bad) as any).ok, false, JSON.stringify(bad))
assert.deepEqual(validateSettingsPatch({ anthropicApiKey: SECRET_MASK, routerApiKey: 'k' }), { ok: true, patch: { routerApiKey: 'k' } })
assert.deepEqual(maskSecrets({ anthropicApiKey: 'sk-1', routerApiKey: '', model: 'm' }), { anthropicApiKey: SECRET_MASK, routerApiKey: '', model: 'm' })
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-'))
  const f = path.join(dir, 'a.json')
  assert.deepEqual(await readJsonFile(f), {})
  await writeFileAtomic(f, JSON.stringify({ v: 1 }))
  await writeFileAtomic(f, JSON.stringify({ v: 2 }))
  assert.equal((await readJsonFile<any>(f)).value.v, 2)
  await fs.writeFile(f, '{truncated') // simulated crash mid-write: falls back to the last good .bak
  assert.equal((await readJsonFile<any>(f)).value.v, 1)
  await fs.writeFile(`${f}.bak`, 'garbage')
  assert.ok((await readJsonFile(f)).corrupt)
  // concurrent read-modify-write must not lose updates
  const g = path.join(dir, 'n.json')
  await Promise.all(Array.from({ length: 25 }, () => updateJsonFile<number>(g, 0, (n) => n + 1)))
  assert.equal((await readJsonFile<number>(g)).value, 25)
  // a failing step must not poison the lock chain
  await assert.rejects(withLock('k', async () => { throw new Error('x') }))
  assert.equal(await withLock('k', async () => 7), 7)
  assert.ok(!(await fs.readdir(dir)).some((n) => n.endsWith('.tmp')))
  await fs.rm(dir, { recursive: true, force: true })
}

// retryPolicy: error classes, retry-after, stop_reason actions, MCP backoff
{
  const { classifyError, retryDelayMs, stopAction, backoffMs } = await import('../src/main/agent/retryPolicy.ts')
  for (const s of [408, 409, 429, 500, 503, 529]) assert.equal(classifyError({ status: s, message: 'x' }), 'retry', `status ${s}`)
  for (const s of [401, 403, 404, 422]) assert.equal(classifyError({ status: s, message: 'x' }), 'fatal', `status ${s}`)
  assert.equal(classifyError({ status: 400, message: 'prompt is too long: 250000 tokens > 200000 maximum' }), 'overflow')
  assert.equal(classifyError({ status: 400, message: 'invalid tool schema' }), 'fatal')
  assert.equal(classifyError({ code: 'ECONNRESET', message: 'read ECONNRESET' }), 'retry')
  assert.equal(classifyError({ cause: { code: 'UND_ERR_SOCKET' }, message: 'x' }), 'retry')
  assert.equal(classifyError(new TypeError('fetch failed')), 'retry')
  assert.equal(classifyError(new Error('Premature close')), 'retry') // socket destroyed mid-SSE
  assert.equal(classifyError({ name: 'StreamIdleError', message: 'x' }), 'retry')
  assert.equal(classifyError(new Error('boom')), 'fatal')
  const noJitter = () => 0
  assert.equal(retryDelayMs(0, {}, 0, noJitter), 1000)
  assert.equal(retryDelayMs(3, {}, 0, noJitter), 8000)
  assert.equal(retryDelayMs(9, {}, 0, noJitter), 15_000)
  assert.equal(retryDelayMs(0, { headers: { 'retry-after': '3' } }, 0, noJitter), 3000)
  assert.equal(retryDelayMs(0, { headers: { 'retry-after': '999' } }, 0, noJitter), 60_000)
  assert.equal(retryDelayMs(0, { headers: { 'retry-after-ms': '250' } }, 0, noJitter), 250)
  assert.equal(retryDelayMs(0, { headers: new Headers({ 'retry-after': new Date(5000).toUTCString() }) }, 1000, noJitter), 4000)
  assert.ok(retryDelayMs(0, {}, 0, () => 0.999) < 1300)
  assert.equal(stopAction('tool_use', true), 'tools')
  assert.equal(stopAction('end_turn', false), 'finish')
  assert.equal(stopAction(null, false), 'finish')
  assert.equal(stopAction('max_tokens', false), 'continue')
  assert.equal(stopAction('max_tokens', true), 'truncated_tool')
  assert.equal(stopAction('refusal', false), 'refusal')
  assert.equal(stopAction('pause_turn', false), 'resume')
  assert.equal(backoffMs(0, noJitter), 1000)
  assert.equal(backoffMs(10, noJitter), 30_000)
}

// B3: model limits, token estimate, cache breakpoint, aggregate cap, pruning
{
  const { limitsFor, initialMaxTokens, billableTokens } = await import('../src/main/agent/modelLimits.ts')
  const { estimateTokens, withCacheBreakpoint, capTurnResults, pruneOldToolResults } = await import('../src/main/agent/compactor.ts')
  assert.deepEqual(limitsFor('claude-opus-5-5'), { contextWindow: 200_000, maxOutput: 32_000 })
  assert.equal(limitsFor('gpt-4o').contextWindow, 128_000)
  assert.equal(limitsFor('gemini-2.5-pro').contextWindow, 1_000_000)
  assert.equal(limitsFor('mystery').maxOutput, 16_000)
  assert.equal(limitsFor('gpt-4o', 64_000).contextWindow, 64_000) // user override
  assert.equal(limitsFor('gpt-4o', 200_000).contextWindow, 128_000) // stored default is not an override
  assert.equal(initialMaxTokens(64_000), 16_000)
  assert.equal(initialMaxTokens(8_000), 8_000)
  assert.equal(billableTokens({ input: 10, output: 20, cacheRead: 1000, cacheWrite: 50 }), 180)

  const big = 'A'.repeat(5_000_000)
  const withImg: any[] = [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: big } }] }]
  assert.ok(estimateTokens(withImg) < 5_000)
  const viaTool: any[] = [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'image', source: { data: big } }] }] }]
  assert.ok(estimateTokens(viaTool) < 5_000)
  assert.ok(estimateTokens([{ role: 'user', content: 'x'.repeat(3500) }]) >= 1000)

  const msgs: any[] = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }]
  const before = JSON.stringify(msgs)
  const marked: any[] = withCacheBreakpoint(msgs)
  assert.equal(JSON.stringify(msgs), before) // input untouched
  assert.equal(JSON.stringify(marked).split('cache_control').length - 1, 1)
  assert.ok(marked[2].content[1].cache_control && !marked[2].content[0].cache_control)
  assert.equal((withCacheBreakpoint([{ role: 'user', content: 'plain' }]) as any)[0].content[0].cache_control.type, 'ephemeral')
  assert.deepEqual(withCacheBreakpoint([]), [])

  const rs: any[] = [
    { type: 'tool_result', tool_use_id: 'a', content: 'x'.repeat(50_000) },
    { type: 'tool_result', tool_use_id: 'b', content: 'y'.repeat(60_000) },
    { type: 'tool_result', tool_use_id: 'c', content: 'short' }
  ]
  const capped = capTurnResults(rs, 80_000)
  assert.deepEqual(capped.map((r) => r.tool_use_id), ['a', 'b', 'c'])
  assert.ok(capped.reduce((n, r) => n + String(r.content).length, 0) <= 80_000)
  assert.equal(capped[2].content, 'short')
  assert.equal(capTurnResults(rs.slice(2), 80_000)[0], rs[2]) // under budget: same objects

  const long = 'z'.repeat(5000)
  const hist: any[] = [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: long }] },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: 'again' }
  ]
  const pr: any[] = pruneOldToolResults(hist, 2)
  assert.equal(pr.length, hist.length)
  assert.equal(pr[2].content[0].tool_use_id, 't1')
  assert.match(pr[2].content[0].content, /elided: 5000 chars/)
  assert.equal(hist[2].content[0].content, long) // input untouched
  assert.equal(pruneOldToolResults(hist, 10)[2], hist[2]) // all recent: nothing changes
}

// ---- Fase F: install from GitHub
import { parseGithubUrl, isSafeSkillName, isInside, parseMcpSnippet, stableJson, maskConfig, githubCloneUrl } from '../src/main/install/githubSource.ts'
import { inspectSkillSource, installSkills, removeSkill, discard as discardInstall } from '../src/main/install/skillInstaller.ts'
import { execFileSync } from 'node:child_process'
{
  assert.deepEqual(parseGithubUrl('https://github.com/o/r'), { owner: 'o', repo: 'r' })
  assert.deepEqual(parseGithubUrl('https://github.com/o/r.git'), { owner: 'o', repo: 'r' })
  assert.deepEqual(parseGithubUrl('github.com/o/r/'), { owner: 'o', repo: 'r' })
  assert.deepEqual(parseGithubUrl('https://github.com/o/r/tree/main/skills/x'), { owner: 'o', repo: 'r', ref: 'main', subdir: 'skills/x' })
  assert.deepEqual(parseGithubUrl('https://github.com/o/r/tree/v1'), { owner: 'o', repo: 'r', ref: 'v1' })
  assert.deepEqual(parseGithubUrl('o/r/skills/x'), { owner: 'o', repo: 'r', subdir: 'skills/x' })
  for (const bad of ['', 'o', 'http://github.com/o/r', 'https://evil.com/o/r', 'https://github.com.evil.com/o/r', 'https://u:p@github.com/o/r',
    'https://github.com/o/../r', 'o/r/../x', 'file:///c:/x', 'git@github.com:o/r.git', 'o/r x', 'https://github.com:444/o/r', 'https://github.com/o/r/tree'])
    assert.equal(parseGithubUrl(bad), null, `should reject ${bad}`)
  assert.equal(githubCloneUrl({ owner: 'o', repo: 'r' }), 'https://github.com/o/r.git')

  assert.ok(isSafeSkillName('pdf-tools') && isSafeSkillName('a.b_c'))
  for (const bad of ['', '.', '..', '../x', 'a/b', 'a\\b', '-x', 'x'.repeat(65), 'a b']) assert.ok(!isSafeSkillName(bad), `should reject ${bad}`)
  assert.ok(isInside('/a/b', '/a/b/c') && !isInside('/a/b', '/a/b') && !isInside('/a/b', '/a/c') && !isInside('/a/b', '/a/b/../c'))

  const one = parseMcpSnippet('{"command":"npx","args":["-y","pkg"],"env":{"K":"v"}}', 'mine')
  assert.deepEqual(Object.keys(one), ['mine']); assert.deepEqual(one.mine.args, ['-y', 'pkg'])
  assert.deepEqual(Object.keys(parseMcpSnippet('{"mcpServers":{"a":{"command":"x"},"b":{"url":"https://h/mcp","type":"streamable-http"}}}')), ['a', 'b'])
  assert.equal(parseMcpSnippet('{"b":{"url":"https://h/mcp","type":"streamable-http"}}').b.type, 'http')
  assert.deepEqual(Object.keys(parseMcpSnippet('{"a":{"command":"x"}}')), ['a'])
  for (const bad of ['nope', '[]', '{}', '{"mcpServers":{}}', '{"a":{}}', '{"../x":{"command":"c"}}', '{"a":{"url":"ftp://h"}}', '{"a":5}'])
    assert.throws(() => parseMcpSnippet(bad), undefined, `should reject ${bad}`)
  assert.equal(stableJson({ b: 1, a: { d: 1, c: [2, { y: 1, x: 2 }] } }), stableJson({ a: { c: [2, { x: 2, y: 1 }], d: 1 }, b: 1 }))
  assert.notEqual(stableJson({ a: 1 }), stableJson({ a: 2 }))
  const masked = maskConfig({ command: 'x', env: { SECRET: 'tok' }, headers: { Authorization: 'Bearer z' } })
  assert.deepEqual(masked.env, ['SECRET']); assert.ok(!JSON.stringify(masked).includes('tok') && !JSON.stringify(masked).includes('Bearer'))

  // end to end with a local git repo (hook AI_INSTALL_ALLOW_FILE); skipped when git is missing
  let haveGit = true
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }) } catch { haveGit = false }
  if (haveGit) {
    process.env.AI_INSTALL_ALLOW_FILE = '1'
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'inst-check-'))
    const repo = path.join(base, 'src repo'), ws = path.join(base, 'ws')
    await fs.mkdir(path.join(repo, 'skills', 'demo', 'scripts'), { recursive: true })
    await fs.mkdir(path.join(repo, 'skills', 'bad'), { recursive: true })
    await fs.writeFile(path.join(repo, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: Demo skill\n---\nBody here\n')
    await fs.writeFile(path.join(repo, 'skills', 'demo', 'scripts', 'run.sh'), 'echo hi\n')
    await fs.writeFile(path.join(repo, 'skills', 'bad', 'SKILL.md'), '---\nname: ../evil\n---\nx\n')
    const git = (...a: string[]): void => { execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: repo, stdio: 'ignore' }) }
    git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'init')
    // a repo-wide scan hits the unsafe name and refuses the whole source
    await assert.rejects(() => inspectSkillSource(repo, ws), /not allowed/)
    await fs.rm(path.join(repo, 'skills', 'bad'), { recursive: true }); git('add', '-A'); git('commit', '-q', '-m', 'drop bad')
    const info = await inspectSkillSource(repo, ws)
    assert.equal(info.candidates.length, 1)
    const cand = info.candidates[0]
    assert.equal(cand.name, 'demo'); assert.ok(cand.hasScripts); assert.equal(cand.files, 2); assert.equal(cand.relPath, 'skills/demo')
    await assert.rejects(() => installSkills('0'.repeat(32), ['demo'], 'workspace', false, ws), /expired/) // unknown token
    await assert.rejects(() => installSkills(info.token, ['nope'], 'workspace', false, ws), /unknown skill/)
    await assert.rejects(() => installSkills(info.token, ['demo'], 'workspace', false, ws), /expired/) // token is single use even after a failure
    const info2 = await inspectSkillSource(repo, ws)
    assert.deepEqual(await installSkills(info2.token, ['demo'], 'workspace', false, ws), ['demo'])
    const dst = path.join(ws, '.ai-desktop', 'skills', 'demo')
    assert.ok((await fs.readFile(path.join(dst, 'SKILL.md'), 'utf-8')).includes('Body here'))
    assert.equal(JSON.parse(await fs.readFile(path.join(dst, '.source.json'), 'utf-8')).sha, info2.sha)
    assert.equal((await fs.readdir(dst)).includes('.git'), false)
    const info3 = await inspectSkillSource(repo, ws)
    await assert.rejects(() => installSkills(info3.token, ['demo'], 'workspace', false, ws), /already exists/)
    const info4 = await inspectSkillSource(repo, ws)
    assert.deepEqual(await installSkills(info4.token, ['demo'], 'workspace', true, ws), ['demo']) // overwrite an app-installed skill
    // a skill the user made by hand is never overwritten or removed
    await fs.mkdir(path.join(ws, '.ai-desktop', 'skills', 'mine'), { recursive: true })
    await fs.writeFile(path.join(ws, '.ai-desktop', 'skills', 'mine', 'SKILL.md'), 'x')
    assert.equal(await removeSkill('mine', ws), false)
    assert.equal(await removeSkill('demo', ws), true)
    await assert.rejects(() => fs.stat(dst))
    await assert.rejects(() => removeSkill('../x', ws), /bad skill name/)
    await assert.rejects(() => inspectSkillSource('https://example.com/o/r', ws), /only github.com/)
    const info5 = await inspectSkillSource(repo, ws); await discardInstall(info5.token)
    await assert.rejects(() => installSkills(info5.token, ['demo'], 'workspace', false, ws), /expired/)
    delete process.env.AI_INSTALL_ALLOW_FILE
    await assert.rejects(() => inspectSkillSource(repo, ws), /only github.com/) // local paths are off by default
    await fs.rm(base, { recursive: true, force: true })
  }
}

console.log('selfcheck ok')
