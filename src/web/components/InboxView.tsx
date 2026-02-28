import { useState } from 'react'
import { useAgentStore } from '../store/agentStore'
import { InboxCard } from './InboxCard'
import { wsApi } from '../wsApi'

interface InboxViewProps {
  onNewAgent: () => void
  onSelectAgent: (agentId: string) => void
}

export function InboxView({ onNewAgent, onSelectAgent }: InboxViewProps) {
  const { filteredAgents, selectAgent, markRead, attentionCount, agents, filterTab, setFilterTab } = useAgentStore()
  const [searchQuery, setSearchQuery] = useState('')
  const attention = attentionCount()

  const filtered = filteredAgents()
  const visible = searchQuery
    ? filtered.filter((a) => {
        const q = searchQuery.toLowerCase()
        return a.name.toLowerCase().includes(q) || a.task.toLowerCase().includes(q) || a.workdir.toLowerCase().includes(q)
      })
    : filtered

  const handleSelect = (agentId: string) => {
    selectAgent(agentId)
    markRead(agentId)
    wsApi.markRead(agentId)
    onSelectAgent(agentId)
  }

  const tabs = [
    { key: 'all' as const, label: 'All' },
    { key: 'active' as const, label: 'Running' },
    { key: 'attention' as const, label: 'Needs Input' },
    { key: 'tabled' as const, label: 'Tabled' },
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-text-primary">Inbox</h1>
            {attention > 0 && (
              <span className="bg-status-waiting/20 text-status-waiting text-xs font-bold px-2 py-0.5 rounded-full">
                {attention}
              </span>
            )}
          </div>
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search agents..."
          className="w-full px-3 py-2.5 bg-surface-2 border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-border-focus"
        />
      </div>

      <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilterTab(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
              filterTab === tab.key
                ? 'bg-surface-3 text-text-primary font-medium'
                : 'text-text-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-20">
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-text-muted">
            <div className="text-5xl mb-4 opacity-20">◇</div>
            <div className="text-base mb-1">No agents running</div>
            <div className="text-sm">Tap + to create one</div>
          </div>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center text-text-muted text-sm">
            {searchQuery ? 'No agents match your search.' : 'No agents match this filter.'}
          </div>
        ) : (
          visible.map((agent) => (
            <InboxCard
              key={agent.id}
              agent={agent}
              tabled={agent.isTabled}
              onClick={() => handleSelect(agent.id)}
            />
          ))
        )}
      </div>

      <button
        onClick={onNewAgent}
        className="fixed bottom-6 right-6 w-14 h-14 bg-accent hover:bg-accent-hover rounded-full flex items-center justify-center text-white text-3xl shadow-xl active:scale-95 transition-transform z-30"
        aria-label="New Agent"
      >
        +
      </button>
    </div>
  )
}
