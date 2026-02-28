import { useEffect, useRef } from 'react'
import { useAgentStore } from '../store/agentStore'
import { StatusBadge } from './StatusBadge'
import { wsApi } from '../wsApi'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface AgentDetailProps {
  onBack: () => void
}

export function AgentDetail({ onBack }: AgentDetailProps) {
  const agent = useAgentStore((s) => s.selectedAgent())
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!termRef.current || !agent) return
    let disposed = false

    const terminal = new Terminal({
      theme: {
        background: '#0a0a0f',
        foreground: '#e4e4ef',
        cursor: '#6c8cff',
        selectionBackground: '#6c8cff40',
        black: '#0a0a0f', red: '#f87171', green: '#4ade80', yellow: '#fb923c',
        blue: '#6c8cff', magenta: '#a78bfa', cyan: '#67e8f9', white: '#e4e4ef',
        brightBlack: '#5c5c78', brightRed: '#fca5a5', brightGreen: '#86efac',
        brightYellow: '#fdba74', brightBlue: '#8aa4ff', brightMagenta: '#c4b5fd',
        brightCyan: '#a5f3fc', brightWhite: '#f4f4ff'
      },
      fontSize: 12,
      fontFamily: "'SF Mono', 'Fira Code', Menlo, monospace",
      scrollback: 50000,
      allowProposedApi: true
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(termRef.current)
    terminal.focus()
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    wsApi.subscribeToAgent(agent.id)
    wsApi.capturePane(agent.id).then((data) => {
      if (!disposed && data) {
        terminal.write(data)
        fitAddon.fit()
        const { cols, rows } = terminal
        wsApi.resizePtyForRedraw(agent.id, cols, rows)
      }
    })

    terminal.onData((data) => {
      if (!disposed) wsApi.writePty(agent.id, data)
    })

    const unsubPty = wsApi.onPtyData(({ agentId, data }) => {
      if (agentId === agent.id && !disposed) terminal.write(data)
    })

    const handleResize = () => {
      if (!disposed) {
        fitAddon.fit()
        const { cols, rows } = terminal
        wsApi.resizePtyForRedraw(agent.id, cols, rows)
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      disposed = true
      unsubPty()
      window.removeEventListener('resize', handleResize)
      wsApi.unsubscribeFromAgent(agent.id)
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [agent?.id])

  if (!agent) return null

  const canKill = ['running', 'starting', 'waiting'].includes(agent.status)

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 shrink-0">
        <button onClick={onBack} className="text-text-secondary text-2xl font-light p-1 -ml-1">
          ‹
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-text-primary truncate">{agent.name}</div>
          <StatusBadge status={agent.status} />
        </div>
        <div className="flex gap-2 shrink-0">
          {canKill && (
            <button
              onClick={() => wsApi.killAgent(agent.id)}
              className="px-3 py-1.5 text-xs rounded-lg bg-surface-3 text-status-error border border-status-error/30"
            >
              Kill
            </button>
          )}
          <button
            onClick={() => wsApi.tableAgent(agent.id, !agent.isTabled)}
            className="px-3 py-1.5 text-xs rounded-lg bg-surface-3 text-text-secondary border border-border"
          >
            {agent.isTabled ? 'Untable' : 'Table'}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden pb-safe">
        <div ref={termRef} className="xterm-container" />
      </div>
    </div>
  )
}
