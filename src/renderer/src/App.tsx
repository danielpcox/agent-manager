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
      sendMessage: (agentId: string, message: string) => Promise<void>
      sendScreenshot: (agentId: string, imageBase64: string, message: string) => Promise<void>
      writePty: (agentId: string, data: string) => Promise<void>
      resizePty: (agentId: string, cols: number, rows: number) => Promise<void>
      enableRemoteControl: (agentId: string) => Promise<void>
      killAgent: (agentId: string) => Promise<void>
      removeAgent: (agentId: string) => Promise<void>
      markRead: (agentId: string) => Promise<void>
      getAllAgents: () => Promise<Agent[]>
      getAgent: (agentId: string) => Promise<Agent | null>
      selectDirectory: () => Promise<string | null>
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
    addAgent,
    updateAgent,
    updateAgentStatus,
    addAgentEvent,
    removeAgent,
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
