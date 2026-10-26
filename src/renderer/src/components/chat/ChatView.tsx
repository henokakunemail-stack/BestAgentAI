import React, { useRef, useEffect } from 'react'
import { ChatMessage, ArtifactData } from '../../types/desktop'
import { MessageItem } from './MessageItem'
import { Bot, Sparkles, Terminal, Code2 } from 'lucide-react'

interface ChatViewProps {
  messages: ChatMessage[]
  isStreaming: boolean
  onOpenArtifact?: (artifact: ArtifactData) => void
  onConfirmTool?: (callId: string, approved: boolean, always?: boolean) => void
  onAnswerInput?: (callId: string, answer: string) => void
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  isStreaming,
  onOpenArtifact,
  onConfirmTool,
  onAnswerInput
}) => {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-600 to-amber-400 p-0.5 mb-4 shadow-lg shadow-amber-500/10">
          <div className="w-full h-full bg-zinc-950 rounded-2xl flex items-center justify-center text-amber-500">
            <Bot className="w-6 h-6" />
          </div>
        </div>

        <h1 className="text-base font-semibold text-zinc-100">AI Desktop</h1>
        <p className="text-xs text-zinc-400 max-w-sm mt-1">
          Claude Code terminal execution, Antigravity multi-agent planning, Codex persistence, and any MCP server you connect.
        </p>

        <div className="grid grid-cols-2 gap-2 mt-6 max-w-md w-full text-left">
          <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-lg">
            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Claude Desktop UX</span>
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">
              Adaptive thinking, live tool streams, and interactive sandboxed artifacts.
            </p>
          </div>

          <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-lg">
            <div className="flex items-center gap-1.5 text-xs font-medium text-blue-400">
              <Terminal className="w-3.5 h-3.5" />
              <span>Claude Code & MCP</span>
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">
              Integrated PTY, RTK token compression, and MCP servers added from Settings.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto divide-y divide-zinc-800/40">
        {messages.map((msg) => (
          <MessageItem
            key={msg.id}
            message={msg}
            onOpenArtifact={onOpenArtifact}
            onConfirmTool={onConfirmTool}
            onAnswerInput={onAnswerInput}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
