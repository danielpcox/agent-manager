import { useAgentStore } from '../store/agentStore'
import { StatusBadge } from './StatusBadge'
import type { AppView } from '../App'

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

interface SidebarProps {
  onNewAgent: () => void
  currentView: AppView
  onViewChange: (view: AppView) => void
}

const viewNavItems: { key: AppView; label: string; icon: string }[] = [
  { key: 'agents', label: 'Agents', icon: '\u25C8' },
  { key: 'usage', label: 'Usage', icon: '\u2261' },
  { key: 'btop', label: 'System', icon: '\u2630' }
]

export function Sidebar({ onNewAgent, currentView, onViewChange }: SidebarProps) {
  const { agents, selectedAgentId, selectAgent, markRead, attentionCount } =
    useAgentStore()

  const sorted = [...agents].sort((a, b) => b.updatedAt - a.updatedAt)
  const attention = attentionCount()

  const handleSelect = (agentId: string) => {
    onViewChange('agents')
    selectAgent(agentId)
    markRead(agentId)
    window.api.markRead(agentId)
  }

  return (
    <div className="w-56 shrink-0 bg-surface-1 border-r border-border flex flex-col pt-[38px]">
      {/* View nav */}
      <div className="px-2 py-2 flex flex-col gap-0.5 border-b border-border">
        {viewNavItems.map((item) => (
          <button
            key={item.key}
            onClick={() => onViewChange(item.key)}
            className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs flex items-center gap-2 transition-colors ${
              currentView === item.key
                ? 'bg-surface-3 text-text-primary font-medium'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-2'
            }`}
          >
            <span className="text-sm opacity-60">{item.icon}</span>
            <span>{item.label}</span>
            {item.key === 'agents' && attention > 0 && (
              <span className="ml-auto bg-status-waiting/20 text-status-waiting text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {attention}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Agent list header */}
      <div className="px-3 py-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
          Agents
        </h2>
        <button
          onClick={onNewAgent}
          className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors text-sm leading-none"
          title="New Agent"
        >
          +
        </button>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto px-1.5">
        {sorted.length === 0 ? (
          <div className="px-2 py-6 text-center text-text-muted text-[11px]">
            No agents yet.
            <br />
            Click + to create one.
          </div>
        ) : (
          sorted.map((agent) => (
            <button
              key={agent.id}
              onClick={() => handleSelect(agent.id)}
              className={`w-full text-left px-2.5 py-2 rounded-lg mb-0.5 transition-colors ${
                selectedAgentId === agent.id && currentView === 'agents'
                  ? 'bg-surface-3'
                  : 'hover:bg-surface-2'
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[13px] font-medium text-text-primary truncate mr-1">
                  {agent.name}
                </span>
                {agent.isUnread && (
                  <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                )}
              </div>
              <div className="flex items-center justify-between">
                <StatusBadge status={agent.status} />
                <span className="text-[10px] text-text-muted">
                  {timeAgo(agent.updatedAt)}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
