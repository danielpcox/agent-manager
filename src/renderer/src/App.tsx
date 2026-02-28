import { useEffect, useState } from 'react'
import { useAgentStore } from './store/agentStore'
import { Sidebar } from './components/Sidebar'
import { InboxView } from './components/InboxView'
import { AgentDetail } from './components/AgentDetail'
import { NewAgentModal } from './components/NewAgentModal'
import { UsageView } from './components/UsageView'
import { BtopView } from './components/BtopView'
import type { Agent, AgentStatus, ConversationEvent } from './types/agent'

export type AppView = 'agents' | 'usage' | 'btop'

declare global {
  interface Window {
    api: {
      createAgent: (params: unknown) => Promise<Agent>
      importAgent: (params: unknown) => Promise<Agent>
      sendMessage: (agentId: string, message: string) => Promise<void>
      sendScreenshot: (agentId: string, imageBase64: string, message: string) => Promise<void>
      writePty: (agentId: string, data: string) => Promise<void>
      resizePty: (agentId: string, cols: number, rows: number) => Promise<void>
      enableRemoteControl: (agentId: string) => Promise<void>
      killAgent: (agentId: string) => Promise<void>
      removeAgent: (agentId: string) => Promise<void>
      markRead: (agentId: string) => Promise<void>
      renameAgent: (agentId: string, name: string) => Promise<void>
      tableAgent: (agentId: string, tabled: boolean) => Promise<void>
      getAllAgents: () => Promise<Agent[]>
      getAgent: (agentId: string) => Promise<Agent | null>
      getOutputBuffer: (agentId: string, offset?: number, length?: number) => Promise<{ data: string; totalLength: number }>
      selectDirectory: () => Promise<string | null>
      listSessions: () => Promise<{ sessionId: string; project: string; summary: string; timestamp: string; mtime: number }[]>
      onPtyData: (cb: (data: { agentId: string; data: string }) => void) => () => void
      onAgentCreated: (cb: (agent: Agent) => void) => () => void
      onAgentStatusChanged: (cb: (data: { agentId: string; status: AgentStatus }) => void) => () => void
      onAgentUpdated: (cb: (agent: Agent) => void) => () => void
      onAgentEvent: (cb: (data: { agentId: string; event: ConversationEvent }) => void) => () => void
      onAgentRemoved: (cb: (data: { agentId: string }) => void) => () => void
      startBtop: (cols: number, rows: number) => Promise<void>
      writeBtop: (data: string) => Promise<void>
      resizeBtop: (cols: number, rows: number) => Promise<void>
      stopBtop: () => Promise<void>
      onBtopData: (cb: (data: string) => void) => () => void
    }
  }
}

export default function App() {
  const [showNewAgent, setShowNewAgent] = useState(false)
  const [view, setView] = useState<AppView>('agents')
  const {
    agents,
    selectedAgentId,
    addAgent,
    updateAgent,
    updateAgentStatus,
    addAgentEvent,
    removeAgent,
    selectAgent,
    markRead,
    setAgents
  } = useAgentStore()

  useEffect(() => {
    window.api.getAllAgents().then(setAgents)

    const unsubs = [
      window.api.onAgentCreated((agent) => addAgent(agent)),
      window.api.onAgentStatusChanged(({ agentId, status }) =>
        updateAgentStatus(agentId, status as AgentStatus)
      ),
      window.api.onAgentUpdated((agent) => updateAgent(agent as Agent)),
      window.api.onAgentEvent(({ agentId, event }) =>
        addAgentEvent(agentId, event as ConversationEvent)
      ),
      window.api.onAgentRemoved(({ agentId }) => removeAgent(agentId))
    ]

    return () => unsubs.forEach((unsub) => unsub())
  }, [])

  // Global hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs/textareas
      const tag = (e.target as HTMLElement)?.tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA'

      // Cmd+N — new agent
      if (e.metaKey && e.key === 'n') {
        e.preventDefault()
        setShowNewAgent(true)
        return
      }

      // Cmd+1/2/3 — switch views
      if (e.metaKey && e.key === '1') {
        e.preventDefault()
        setView('agents')
        return
      }
      if (e.metaKey && e.key === '2') {
        e.preventDefault()
        setView('usage')
        return
      }
      if (e.metaKey && e.key === '3') {
        e.preventDefault()
        setView('btop')
        return
      }

      // Escape — focus terminal (when not in a real input or already in xterm)
      if (e.key === 'Escape' && !isInput) {
        const inXterm = (e.target as HTMLElement)?.closest?.('.xterm-screen') !== null
        if (!inXterm) {
          window.dispatchEvent(new CustomEvent('focus-terminal'))
          return
        }
      }

      // Cmd+[ / Cmd+] — prev/next agent (tag !== 'INPUT' allows xterm's hidden textarea)
      if (e.metaKey && (e.key === '[' || e.key === ']') && tag !== 'INPUT') {
        e.preventDefault()
        // Match sidebar order exactly: non-tabled, newest first
        const sorted = [...agents]
          .filter((a) => !a.isTabled)
          .sort((a, b) => b.createdAt - a.createdAt)
        if (sorted.length === 0) return

        const currentIdx = sorted.findIndex((a) => a.id === selectedAgentId)
        let nextIdx: number
        if (e.key === ']') {
          nextIdx = currentIdx < sorted.length - 1 ? currentIdx + 1 : 0
        } else {
          nextIdx = currentIdx > 0 ? currentIdx - 1 : sorted.length - 1
        }
        const next = sorted[nextIdx]
        setView('agents')
        selectAgent(next.id)
        markRead(next.id)
        window.api.markRead(next.id)
        return
      }

      // Cmd+W — close/deselect current agent detail (not kill)
      if (e.metaKey && e.key === 'w' && !isInput) {
        e.preventDefault()
        selectAgent(null)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [agents, selectedAgentId, selectAgent, markRead])

  const renderDetailView = () => {
    switch (view) {
      case 'usage':
        return <UsageView />
      case 'btop':
        return <BtopView />
      case 'agents':
      default:
        return <AgentDetail />
    }
  }

  return (
    <div className="h-screen flex bg-surface-0">
      {/* Draggable title bar area */}
      <div
        className="fixed top-0 left-0 right-0 h-[38px] z-50"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* Left sidebar */}
      <Sidebar
        onNewAgent={() => setShowNewAgent(true)}
        currentView={view}
        onViewChange={setView}
      />

      {/* Center — inbox (always visible for agent overview) */}
      {view === 'agents' && (
        <InboxView onNewAgent={() => setShowNewAgent(true)} />
      )}

      {/* Right — detail view */}
      {renderDetailView()}

      {/* New agent modal */}
      {showNewAgent && (
        <NewAgentModal onClose={() => setShowNewAgent(false)} />
      )}
    </div>
  )
}
