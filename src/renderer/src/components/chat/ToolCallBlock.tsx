import React, { useState } from 'react'
import { Wrench, CheckCircle, AlertCircle, Loader2, ShieldAlert } from 'lucide-react'
import { ToolCallUI } from '../../types/desktop'

interface ToolCallBlockProps {
  toolCall: ToolCallUI
  /** tool calls made by the subagent this call spawned */
  nested?: ToolCallUI[]
  onConfirm?: (callId: string, approved: boolean, always?: boolean) => void
  /** request_user_input: send the user's answer back to the waiting run */
  onAnswer?: (callId: string, answer: string) => void
}

export const ToolCallBlock: React.FC<ToolCallBlockProps> = ({ toolCall, nested = [], onConfirm, onAnswer }) => {
  const [expanded, setExpanded] = useState(false)
  const [answer, setAnswer] = useState('')
  const isAsk = toolCall.status === 'pending_input'
  const ask = toolCall.input as { question?: string; options?: string[] } | undefined

  const isPlanApproval = /(^|__)exit_plan_mode$/.test(toolCall.toolName)
  const isSpawn = /(^|__)spawn_agent$/.test(toolCall.toolName)
  const isPending = toolCall.status === 'pending_approval'
  const isRunning = toolCall.status === 'running'
  const isSuccess = toolCall.status === 'success'
  const isError = toolCall.status === 'error'

  return (
    <div className="my-2 border border-zinc-800 bg-zinc-950/70 rounded-lg p-3 text-xs font-mono">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isPending || isAsk ? (
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <Wrench className="w-3.5 h-3.5 text-amber-500" />
          )}
          <span className="font-semibold text-zinc-200">{toolCall.toolName}</span>
          {isSpawn && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700/60 text-amber-400">
              {(toolCall.input as { agent_type?: string } | undefined)?.agent_type || 'subagent'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {isRunning && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />}
          {isSuccess && <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />}
          {isError && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
          <span className="text-zinc-500 capitalize text-[11px]">{toolCall.status.replace('_', ' ')}</span>
        </div>
      </div>

      {/* request_user_input: the agent asks, the user answers */}
      {isAsk && onAnswer && (
        <div className="mt-2 p-2.5 bg-amber-500/10 border border-amber-500/20 rounded space-y-2">
          <div className="text-[12px] text-amber-200 font-sans whitespace-pre-wrap">{ask?.question}</div>
          {ask?.options && ask.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {ask.options.map((o) => (
                <button key={o} onClick={() => onAnswer(toolCall.callId, o)} className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[11px] transition-colors">
                  {o}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (answer.trim()) onAnswer(toolCall.callId, answer.trim())
            }}
          >
            <input
              autoFocus
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Type your answer"
              className="flex-1 bg-zinc-900 border border-zinc-700/80 rounded px-2 py-1 text-zinc-100 font-sans focus:outline-none focus:border-amber-500/60"
            />
            <button type="submit" className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded text-[11px]">
              Send
            </button>
          </form>
        </div>
      )}

      {/* Input arguments (plan approval shows the plan text itself) */}
      {!isAsk && (
      <pre className={`mt-2 p-2 bg-zinc-900/90 border border-zinc-800/80 rounded text-zinc-300 text-[11px] ${isPlanApproval ? 'whitespace-pre-wrap max-h-96 overflow-y-auto' : 'overflow-x-auto'}`}>
        {isPlanApproval
          ? String((toolCall.input as { plan?: string } | undefined)?.plan ?? '')
          : typeof toolCall.input === 'string'
            ? toolCall.input
            : JSON.stringify(toolCall.input, null, 2)}
      </pre>
      )}

      {/* Subagent tool calls */}
      {nested.length > 0 && (
        <div className="mt-2 ml-2 pl-3 border-l border-zinc-800">
          {nested.map((tc) => (
            <ToolCallBlock key={tc.callId} toolCall={tc} onConfirm={onConfirm} onAnswer={onAnswer} />
          ))}
        </div>
      )}

      {/* Permission Gate approval buttons */}
      {isPending && onConfirm && (
        <div className="mt-2.5 p-2 bg-amber-500/10 border border-amber-500/20 rounded flex items-center justify-between">
          <span className="text-[11px] text-amber-300 font-sans">{isPlanApproval ? 'Approve this plan to start editing' : toolCall.note || 'Action requires authorization'}</span>
          <div className="flex gap-2">
            <button
              onClick={() => onConfirm(toolCall.callId, false)}
              className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[11px] transition-colors"
            >
              {isPlanApproval ? 'Revise' : 'Deny'}
            </button>
            {!isPlanApproval && toolCall.canAlways !== false && (
              <button
                onClick={() => onConfirm(toolCall.callId, true, true)}
                className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[11px] transition-colors"
              >
                Always allow
              </button>
            )}
            <button
              onClick={() => onConfirm(toolCall.callId, true)}
              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded text-[11px] transition-colors shadow-sm"
            >
              {isPlanApproval ? 'Approve plan' : 'Authorize'}
            </button>
          </div>
        </div>
      )}

      {/* Output toggle */}
      {toolCall.output && (
        <div className="mt-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-amber-500/90 hover:text-amber-400 text-[11px] underline"
          >
            {expanded ? 'Hide output' : 'Show output'}
          </button>
          {expanded && (
            <pre className="mt-1.5 p-2 bg-zinc-900/80 border border-zinc-800/60 rounded text-zinc-400 overflow-x-auto max-h-48 text-[11px] leading-relaxed">
              {toolCall.output}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
