import { useEffect, useState } from 'react'
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
  bellEnabled: boolean
  onToggleBell: () => void
}

const viewNavItems: { key: AppView; label: string; icon: string }[] = [
  { key: 'agents', label: 'Agents', icon: '\u25C8' },
  { key: 'usage', label: 'Usage', icon: '\u2261' },
  { key: 'btop', label: 'System', icon: '\u2630' },
  { key: 'stats', label: 'Stats', icon: '\u25CE' }
]

function AgentRow({
  agent,
  isSelected,
  tabled,
  onClick
}: {
  agent: { id: string; name: string; status: string; isUnread: boolean; isTabled: boolean; updatedAt: number }
  isSelected: boolean
  tabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-2.5 py-2 rounded-lg mb-0.5 transition-colors ${
        isSelected
          ? 'bg-surface-3'
          : 'hover:bg-surface-2'
      }`}
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className={`text-[13px] font-medium truncate mr-1 ${tabled ? 'text-text-muted' : 'text-text-primary'}`}>
          {agent.name}
        </span>
        {!tabled && agent.isUnread && (
          <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
        )}
      </div>
      <div className="flex items-center justify-between">
        {!tabled && <StatusBadge status={agent.status as import('../types/agent').AgentStatus} />}
        {tabled && <span className="text-[10px] text-text-muted">tabled</span>}
        <span className="text-[10px] text-text-muted">
          {timeAgo(agent.updatedAt)}
        </span>
      </div>
    </button>
  )
}

export function Sidebar({ onNewAgent, currentView, onViewChange, bellEnabled, onToggleBell }: SidebarProps) {
  const { agents, selectedAgentId, selectAgent, markRead, attentionCount } =
    useAgentStore()

  const [webInfo, setWebInfo] = useState<{ url: string; pin: string } | null>(null)
  useEffect(() => {
    window.api.getWebInfo().then(setWebInfo).catch(() => {})
  }, [])

  const copyWebUrl = () => {
    if (!webInfo) return
    navigator.clipboard.writeText(`${webInfo.url}?pin=${webInfo.pin}`)
  }

  const sorted = [...agents].sort((a, b) => b.createdAt - a.createdAt)
  const active = sorted.filter((a) => !a.isTabled)
  const tabled = sorted.filter((a) => a.isTabled)
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
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleBell}
            className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
              bellEnabled
                ? 'text-accent hover:bg-surface-3'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-3'
            }`}
            title={bellEnabled ? 'Notifications on (click to disable)' : 'Notifications off (click to enable)'}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 16a2 2 0 0 0 1.985-1.75c.017-.137-.097-.25-.235-.25h-3.5c-.138 0-.252.113-.235.25A2 2 0 0 0 8 16zm.5-14.5V1a.5.5 0 0 0-1 0v.5C5.27 1.834 4 3.524 4 5.5v5l-1.5 1.5h11L12 10.5v-5c0-1.976-1.27-3.666-3.5-4z"/>
            </svg>
          </button>
          <button
            onClick={onNewAgent}
            className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors text-sm leading-none"
            title="New Agent"
          >
            +
          </button>
        </div>
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
          <>
            {active.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                isSelected={selectedAgentId === agent.id && currentView === 'agents'}
                tabled={false}
                onClick={() => handleSelect(agent.id)}
              />
            ))}
            {tabled.length > 0 && (
              <>
                <div className="border-t border-border my-2 mx-1" />
                <div className="px-2 pb-1 text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                  Tabled
                </div>
                {tabled.map((agent) => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    isSelected={selectedAgentId === agent.id && currentView === 'agents'}
                    tabled={true}
                    onClick={() => handleSelect(agent.id)}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
      {webInfo && (
        <div className="px-3 py-3 border-t border-border">
          <div className="text-[9px] text-text-muted uppercase tracking-wider font-semibold mb-1.5">
            Mobile Access
          </div>
          <button
            onClick={copyWebUrl}
            className="w-full text-left group"
            title="Click to copy URL with PIN"
          >
            <div className="text-[10px] text-text-secondary font-mono break-all leading-relaxed group-hover:text-text-primary transition-colors">
              {webInfo.url}?pin={webInfo.pin}
            </div>
            <div className="text-[9px] text-text-muted mt-0.5 group-hover:text-text-secondary transition-colors">
              Click to copy
            </div>
          </button>
        </div>
      )}
    </div>
  )
}
