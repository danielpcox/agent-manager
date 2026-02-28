import { useAgentStore } from '../store/agentStore'
import { InboxCard } from './InboxCard'

type FilterTab = 'all' | 'active' | 'attention' | 'done'

const tabs: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'attention', label: 'Needs Attention' },
  { key: 'done', label: 'Done' }
]

interface InboxViewProps {
  onNewAgent: () => void
}

export function InboxView({ onNewAgent }: InboxViewProps) {
  const {
    filterTab,
    setFilterTab,
    filteredAgents,
    selectAgent,
    markRead,
    attentionCount,
    agents
  } = useAgentStore()

  const visible = filteredAgents()
  const attention = attentionCount()

  const handleSelect = (agentId: string) => {
    selectAgent(agentId)
    markRead(agentId)
    window.api.markRead(agentId)
  }

  return (
    <div className="w-80 shrink-0 bg-surface-0 border-r border-border flex flex-col pt-[38px]">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-text-primary">Inbox</h2>
          {attention > 0 && (
            <span className="bg-status-waiting/20 text-status-waiting text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {attention}
            </span>
          )}
        </div>
        <button
          onClick={onNewAgent}
          className="text-xs text-accent hover:text-accent-hover transition-colors font-medium"
        >
          + New Agent
        </button>
      </div>

      {/* Filter tabs */}
      <div className="px-4 pb-2 flex gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilterTab(tab.key)}
            className={`px-2 py-1 rounded-md text-xs transition-colors ${
              filterTab === tab.key
                ? 'bg-surface-3 text-text-primary font-medium'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Inbox list */}
      <div className="flex-1 overflow-y-auto px-2">
        {agents.length === 0 ? (
          <div className="px-4 py-12 text-center text-text-muted text-sm">
            <div className="text-3xl mb-3 opacity-30">&#9671;</div>
            <div className="mb-1">No agents running</div>
            <div className="text-xs">
              Create your first agent to get started
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-8 text-center text-text-muted text-xs">
            No agents match this filter.
          </div>
        ) : (
          visible.map((agent) => (
            <InboxCard
              key={agent.id}
              agent={agent}
              onClick={() => handleSelect(agent.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}
