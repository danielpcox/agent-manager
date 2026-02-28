import type { Agent } from '../types/agent'
import { StatusBadge } from './StatusBadge'
import { useAgentStore } from '../store/agentStore'

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function truncateDir(dir: string): string {
  const parts = dir.split('/')
  if (parts.length > 3) {
    return '~/' + parts.slice(-2).join('/')
  }
  return dir
}

interface InboxCardProps {
  agent: Agent
  onClick: () => void
}

export function InboxCard({ agent, onClick }: InboxCardProps) {
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId)
  const isSelected = selectedAgentId === agent.id
  const isAttention = agent.status === 'waiting' || agent.status === 'error'

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg mb-1 transition-all border ${
        isSelected
          ? 'bg-surface-2 border-border-focus'
          : isAttention
            ? 'bg-surface-1 border-status-waiting/30 hover:bg-surface-2'
            : 'bg-surface-1 border-transparent hover:bg-surface-2'
      }`}
    >
      <div className="flex items-start justify-between mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-text-primary truncate">
            {agent.name}
          </span>
          {agent.isUnread && (
            <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <StatusBadge status={agent.status} />
        </div>
      </div>

      <p className="text-xs text-text-secondary line-clamp-2 mb-2">
        {agent.task}
      </p>

      <div className="flex items-center justify-between text-[10px] text-text-muted">
        <span className="truncate">{truncateDir(agent.workdir)}</span>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {agent.totalCostUsd > 0 && (
            <span>${agent.totalCostUsd.toFixed(3)}</span>
          )}
          {agent.remoteControlUrl && (
            <span title="Remote Control active">RC</span>
          )}
          <span>{timeAgo(agent.updatedAt)}</span>
        </div>
      </div>
    </button>
  )
}
