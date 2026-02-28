import type { AgentStatus } from '../types/agent'

const statusConfig: Record<
  AgentStatus,
  { label: string; color: string; dotClass: string; animate?: boolean }
> = {
  starting: {
    label: 'Starting',
    color: 'text-status-starting',
    dotClass: 'bg-status-starting',
    animate: true
  },
  running: {
    label: 'Running',
    color: 'text-status-running',
    dotClass: 'bg-status-running',
    animate: true
  },
  waiting: {
    label: 'Waiting',
    color: 'text-status-waiting',
    dotClass: 'bg-status-waiting'
  },
  done: {
    label: 'Done',
    color: 'text-status-done',
    dotClass: 'bg-status-done'
  },
  error: {
    label: 'Error',
    color: 'text-status-error',
    dotClass: 'bg-status-error'
  },
  killed: {
    label: 'Killed',
    color: 'text-status-killed',
    dotClass: 'bg-status-killed'
  }
}

interface StatusBadgeProps {
  status: AgentStatus
  compact?: boolean
}

export function StatusBadge({ status, compact }: StatusBadgeProps) {
  const config = statusConfig[status]

  return (
    <span className={`inline-flex items-center gap-1.5 ${config.color}`}>
      <span className="relative flex h-2 w-2">
        {config.animate && (
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-40 ${config.dotClass}`}
          />
        )}
        <span
          className={`relative inline-flex rounded-full h-2 w-2 ${config.dotClass}`}
        />
      </span>
      {!compact && (
        <span className="text-xs font-medium">{config.label}</span>
      )}
    </span>
  )
}
