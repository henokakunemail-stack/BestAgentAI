import React from 'react'
import { Bot, User, Code, Play } from 'lucide-react'
import { ChatMessage, ArtifactData } from '../../types/desktop'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallBlock } from './ToolCallBlock'

interface MessageItemProps {
  message: ChatMessage
  onOpenArtifact?: (artifact: ArtifactData) => void
  onConfirmTool?: (callId: string, approved: boolean, always?: boolean) => void
  onAnswerInput?: (callId: string, answer: string) => void
}

export const MessageItem: React.FC<MessageItemProps> = ({ message, onOpenArtifact, onConfirmTool, onAnswerInput }) => {
  const isUser = message.role === 'user'

  // Extract HTML / SVG artifact if present
  const extractArtifact = (): ArtifactData | null => {
    const htmlMatch = message.content.match(/```(?:html|svg)[\s\S]*?```/i)
    if (htmlMatch) {
      const raw = htmlMatch[0]
      const clean = raw.replace(/^```(?:html|svg)\n?/i, '').replace(/```$/, '')
      const isSvg = raw.toLowerCase().startsWith('```svg') || clean.trim().startsWith('<svg')
      return {
        identifier: `art_${message.id}`,
        title: isSvg ? 'SVG Visual Artifact' : 'HTML Interactive Canvas',
        type: isSvg ? 'svg' : 'html',
        content: clean
      }
    }
    return null
  }

  const detectedArtifact = !isUser ? extractArtifact() : null

  return (
    <div className={`py-4 px-4 flex gap-3 ${isUser ? 'bg-zinc-900/30' : 'bg-transparent'}`}>
      <div className="flex-shrink-0 mt-0.5">
        {isUser ? (
          <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-300">
            <User className="w-3.5 h-3.5" />
          </div>
        ) : (
          <div className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-500">
            <Bot className="w-3.5 h-3.5" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        <div className="text-xs font-semibold text-zinc-300">
          {isUser ? 'You' : 'AI Desktop'}
        </div>

        {/* Thinking Block */}
        {message.thinking && <ThinkingBlock thinking={message.thinking} />}

        {/* Tool Call Blocks */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="space-y-2">
            {message.toolCalls
              .filter((tc) => !tc.parentCallId)
              .map((tc) => (
                <ToolCallBlock
                  key={tc.callId}
                  toolCall={tc}
                  nested={message.toolCalls!.filter((c) => c.parentCallId === tc.callId)}
                  onConfirm={onConfirmTool}
                  onAnswer={onAnswerInput}
                />
              ))}
          </div>
        )}

        {/* Message Text Content */}
        <div className="text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap font-sans selection:bg-amber-500/30">
          {message.content}
        </div>

        {/* Artifact Trigger Button */}
        {detectedArtifact && onOpenArtifact && (
          <div className="pt-2">
            <button
              onClick={() => onOpenArtifact(detectedArtifact)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 rounded-md text-xs font-medium transition-colors shadow-sm"
            >
              <Play className="w-3.5 h-3.5 text-amber-400" />
              <span>Preview Artifact: {detectedArtifact.title}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
