import { useEffect, useState } from 'react'
import type { Agent } from '../types/agent'
import { StatusBadge } from './StatusBadge'
import { useAgentStore } from '../store/agentStore'

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (minutes < 60) return `${minutes}m ${secs}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function truncateDir(dir: string): string {
  const parts = dir.split('/')
  if (parts.length > 3) return '~/' + parts.slice(-2).join('/')
  return dir
}

interface InboxCardProps {
  agent: Agent
  onClick: () => void
  tabled?: boolean
}

export function InboxCard({ agent, onClick, tabled }: InboxCardProps) {
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId)
  const isSelected = selectedAgentId === agent.id
  const isAttention = !tabled && (agent.status === 'waiting' || agent.status === 'error')
  const isActive = ['running', 'starting', 'waiting'].includes(agent.status)

  const [, setTick] = useState(0)
  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [isActive])

  const runningTimeMs = agent.runningTimeMs || 0
  const statusChangedAt = agent.statusChangedAt || agent.createdAt
  let timerLabel: string
  if (agent.status === 'running' || agent.status === 'starting') {
    timerLabel = formatDuration(runningTimeMs + (Date.now() - statusChangedAt))
  } else if (agent.status === 'waiting') {
    timerLabel = `${formatDuration(Date.now() - statusChangedAt)} waiting`
  } else {
    timerLabel = formatDuration(runningTimeMs)
  }

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-xl mb-2 transition-all border active:scale-[0.98] ${
        isSelected
          ? 'bg-accent/15 border-accent/60'
          : isAttention
            ? 'bg-surface-1 border-status-waiting/30'
            : 'bg-surface-1 border-transparent'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-base font-semibold truncate ${tabled ? 'text-text-muted' : 'text-text-primary'}`}>
            {agent.name}
          </span>
          {!tabled && agent.isUnread && (
            <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
          )}
        </div>
        <div className="shrink-0 ml-2">
          {tabled ? <span className="text-xs text-text-muted">tabled</span> : <StatusBadge status={agent.status} />}
        </div>
      </div>
      <p className={`text-sm line-clamp-2 mb-3 ${tabled ? 'text-text-muted' : 'text-text-secondary'}`}>
        {agent.task}
      </p>
      <div className="flex items-center justify-between text-xs text-text-muted">
        <span className="truncate">{truncateDir(agent.workdir)}</span>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {agent.tokenContext > 0 && (
            <span>{agent.tokenContext >= 1000 ? `${(agent.tokenContext / 1000).toFixed(1)}k` : agent.tokenContext} ctx</span>
          )}
          <span>{timerLabel}</span>
        </div>
      </div>
    </button>
  )
}
