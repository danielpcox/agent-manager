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
  if (parts.length > 3) {
    return '~/' + parts.slice(-2).join('/')
  }
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

  // Tick for live timer updates
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [isActive])

  // Calculate display time
  const runningTimeMs = agent.runningTimeMs || 0
  const statusChangedAt = agent.statusChangedAt || agent.createdAt

  let timerLabel: string
  let timerTitle: string
  if (agent.status === 'running' || agent.status === 'starting') {
    // Currently running: accumulated + current stint
    const currentStint = Date.now() - statusChangedAt
    const totalRunning = runningTimeMs + currentStint
    timerLabel = formatDuration(totalRunning)
    timerTitle = 'Total running time'
  } else if (agent.status === 'waiting') {
    // Waiting: show how long waiting, with running time in tooltip
    const waitTime = Date.now() - statusChangedAt
    timerLabel = `${formatDuration(waitTime)} waiting`
    timerTitle = `Waiting for input (ran for ${formatDuration(runningTimeMs)})`
  } else {
    // Done/error/killed: show total running time
    timerLabel = formatDuration(runningTimeMs)
    timerTitle = 'Total running time'
  }

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
          <span className={`text-sm font-medium truncate ${tabled ? 'text-text-muted' : 'text-text-primary'}`}>
            {agent.name}
          </span>
          {!tabled && agent.isUnread && (
            <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {tabled
            ? <span className="text-[10px] text-text-muted">tabled</span>
            : <StatusBadge status={agent.status} />}
        </div>
      </div>

      <p className={`text-xs line-clamp-2 mb-2 ${tabled ? 'text-text-muted' : 'text-text-secondary'}`}>
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
          <span title={timerTitle}>{timerLabel}</span>
        </div>
      </div>
    </button>
  )
}
