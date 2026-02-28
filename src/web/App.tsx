import { useEffect, useState } from 'react'
import { useAgentStore } from './store/agentStore'
import { InboxView } from './components/InboxView'
import { AgentDetail } from './components/AgentDetail'
import { NewAgentModal } from './components/NewAgentModal'
import { wsApi, onConnectionStatus } from './wsApi'
import type { Agent, AgentStatus, ConversationEvent } from './types/agent'

export default function App() {
  const [showDetail, setShowDetail] = useState(false)
  const [showNewAgent, setShowNewAgent] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const { addAgent, updateAgent, updateAgentStatus, addAgentEvent, removeAgent, selectAgent, markRead, setAgents } = useAgentStore()

  useEffect(() => {
    return onConnectionStatus(setConnectionStatus)
  }, [])

  useEffect(() => {
    const unsubs = [
      wsApi.onInit(({ agents }) => setAgents(agents)),
      wsApi.onAgentCreated((agent) => addAgent(agent)),
      wsApi.onAgentStatusChanged(({ agentId, status }) => updateAgentStatus(agentId, status as AgentStatus)),
      wsApi.onAgentUpdated((agent) => updateAgent(agent as Agent)),
      wsApi.onAgentEvent(({ agentId, event }) => addAgentEvent(agentId, event as ConversationEvent)),
      wsApi.onAgentRemoved(({ agentId }) => removeAgent(agentId)),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  const handleSelectAgent = (agentId: string) => {
    selectAgent(agentId)
    markRead(agentId)
    setShowDetail(true)
  }

  const handleBack = () => {
    setShowDetail(false)
    selectAgent(null)
  }

  const statusColor = {
    connecting: 'bg-status-starting',
    connected: 'bg-status-running',
    disconnected: 'bg-status-error',
  }[connectionStatus]

  return (
    <div className="h-full flex flex-col bg-surface-0 overflow-hidden">
      <div className="px-4 py-2 flex items-center gap-2 bg-surface-1 border-b border-border shrink-0">
        <span className={`w-2 h-2 rounded-full ${statusColor}`} />
        <span className="text-xs text-text-muted capitalize">{connectionStatus}</span>
        <span className="ml-auto text-xs text-text-muted font-semibold">Agent Manager</span>
      </div>

      <div className="flex-1 overflow-hidden relative">
        <div className={`absolute inset-0 transition-transform duration-300 ${showDetail ? '-translate-x-full' : 'translate-x-0'}`}>
          <InboxView onNewAgent={() => setShowNewAgent(true)} onSelectAgent={handleSelectAgent} />
        </div>
        <div className={`absolute inset-0 transition-transform duration-300 ${showDetail ? 'translate-x-0' : 'translate-x-full'}`}>
          {showDetail && <AgentDetail onBack={handleBack} />}
        </div>
      </div>

      {showNewAgent && <NewAgentModal onClose={() => setShowNewAgent(false)} />}
    </div>
  )
}
