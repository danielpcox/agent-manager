import { useEffect, useRef, useCallback, useState } from 'react'
import { useAgentStore } from '../store/agentStore'
import { StatusBadge } from './StatusBadge'
import { SessionStatsPanel } from './SessionStatsPanel'
import { TranscriptPanel } from './TranscriptPanel'
import { MemoryPanel } from './MemoryPanel'
import { FileViewerModal } from './FileViewerModal'
import { BrowseFilesPanel } from './BrowseFilesPanel'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
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
  const [activeTab, setActiveTab] = useState<'terminal' | 'session' | 'transcript' | 'memory' | 'browse'>('terminal')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  // Reset tab when agent changes
  useEffect(() => { setActiveTab('terminal') }, [agent?.id])

  // Re-fit terminal when switching back to it
  useEffect(() => {
    if (activeTab === 'terminal') {
      fitAddonRef.current?.fit()
    }
  }, [activeTab])

  // Tell main process whether the terminal tab is active so status detection
  // is only triggered by live terminal output, not by tab-switch side effects.
  useEffect(() => {
    if (!agent) return
    window.api.setTerminalTabActive(agent.id, activeTab === 'terminal')
  }, [agent?.id, activeTab])

  useEffect(() => {
    if (!agent) return
    // On unmount (agent deselected), re-enable detection so background agents
    // can still be marked waiting while the user looks at other agents.
    return () => window.api.setTerminalTabActive(agent.id, true)
  }, [agent?.id])

  // Tick timer for duration display
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  // Focus terminal on custom event (triggered by Escape hotkey from App)
  useEffect(() => {
    const handler = () => {
      setActiveTab('terminal')
      // Wait for React to unhide the terminal div before focusing
      setTimeout(() => terminalRef.current?.focus(), 0)
    }
    window.addEventListener('focus-terminal', handler)
    return () => window.removeEventListener('focus-terminal', handler)
  }, [setActiveTab])

  // Single effect: create terminal, load buffer, subscribe to live data
  useEffect(() => {
    if (!termRef.current || !agent) return

    let disposed = false

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
      scrollback: 200000,
      allowProposedApi: true
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    terminal.open(termRef.current)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Handle user input — write to PTY (unless we're still loading the initial buffer)
    terminal.onData((data) => {
      if (loadingBuffer) return  // ignore input until buffer is loaded
      window.api.writePty(agent.id, data)
    })


    // Handle resize — sync PTY dimensions with terminal
    terminal.onResize(({ cols, rows }) => {
      window.api.resizePty(agent.id, cols, rows)
    })

    // Initial fit + send size to PTY
    fitAddon.fit()
    window.api.resizePty(agent.id, terminal.cols, terminal.rows)

    // Observe container resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
    })
    resizeObserver.observe(termRef.current)

    // Subscribe to live PTY data, queuing until buffer is fully rendered
    const pendingWrites: string[] = []
    let bufferRendered = false
    let loadingBuffer = true  // block PTY input while loading initial buffer

    const unsubPty = window.api.onPtyData(({ agentId, data }) => {
      if (agentId !== agent.id || disposed) return

      if (bufferRendered) {
        terminal.write(data)
      } else {
        pendingWrites.push(data)
      }
    })

    const scrollDown = (): void => {
      // xterm renders asynchronously over multiple frames for large writes.
      // Fire scrollToBottom repeatedly to catch whenever rendering completes.
      terminal.scrollToBottom()
      terminal.focus()
      requestAnimationFrame(() => { if (!disposed) terminal.scrollToBottom() })
      setTimeout(() => { if (!disposed) terminal.scrollToBottom() }, 50)
      setTimeout(() => { if (!disposed) terminal.scrollToBottom() }, 150)
      setTimeout(() => { if (!disposed) terminal.scrollToBottom() }, 300)
    }

    const flushPending = (): void => {
      bufferRendered = true
      const afterFlush = () => {
        scrollDown()
        // Force a tmux screen redraw (resize ±1) to colorize the visible area.
        // Status detection is suppressed in the main process during the redraw.
        if (['starting', 'running', 'waiting'].includes(agent.status)) {
          window.api.resizePtyForRedraw(agent.id, terminal.cols, terminal.rows)
        }
      }
      if (pendingWrites.length > 0) {
        const queued = pendingWrites.join('')
        pendingWrites.length = 0
        terminal.write(queued, afterFlush)
      } else {
        afterFlush()
      }
    }

    // Load tmux scrollback history. capturePane provides clean visual history without the
    // intermediate TUI frames that accumulated in outputBuffer. We'll get pending live data after.
    window.api.capturePane(agent.id).then((data) => {
      if (disposed) return

      if (data && data.length > 0) {
        terminal.write(data, () => {
          if (disposed) return
          loadingBuffer = false
          scrollDown()
          flushPending()
        })
      } else {
        if (['killed', 'done', 'error'].includes(agent.status)) {
          terminal.write(
            '\x1b[90m Session output not available (restored from previous app session).\r\n' +
            ' Use Import Session to reconnect.\x1b[0m\r\n'
          )
        }
        loadingBuffer = false
        flushPending()
      }
    }).catch((err) => {
      if (disposed) return
      console.error('[AgentDetail] Failed to load scrollback:', err)
      loadingBuffer = false
      flushPending()
    })

    return () => {
      disposed = true
      unsubPty()
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [agent?.id])

  // Inline rename
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const renameRef = useRef<HTMLInputElement>(null)

  // Reset rename state when agent changes
  useEffect(() => { setRenaming(false) }, [agent?.id])

  const startRename = useCallback(() => {
    if (!agent) return
    setRenameDraft(agent.name)
    setRenaming(true)
    setTimeout(() => renameRef.current?.select(), 0)
  }, [agent?.name])

  const commitRename = useCallback(() => {
    if (!agent) return
    const trimmed = renameDraft.trim()
    if (trimmed && trimmed !== agent.name) {
      window.api.renameAgent(agent.id, trimmed)
    }
    setRenaming(false)
  }, [agent?.id, agent?.name, renameDraft])

  const handleKill = useCallback(() => {
    if (agent) window.api.killAgent(agent.id)
  }, [agent?.id])

  const handleRemove = useCallback(() => {
    if (agent) window.api.removeAgent(agent.id)
  }, [agent?.id])

  const handleRemoteControl = useCallback(() => {
    if (agent) window.api.enableRemoteControl(agent.id)
  }, [agent?.id])

  const handleTable = useCallback(() => {
    if (agent) window.api.tableAgent(agent.id, !agent.isTabled)
  }, [agent?.id, agent?.isTabled])

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
            {renaming ? (
              <input
                ref={renameRef}
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setRenaming(false)
                }}
                className="text-base font-semibold text-text-primary bg-surface-2 border border-border-focus rounded px-1.5 py-0.5 outline-none min-w-0"
              />
            ) : (
              <h2
                className="text-base font-semibold text-text-primary truncate cursor-pointer hover:text-accent transition-colors"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); startRename() }}
                title="Double-click to rename"
              >
                {agent.name}
              </h2>
            )}
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
            {agent.isRemote && agent.remoteHost
              ? `${agent.remoteHost}:${agent.workdir}`
              : agent.workdir}
            &middot; {agent.model}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {agent.status !== 'disconnected' && (
            <button
              onClick={handleTable}
              className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary border border-border hover:border-text-muted/50 rounded-md transition-colors"
              title={agent.isTabled ? 'Move back to inbox' : 'Table this agent'}
            >
              {agent.isTabled ? 'Untable' : 'Table'}
            </button>
          )}
          {agent.status === 'disconnected' && (
            <button
              onClick={() => {
                // Trigger reconnection by spawning remote PTY again
                window.api.resizePty(agent.id, 120, 40)
              }}
              className="px-2 py-1 text-xs text-text-secondary hover:text-accent border border-border hover:border-accent/50 rounded-md transition-colors"
              title="Attempt to reconnect to remote session"
            >
              Retry
            </button>
          )}
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
          {!isActive && agent.status !== 'disconnected' && (
            <button
              onClick={handleRemove}
              className="px-2 py-1 text-xs text-text-secondary hover:text-status-error border border-border hover:border-status-error/50 rounded-md transition-colors"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0 px-2 gap-1 pt-1">
        {(['terminal', 'session', 'transcript', 'memory', 'browse'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-xs rounded-t capitalize transition-colors ${
              activeTab === tab
                ? 'text-text-primary border-b-2 border-accent -mb-px'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Terminal — always rendered to preserve xterm state */}
      <div className={`flex-1 min-h-0 overflow-hidden ${activeTab !== 'terminal' ? 'hidden' : ''}`}>
        <div ref={termRef} className="xterm-container" />
      </div>

      {/* Session stats */}
      {activeTab === 'session' && agent.sessionId && (
        <SessionStatsPanel sessionId={agent.sessionId} workdir={agent.workdir} onSelectFile={setSelectedFile} isRemote={agent.isRemote} remoteHost={agent.remoteHost} />
      )}
      {activeTab === 'session' && !agent.sessionId && (
        <div className="flex-1 flex items-center justify-center p-4 text-sm text-text-muted">
          No session ID yet — agent may still be starting.
        </div>
      )}

      {/* Transcript */}
      {activeTab === 'transcript' && agent.sessionId && (
        <TranscriptPanel sessionId={agent.sessionId} workdir={agent.workdir} onSelectFile={setSelectedFile} isRemote={agent.isRemote} remoteHost={agent.remoteHost} />
      )}
      {activeTab === 'transcript' && !agent.sessionId && (
        <div className="flex-1 flex items-center justify-center p-4 text-sm text-text-muted">
          No session ID yet — agent may still be starting.
        </div>
      )}

      {/* Memory */}
      {activeTab === 'memory' && <MemoryPanel workdir={agent.workdir} isRemote={agent.isRemote} remoteHost={agent.remoteHost} />}

      {/* Browse files */}
      {activeTab === 'browse' && <BrowseFilesPanel workdir={agent.workdir} onSelectFile={setSelectedFile} isRemote={agent.isRemote} remoteHost={agent.remoteHost} />}

      {/* File viewer modal */}
      {selectedFile && (
        <FileViewerModal filePath={selectedFile} workdir={agent.workdir} onClose={() => setSelectedFile(null)} isRemote={agent.isRemote} remoteHost={agent.remoteHost} />
      )}

      {/* Footer stats */}
      <div className="px-4 py-1.5 border-t border-border flex items-center gap-4 text-[10px] text-text-muted shrink-0">
        {agent.tokenContext > 0 && (
          <span title="Current context size">
            {agent.tokenContext >= 1000
              ? `${(agent.tokenContext / 1000).toFixed(agent.tokenContext >= 10000 ? 0 : 1)}k tokens`
              : `${agent.tokenContext} tokens`}
          </span>
        )}
        <span title="Total running time">{(() => {
          const running = agent.runningTimeMs || 0
          if (agent.status === 'running' || agent.status === 'starting') {
            return formatDuration(running + (now - (agent.statusChangedAt || agent.createdAt)))
          }
          return formatDuration(running)
        })()}</span>
        <span>{agent.permissionMode}</span>
        {agent.sessionId && (
          <span className="truncate" title={agent.sessionId}>
            session: {agent.sessionId.substring(0, 8)}…
          </span>
        )}
      </div>
    </div>
  )
}
