import React, { useState, useEffect, useRef } from 'react'
import { TitleBar } from './components/layout/TitleBar'
import { Sidebar } from './components/layout/Sidebar'
import { ChatView } from './components/chat/ChatView'
import { ChatInput } from './components/chat/ChatInput'
import { PlanCard, PlanStep } from './components/chat/PlanCard'
import { ArtifactPanel } from './components/artifacts/ArtifactPanel'
import { TerminalPanel } from './components/terminal/TerminalPanel'
import { SettingsModal } from './components/settings/SettingsModal'
import { GoalsCard } from './components/codex/GoalsCard'
import { MemoryDrawer } from './components/codex/MemoryDrawer'
import { ChatMessage, ArtifactData, ToolCallUI } from './types/desktop'
import { StoredSession, CommandItem } from '../../preload/index.d'

type UsageInfo = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number | null }

/** Stored API messages -> displayable chat. Tool plumbing (tool_result-only turns, tool_use blocks) is dropped. */
function toDisplay(raw: any[]): ChatMessage[] {
  const out: ChatMessage[] = []
  raw.forEach((m, idx) => {
    const content =
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).slice(0, m.role === 'user' ? 1 : undefined).join('') // user: first block is what was typed, the rest are @file bodies
          : ''
    if (!content.trim()) return
    out.push({ id: `msg_${idx}`, role: m.role === 'assistant' ? 'assistant' : 'user', content })
  })
  return out
}

export const App: React.FC = () => {
  const [sessions, setSessions] = useState<StoredSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState<Record<string, boolean>>({}) // per session: switching sessions must not borrow another run's state
  const [permissionMode, setPermissionMode] = useState('default')
  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const [retryNote, setRetryNote] = useState('') // shown while the model call is being retried
  const [commands, setCommands] = useState<CommandItem[]>([])
  const [goalsTick, setGoalsTick] = useState(0)
  const [trust, setTrust] = useState<{ root: string; trusted: boolean } | null>(null)
  const isStreaming = !!streaming[activeSessionId]
  const setRun = (id: string, on: boolean) => setStreaming((p) => ({ ...p, [id]: on }))
  const [activeArtifact, setActiveArtifact] = useState<ArtifactData | null>(null)
  const [showTerminal, setShowTerminal] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showGoals, setShowGoals] = useState(false)
  const [showMemory, setShowMemory] = useState(false)
  const [modelName, setModelName] = useState('claude-opus-5-5')
  const [mcpCount, setMcpCount] = useState(0)
  const [plan, setPlan] = useState<PlanStep[]>([])
  const [planNote, setPlanNote] = useState<string | undefined>()
  const sendRef = useRef<(t: string) => void>(() => {})

  // Load sessions list
  const loadSessions = async () => {
    const list = await window.aiDesktop?.chat?.listSessions()
    if (list && list.length > 0) {
      setSessions(list)
      if (!activeSessionId) {
        selectSession(list[0].id)
      }
    } else {
      handleNewSession()
    }
  }

  const selectSession = async (id: string) => {
    setActiveSessionId(id)
    setPlan([])
    setUsage(null)
    setMessages(await loadHistory(id))
  }

  const loadHistory = async (id: string): Promise<ChatMessage[]> => {
    const sessionData = await window.aiDesktop?.chat?.getHistory(id)
    return sessionData?.messages ? toDisplay(sessionData.messages) : []
  }

  const refreshSettings = () =>
    window.aiDesktop?.settings?.get().then((s) => {
      if (s?.model) setModelName(s.model)
      if (s?.permissionMode) setPermissionMode(s.permissionMode)
    })

  const refreshCommands = () => window.aiDesktop?.commands?.list().then((l) => l && setCommands(l))
  const refreshTrust = () => window.aiDesktop?.trust?.get().then((t) => t && setTrust(t))
  const trustWorkspace = async () => {
    const t = await window.aiDesktop?.trust?.set(true)
    if (t) setTrust(t)
    refreshCommands()
  }

  const handleNewSession = async () => {
    const newId = await window.aiDesktop?.chat?.newSession()
    if (newId) {
      setActiveSessionId(newId)
      setPlan([])
      setMessages([])
      const list = await window.aiDesktop?.chat?.listSessions()
      if (list) setSessions(list)
    }
  }

  const handleDeleteSession = async (id: string) => {
    await window.aiDesktop?.chat?.deleteSession(id)
    const list = await window.aiDesktop?.chat?.listSessions()
    if (list) {
      setSessions(list)
      if (activeSessionId === id && list.length > 0) {
        selectSession(list[0].id)
      } else if (list.length === 0) {
        handleNewSession()
      }
    }
  }

  // Load settings & MCP status
  useEffect(() => {
    loadSessions()
    refreshSettings()
    refreshCommands()
    refreshTrust()
    window.aiDesktop?.mcp?.getStatus().then((list) => {
      if (list) setMcpCount(list.filter((s) => s.status === 'connected').length)
    })
  }, [])

  // Listen to IPC stream events
  useEffect(() => {
    const unsubscribe = window.aiDesktop?.chat?.onStream((event) => {
      const sid = event.sessionId
      if (event.type !== 'retrying' && event.type !== 'stream_reset') setRetryNote('')
      if (event.type === 'done' || event.type === 'aborted') {
        if (sid) setRun(sid, false)
        loadSessions()
        if (!sid || sid === activeSessionId) return
      }
      if (sid && sid !== activeSessionId) return // another session's stream: its history reloads when selected

      if (event.type === 'text') {
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last && last.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, content: last.content + (event.delta || '') }]
          }
          return [...prev, { id: `msg_${Date.now()}`, role: 'assistant', content: event.delta || '' }]
        })
      } else if (event.type === 'thinking') {
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last && last.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, thinking: (last.thinking || '') + (event.delta || '') }]
          }
          return [...prev, { id: `msg_${Date.now()}`, role: 'assistant', content: '', thinking: event.delta || '' }]
        })
      } else if (event.type === 'stream_reset') {
        // The model call is being retried: cut what the failed attempt streamed so the text is not doubled.
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (!last || last.role !== 'assistant') return prev
          const cut = (s: string | undefined, n: number | undefined) => (s && n ? s.slice(0, Math.max(0, s.length - n)) : s)
          return [...prev.slice(0, -1), { ...last, content: cut(last.content, event.dropText) ?? '', thinking: cut(last.thinking, event.dropThinking) }]
        })
      } else if (event.type === 'retrying') {
        setRetryNote(`Retrying (${event.attempt}) in ${Math.round((event.delayMs ?? 0) / 1000)}s: ${event.reason ?? ''}`)
      } else if (event.type === 'tool_call_start' || event.type === 'tool_permission_request') {
        const isPerm = event.type === 'tool_permission_request'
        const newTool: ToolCallUI = {
          callId: event.callId!,
          toolName: event.toolName!,
          input: event.input || event.args,
          status: isPerm ? 'pending_approval' : 'running',
          parentCallId: event.parentCallId,
          agentType: event.agentType,
          canAlways: isPerm ? event.canAlways : undefined
        }
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last && last.role === 'assistant') {
            const currentTools = last.toolCalls || []
            const existing = currentTools.find((t) => t.callId === newTool.callId)
            const updatedTools = existing
              ? currentTools.map((t) => (t.callId === newTool.callId ? { ...t, ...newTool } : t))
              : [...currentTools, newTool]
            return [...prev.slice(0, -1), { ...last, toolCalls: updatedTools }]
          }
          return [...prev, { id: `msg_${Date.now()}`, role: 'assistant', content: '', toolCalls: [newTool] }]
        })
      } else if (event.type === 'user_input_request') {
        setMessages((prev) => patchTool(prev, event.callId!, { status: 'pending_input', input: { question: event.question, options: event.options } }))
      } else if (event.type === 'tool_call_result') {
        setMessages((prev) =>
          patchTool(prev, event.callId!, { status: event.isError ? 'error' : 'success', output: event.output })
        )
      } else if (event.type === 'plan_update') {
        setPlan((event.plan as PlanStep[]) || [])
        setPlanNote(event.explanation)
      } else if (event.type === 'goal_update') {
        setGoalsTick((t) => t + 1)
      } else if (event.type === 'settings_changed') {
        refreshSettings()
      } else if (event.type === 'usage') {
        setUsage(event.usage ?? null)
      } else if (event.type === 'session_reset') {
        // /clear or /compact rewrote the stored history: reload it, then show the command's note
        const note = event.delta
        loadHistory(activeSessionId).then((msgs) => {
          setMessages(note ? [...msgs, { id: `note_${Date.now()}`, role: 'assistant', content: note }] : msgs)
          setPlan([])
        })
      } else if (event.type === 'error') {
        setMessages((prev) => [
          ...prev,
          { id: `err_${Date.now()}`, role: 'assistant', content: `Error: ${event.error ?? 'unknown error'}` }
        ])
        if (sid) setRun(sid, false)
        loadSessions()
      }
    })

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [activeSessionId])

  /** Updates one tool card wherever it lives (the last message is not always the one that owns it). */
  const patchTool = (msgs: ChatMessage[], callId: string, patch: Partial<ToolCallUI>): ChatMessage[] =>
    msgs.map((m) =>
      m.toolCalls?.some((t) => t.callId === callId)
        ? { ...m, toolCalls: m.toolCalls.map((t) => (t.callId === callId ? { ...t, ...patch } : t)) }
        : m
    )

  const handleSendMessage = async (text: string) => {
    if (isStreaming) return

    // Optimistically append user message
    const userMsg: ChatMessage = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: text
    }
    setMessages((prev) => [...prev, userMsg])
    setRun(activeSessionId, true)

    try {
      await window.aiDesktop?.chat?.send({
        sessionId: activeSessionId,
        prompt: text
      })
    } catch {
      setRun(activeSessionId, false)
    }
  }

  sendRef.current = handleSendMessage

  useEffect(() => {
    const off = window.aiDesktop?.window?.onLauncherPrompt((q) => sendRef.current(q))
    return () => off?.()
  }, [])

  const handleConfirmTool = (callId: string, approved: boolean, always = false) => {
    window.aiDesktop?.mcp?.confirmTool(callId, approved, always)
    setMessages((prev) => patchTool(prev, callId, { status: approved ? 'running' : 'error' }))
  }

  const handleAnswerInput = (callId: string, answer: string) => {
    window.aiDesktop?.mcp?.answerInput(callId, answer)
    setMessages((prev) => patchTool(prev, callId, { status: 'running' }))
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#09090b] text-zinc-100 overflow-hidden font-sans">
      <TitleBar onToggleTerminal={() => setShowTerminal(!showTerminal)} />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={selectSession}
          onNewSession={handleNewSession}
          onDeleteSession={handleDeleteSession}
          onOpenSettings={() => setShowSettings(true)}
          onOpenGoals={() => setShowGoals(true)}
          onOpenMemory={() => setShowMemory(true)}
          mcpConnectedCount={mcpCount}
        />

        <main className="flex-1 flex flex-col min-w-0 bg-[#0c0c0e] relative">
          <ChatView
            messages={messages}
            isStreaming={isStreaming}
            onOpenArtifact={(art) => setActiveArtifact(art)}
            onConfirmTool={handleConfirmTool}
            onAnswerInput={handleAnswerInput}
          />

          {retryNote && <div className="mx-4 mb-2 px-3 py-1.5 rounded-lg border border-amber-600/40 bg-amber-950/30 text-xs text-amber-200 truncate">{retryNote}</div>}

          <PlanCard plan={plan} explanation={planNote} />

          {trust && !trust.trusted && (
            <div className="mx-4 mb-2 px-3 py-2 rounded-lg border border-amber-600/40 bg-amber-950/30 text-xs text-amber-200 flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">
                Untrusted folder <span className="font-mono">{trust.root}</span>: its CLAUDE.md/AGENTS.md, agents, skills and commands are not loaded.
              </span>
              <button onClick={trustWorkspace} className="shrink-0 px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-md font-medium">
                Trust this folder
              </button>
            </div>
          )}

          <ChatInput
            onSendMessage={handleSendMessage}
            isStreaming={isStreaming}
            onAbort={() => window.aiDesktop?.chat?.abort(activeSessionId)}
            modelName={modelName}
            permissionMode={permissionMode}
            usage={usage}
            commands={commands}
          />

          <TerminalPanel isOpen={showTerminal} onClose={() => setShowTerminal(false)} />
        </main>

        {activeArtifact && (
          <ArtifactPanel artifact={activeArtifact} onClose={() => setActiveArtifact(null)} />
        )}
      </div>

      <GoalsCard isOpen={showGoals} refreshKey={goalsTick} onClose={() => setShowGoals(false)} />
      <MemoryDrawer isOpen={showMemory} onClose={() => setShowMemory(false)} />
      <SettingsModal
        isOpen={showSettings}
        onClose={() => {
          setShowSettings(false)
          refreshSettings()
          refreshCommands()
          refreshTrust()
        }}
      />
    </div>
  )
}
