import { useEffect, useRef, useCallback, useState } from 'react'
import { useAgentStore } from '../store/agentStore'
import { StatusBadge } from './StatusBadge'
import { CompanionInput } from './CompanionInput'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

function formatDuration(startMs: number): string {
  const seconds = Math.floor((Date.now() - startMs) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (minutes < 60) return `${minutes}m ${secs}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function AgentDetail() {
  const agent = useAgentStore((s) => s.selectedAgent())
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [now, setNow] = useState(Date.now())

  // Tick timer for duration display
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  // Initialize terminal
  useEffect(() => {
    if (!termRef.current || !agent) return

    const terminal = new Terminal({
      theme: {
        background: '#0a0a0f',
        foreground: '#e4e4ef',
        cursor: '#6c8cff',
        selectionBackground: '#6c8cff40',
        black: '#0a0a0f',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#fb923c',
        blue: '#6c8cff',
        magenta: '#a78bfa',
        cyan: '#67e8f9',
        white: '#e4e4ef',
        brightBlack: '#5c5c78',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fdba74',
        brightBlue: '#8aa4ff',
        brightMagenta: '#c4b5fd',
        brightCyan: '#a5f3fc',
        brightWhite: '#f4f4ff'
      },
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    terminal.open(termRef.current)
    fitAddon.fit()

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Handle user input — write to PTY
    terminal.onData((data) => {
      window.api.writePty(agent.id, data)
    })

    // Handle resize
    terminal.onResize(({ cols, rows }) => {
      window.api.resizePty(agent.id, cols, rows)
    })

    // Observe container resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
    })
    resizeObserver.observe(termRef.current)

    return () => {
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [agent?.id])

  // Subscribe to PTY data for this agent
  useEffect(() => {
    if (!agent) return

    const unsub = window.api.onPtyData(({ agentId, data }) => {
      if (agentId === agent.id && terminalRef.current) {
        terminalRef.current.write(data)
      }
    })

    return unsub
  }, [agent?.id])

  const handleKill = useCallback(() => {
    if (agent) window.api.killAgent(agent.id)
  }, [agent?.id])

  const handleRemove = useCallback(() => {
    if (agent) window.api.removeAgent(agent.id)
  }, [agent?.id])

  const handleRemoteControl = useCallback(() => {
    if (agent) window.api.enableRemoteControl(agent.id)
  }, [agent?.id])

  if (!agent) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-0 pt-[38px]">
        <div className="text-center text-text-muted">
          <div className="text-4xl mb-3 opacity-20">&#9672;</div>
          <div className="text-sm">Select an agent to view details</div>
        </div>
      </div>
    )
  }

  const isActive = ['starting', 'running', 'waiting'].includes(agent.status)
  void now // used for re-render

  return (
    <div className="flex-1 flex flex-col bg-surface-0 pt-[38px] min-w-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="min-w-0 mr-4">
          <div className="flex items-center gap-2 mb-0.5">
            <h2 className="text-sm font-semibold text-text-primary truncate">
              {agent.name}
            </h2>
            <StatusBadge status={agent.status} />
            {agent.remoteControlUrl && (
              <span
                className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded font-medium cursor-pointer"
                onClick={() =>
                  agent.remoteControlUrl &&
                  navigator.clipboard.writeText(agent.remoteControlUrl)
                }
                title={`Click to copy: ${agent.remoteControlUrl}`}
              >
                RC Active
              </span>
            )}
          </div>
          <div className="text-[11px] text-text-muted truncate">
            {agent.workdir} &middot; {agent.model}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!agent.remoteControlUrl && isActive && (
            <button
              onClick={handleRemoteControl}
              className="px-2 py-1 text-xs text-text-secondary hover:text-accent border border-border hover:border-accent/50 rounded-md transition-colors"
              title="Enable Remote Control"
            >
              Remote
            </button>
          )}
          {isActive && (
            <button
              onClick={handleKill}
              className="px-2 py-1 text-xs text-text-secondary hover:text-status-error border border-border hover:border-status-error/50 rounded-md transition-colors"
            >
              Kill
            </button>
          )}
          {!isActive && (
            <button
              onClick={handleRemove}
              className="px-2 py-1 text-xs text-text-secondary hover:text-status-error border border-border hover:border-status-error/50 rounded-md transition-colors"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Terminal */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div ref={termRef} className="xterm-container" />
      </div>

      {/* Companion input */}
      <CompanionInput agentId={agent.id} isActive={isActive} />

      {/* Footer stats */}
      <div className="px-4 py-1.5 border-t border-border flex items-center gap-4 text-[10px] text-text-muted shrink-0">
        <span>Cost: ${agent.totalCostUsd.toFixed(3)}</span>
        <span>Turns: {agent.turns}</span>
        <span>Time: {formatDuration(agent.createdAt)}</span>
        {agent.sessionId && (
          <span className="truncate" title={agent.sessionId}>
            Session: {agent.sessionId.substring(0, 8)}...
          </span>
        )}
      </div>
    </div>
  )
}
