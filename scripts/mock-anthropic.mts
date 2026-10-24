// Local Anthropic Messages API mock (SSE) for driving the agent loop without a key.
// Usage: npx tsx scripts/mock-anthropic.mts [port]   -> point settings: provider 9router, routerBaseUrl http://127.0.0.1:<port>
// Scenario = first word of the first user message (S429, SDROP, SMAX, SOVER, SCHAIN, S401, SIDLE, SIMG, SOK). Requests are appended to $MOCK_LOG.
import http from 'node:http'
import fs from 'node:fs'

const port = Number(process.argv[2]) || 20999
const log = process.env.MOCK_LOG || 'mock-requests.jsonl'
const hits = new Map<string, number>()
const sse = (res: http.ServerResponse, ev: string, data: unknown) => res.write(`event: ${ev}\ndata: ${JSON.stringify({ type: ev, ...(data as object) })}\n\n`)

function start(res: http.ServerResponse, usage = { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  sse(res, 'message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'mock', content: [], stop_reason: null, usage } })
}
function text(res: http.ServerResponse, idx: number, t: string) {
  sse(res, 'content_block_start', { index: idx, content_block: { type: 'text', text: '' } })
  sse(res, 'content_block_delta', { index: idx, delta: { type: 'text_delta', text: t } })
  sse(res, 'content_block_stop', { index: idx })
}
function tool(res: http.ServerResponse, idx: number, name: string, input: unknown) {
  sse(res, 'content_block_start', { index: idx, content_block: { type: 'tool_use', id: `toolu_${idx}${Date.now() % 1000}`, name, input: {} } })
  sse(res, 'content_block_delta', { index: idx, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } })
  sse(res, 'content_block_stop', { index: idx })
}
function end(res: http.ServerResponse, stop: string, out = 5) {
  sse(res, 'message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: out } })
  sse(res, 'message_stop', {})
  res.end()
}

http
  .createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let j: any = {}
      try { j = JSON.parse(body) } catch { /* not a messages call */ }
      if (!req.url?.includes('/messages')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ data: [{ id: 'mock' }] }))
      }
      const first = j.messages?.[0]
      const firstText = typeof first?.content === 'string' ? first.content : (first?.content?.find((b: any) => b.type === 'text')?.text ?? '')
      const scenario = firstText.trim().split(/\s+/)[0] || 'SOK'
      const n = (hits.get(scenario) ?? 0) + 1
      hits.set(scenario, n)
      const last = j.messages?.[j.messages.length - 1]
      const afterTool = Array.isArray(last?.content) && last.content.some((b: any) => b.type === 'tool_result')
      fs.appendFileSync(log, JSON.stringify({ t: Date.now(), scenario, n, afterTool, stream: j.stream, max_tokens: j.max_tokens, tools: (j.tools ?? []).map((t: any) => t.name), cacheMarks: JSON.stringify(j).split('cache_control').length - 1, lastHasCache: JSON.stringify(last).includes('cache_control'), messages: j.messages?.length }) + '\n')

      // Non-stream summary call (compaction)
      if (j.stream !== true) {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ id: 'msg_s', type: 'message', role: 'assistant', model: 'mock', content: [{ type: 'text', text: '<summary>mock summary</summary>' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } }))
      }

      if (scenario === 'S401') {
        res.writeHead(401, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }))
      }
      if (scenario === 'S429' && n === 1) {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' })
        return res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }))
      }
      if (scenario === 'SOVER' && !hits.get('SOVER_FIRED') && (j.messages?.length ?? 0) >= 8) {
        hits.set('SOVER_FIRED', 1)
        res.writeHead(400, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long: 250000 tokens > 200000 maximum' } }))
      }
      if (scenario === 'SDROP' && n === 1) {
        start(res)
        text(res, 0, 'PARTIAL-TEXT-')
        return setTimeout(() => res.socket?.destroy(), 100)
      }
      if (scenario === 'SHANG') {
        start(res)
        return // hangs forever
      }
      if (scenario === 'SIDLE' && n === 1) {
        start(res)
        return // never finishes: idle watchdog must fire
      }
      start(res, { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 })
      if (scenario === 'SMAX' && !afterTool && n === 1) {
        sse(res, 'content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_cut', name: 'builtin__write_file', input: {} } })
        sse(res, 'content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"x.txt","content":"abc' } })
        return end(res, 'max_tokens', 16000)
      }
      if (scenario === 'SCHAIN' && !afterTool) {
        tool(res, 0, 'builtin__bash', { command: 'git status && echo hi' })
        return end(res, 'tool_use')
      }
      if (scenario === 'SSINGLE' && !afterTool) {
        tool(res, 0, 'builtin__bash', { command: 'git status' })
        return end(res, 'tool_use')
      }
      if (scenario === 'SLOOP') {
        tool(res, 0, 'builtin__update_plan', { plan: [{ step: 'x', status: 'in_progress' }] })
        return end(res, 'tool_use')
      }
      text(res, 0, `OK-${scenario}-${n}`)
      end(res, 'end_turn')
    })
  })
  .listen(port, '127.0.0.1', () => console.log(`mock-anthropic on ${port}`))
