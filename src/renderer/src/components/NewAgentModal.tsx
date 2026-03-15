import { useState, useCallback, useRef, useEffect } from 'react'
import type { PermissionMode, RemoteSessionInfo } from '../types/agent'

interface NewAgentModalProps {
  onClose: () => void
}

type ModalTab = 'new' | 'import'
type ModalMode = 'local' | 'remote'

interface SessionInfo {
  sessionId: string
  project: string
  summary: string
  timestamp: string
  mtime: number
}

const models = [
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' }
]

const permissionModes: { value: PermissionMode; label: string; desc: string }[] = [
  {
    value: 'autonomous',
    label: 'Autonomous',
    desc: 'Full access — reads, writes, and executes without asking'
  },
  {
    value: 'plan',
    label: 'Plan First',
    desc: 'Creates a plan before writing — pauses for your approval'
  },
  {
    value: 'readonly',
    label: 'Read Only',
    desc: 'Can read and search code, but cannot write or execute'
  }
]

function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function truncatePath(p: string): string {
  const parts = p.split('/')
  if (parts.length > 4) return '~/' + parts.slice(-2).join('/')
  return p
}

export function NewAgentModal({ onClose }: NewAgentModalProps) {
  // Mode toggle (local vs remote)
  const [mode, setMode] = useState<ModalMode>('local')

  // Local mode state
  const [tab, setTab] = useState<ModalTab>('new')
  const [task, setTask] = useState('')
  const [workdir, setWorkdir] = useState('')
  const [name, setName] = useState('')
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('autonomous')

  // Import-specific state
  const [sessionId, setSessionId] = useState('')
  const [importMode, setImportMode] = useState<'browse' | 'session' | 'continue'>('browse')
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionFilter, setSessionFilter] = useState('')

  // Remote mode state
  const [remoteHost, setRemoteHost] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [discoveryError, setDiscoveryError] = useState('')
  const [discoveredSessions, setDiscoveredSessions] = useState<RemoteSessionInfo[] | null>(null)
  const [selectedSession, setSelectedSession] = useState<(RemoteSessionInfo & { user: string; host: string }) | null>(null)
  const [showNewSessionForm, setShowNewSessionForm] = useState(false)
  const [remoteWorkdir, setRemoteWorkdir] = useState('')

  const taskRef = useRef<HTMLTextAreaElement>(null)
  const sessionRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (tab === 'new') taskRef.current?.focus()
  }, [tab])

  // Load sessions when switching to import tab
  useEffect(() => {
    if (tab === 'import' && sessions.length === 0 && !sessionsLoading) {
      setSessionsLoading(true)
      window.api.listSessions().then((s) => {
        setSessions(s)
        setSessionsLoading(false)
      })
    }
  }, [tab])

  const handleSelectDir = useCallback(async () => {
    const dir = await window.api.selectDirectory()
    if (dir) setWorkdir(dir)
  }, [])

  const handleDiscoverSessions = useCallback(async () => {
    if (!remoteHost.includes('@')) {
      setDiscoveryError('Invalid format. Use: user@hostname')
      return
    }

    const [user, host] = remoteHost.split('@')
    setDiscovering(true)
    setDiscoveryError('')
    setDiscoveredSessions(null)

    try {
      console.log(`[Frontend] Starting discovery for ${user}@${host}`)
      const result = await window.api.discoverRemoteSessions(user, host)
      console.log(`[Frontend] Discovery succeeded, found ${result.sessions.length} sessions`)
      setDiscoveredSessions(result.sessions)
      if (result.sessions.length === 0) {
        setDiscoveryError('No Claude sessions found on remote. You can create a new one.')
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to discover sessions. Check SSH connection.'
      console.error(`[Frontend] Discovery failed: ${errorMsg}`)
      setDiscoveryError(errorMsg)
    } finally {
      setDiscovering(false)
    }
  }, [remoteHost])

  const selectSession = useCallback((session: RemoteSessionInfo) => {
    const [user, host] = remoteHost.split('@')
    setSelectedSession({
      sessionName: session.sessionName,
      workdir: session.workdir,
      user,
      host
    })
  }, [remoteHost])

  const proceedWithNewSession = useCallback(() => {
    if (!remoteWorkdir) return
    const [user, host] = remoteHost.split('@')
    setSelectedSession({
      sessionName: undefined as any,
      workdir: remoteWorkdir,
      user,
      host
    })
  }, [remoteHost, remoteWorkdir])

  const handleCreate = useCallback(async () => {
    if (mode === 'local') {
      if (!workdir) return

      // Use folder name as default if name is empty
      const folderName = workdir.split('/').pop() || 'agent'
      const agentName = name.trim() || folderName

      await window.api.createAgent({
        task: task.trim(),
        workdir,
        name: agentName,
        model,
        permissionMode
      })
    } else {
      // Remote mode
      if (!selectedSession) return

      // Existing session: no task required, no new Claude spawned
      if (selectedSession.sessionName) {
        await window.api.createRemoteAgent({
          user: selectedSession.user,
          host: selectedSession.host,
          workdir: selectedSession.workdir,
          sessionName: selectedSession.sessionName,
          task: '', // Empty task for existing sessions
          name: name.trim() || undefined,
          model,
          permissionMode
        })
      }
      // New session: task is required
      else if (task.trim()) {
        await window.api.createRemoteAgent({
          user: selectedSession.user,
          host: selectedSession.host,
          workdir: selectedSession.workdir,
          sessionName: undefined, // Will be generated
          task: task.trim(),
          name: name.trim() || undefined,
          model,
          permissionMode
        })
      } else {
        return
      }
    }

    onClose()
  }, [mode, task, name, model, permissionMode, selectedSession, onClose])

  const handleImport = useCallback(async () => {
    if (importMode === 'browse') {
      // Should have selected a session from the list
      if (!sessionId || !workdir) return
    } else if (importMode === 'session') {
      if (!sessionId.trim() || !workdir) return
    } else {
      if (!workdir) return
    }

    await window.api.importAgent({
      workdir,
      name: name.trim() || undefined,
      sessionId: importMode !== 'continue' ? sessionId.trim() : undefined,
      continueRecent: importMode === 'continue',
      model,
      permissionMode
    })

    onClose()
  }, [workdir, name, sessionId, importMode, model, permissionMode, onClose])

  const handleSelectSession = useCallback((s: SessionInfo) => {
    setSessionId(s.sessionId)
    setWorkdir(s.project)

  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && e.metaKey) {
        e.preventDefault()
        if (tab === 'new') handleCreate()
        else handleImport()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [tab, handleCreate, handleImport, onClose]
  )

  const filteredSessions = sessions.filter((s) => {
    if (!sessionFilter) return true
    const q = sessionFilter.toLowerCase()
    return (
      s.summary.toLowerCase().includes(q) ||
      s.project.toLowerCase().includes(q) ||
      s.sessionId.toLowerCase().includes(q)
    )
  })

  const canCreate =
    mode === 'local'
      ? tab === 'new'
        ? !!workdir
        : importMode === 'continue'
          ? !!workdir
          : !!(sessionId.trim() && workdir)
      : selectedSession
        ? // For existing sessions, no task needed
          selectedSession.sessionName
          ? true
          : // For new sessions, task is required
            !!task.trim()
        : false

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) (e.currentTarget as HTMLElement).dataset.backdropDown = '1' }}
      onMouseUp={(e) => { if (e.target === e.currentTarget && (e.currentTarget as HTMLElement).dataset.backdropDown) onClose(); delete (e.currentTarget as HTMLElement).dataset.backdropDown }}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-surface-1 border border-border rounded-xl w-[600px] max-h-[85vh] flex flex-col shadow-2xl">
        {/* Mode toggle */}
        <div className="px-5 pt-4 pb-2 border-b border-border shrink-0">
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => {
                setMode('local')
                setSelectedSession(null)
                setDiscoveryError('')
                setDiscoveredSessions(null)
              }}
              className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                mode === 'local'
                  ? 'bg-accent/15 border-accent/40 text-accent border'
                  : 'bg-surface-2 text-text-secondary border border-border hover:text-text-primary'
              }`}
            >
              Local
            </button>
            <button
              onClick={() => {
                setMode('remote')
                setTab('new')
                setDiscoveryError('')
                setDiscoveredSessions(null)
              }}
              className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                mode === 'remote'
                  ? 'bg-accent/15 border-accent/40 text-accent border'
                  : 'bg-surface-2 text-text-secondary border border-border hover:text-text-primary'
              }`}
            >
              Remote (SSH)
            </button>
          </div>
        </div>

        {/* Header with tabs */}
        {mode === 'local' && (
          <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setTab('new')}
                className={`text-sm font-semibold transition-colors ${
                  tab === 'new' ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                New Agent
              </button>
              <button
                onClick={() => setTab('import')}
                className={`text-sm font-semibold transition-colors ${
                  tab === 'import' ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                Import Session
              </button>
            </div>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-secondary text-lg leading-none"
            >
              x
            </button>
          </div>
        )}

        {/* Remote header */}
        {mode === 'remote' && (
          <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
            <h2 className="text-sm font-semibold text-text-primary">Create Remote Agent</h2>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-secondary text-lg leading-none"
            >
              x
            </button>
          </div>
        )}

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* LOCAL MODE CONTENT */}
          {mode === 'local' && (
            <>
              {/* New Agent tab */}
              {tab === 'new' && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    Task
                  </label>
                  <textarea
                    ref={taskRef}
                    value={task}
                    onChange={(e) => setTask(e.target.value)}
                    placeholder="Describe what the agent should do..."
                    rows={3}
                    className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-border-focus transition-colors"
                  />
                </div>
              )}

              {/* Import Session tab */}
              {tab === 'import' && (
                <>
                  {/* Mode selector */}
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">
                      Resume Method
                    </label>
                    <div className="flex gap-1.5">
                      {[
                        { key: 'browse' as const, label: 'Browse Sessions', desc: 'Pick from recent sessions' },
                        { key: 'session' as const, label: 'By ID', desc: 'Enter a session ID or name' },
                        { key: 'continue' as const, label: 'Continue Recent', desc: 'Most recent in directory' }
                      ].map((m) => (
                        <button
                          key={m.key}
                          onClick={() => setImportMode(m.key)}
                          className={`flex-1 px-2 py-2 rounded-lg text-xs transition-colors border ${
                            importMode === m.key
                              ? 'bg-accent/15 border-accent/40 text-accent font-medium'
                              : 'bg-surface-2 border-border text-text-secondary hover:text-text-primary'
                          }`}
                        >
                          <div className="font-medium mb-0.5">{m.label}</div>
                          <div className="text-text-muted text-[10px]">{m.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {importMode === 'browse' && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <label className="text-xs font-medium text-text-secondary">Sessions</label>
                        {sessionsLoading && (
                          <span className="text-[10px] text-text-muted">Loading...</span>
                        )}
                      </div>
                      <input
                        value={sessionFilter}
                        onChange={(e) => setSessionFilter(e.target.value)}
                        placeholder="Filter sessions..."
                        className="w-full bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-focus transition-colors mb-2"
                      />
                      <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
                        {filteredSessions.length === 0 ? (
                          <div className="px-3 py-4 text-center text-text-muted text-xs">
                            {sessionsLoading ? 'Scanning sessions...' : 'No sessions found'}
                          </div>
                        ) : (
                          filteredSessions.map((s) => (
                            <button
                              key={s.sessionId}
                              onClick={() => handleSelectSession(s)}
                              className={`w-full text-left px-3 py-2 border-b border-border last:border-b-0 transition-colors ${
                                sessionId === s.sessionId
                                  ? 'bg-accent/10'
                                  : 'hover:bg-surface-2'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-xs text-text-primary line-clamp-1 font-medium">
                                  {s.summary}
                                </span>
                                <span className="text-[10px] text-text-muted shrink-0 ml-2">
                                  {timeAgo(s.mtime)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-text-muted truncate">
                                  {truncatePath(s.project)}
                                </span>
                                <span className="text-[10px] text-text-muted font-mono shrink-0 ml-2">
                                  {s.sessionId.substring(0, 8)}
                                </span>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {importMode === 'session' && (
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        Session ID or Name
                      </label>
                      <input
                        ref={sessionRef}
                        value={sessionId}
                        onChange={(e) => setSessionId(e.target.value)}
                        placeholder="e.g. 550e8400-e29b-... or auth-refactor"
                        className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted font-mono focus:outline-none focus:border-border-focus transition-colors"
                      />
                      <p className="text-[10px] text-text-muted mt-1">
                        Find session IDs with: claude --resume (shows picker)
                      </p>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* REMOTE MODE CONTENT */}
          {mode === 'remote' && !selectedSession && (
            <div className="space-y-3">
              {/* User@Host Input */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  Remote Host
                </label>
                <input
                  type="text"
                  placeholder="user@hostname (e.g., dan@10.0.0.249)"
                  value={remoteHost}
                  onChange={(e) => setRemoteHost(e.target.value)}
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-focus transition-colors"
                />
                <p className="text-[10px] text-text-muted mt-1">
                  Public key auth required. Ensure SSH keys are configured.
                </p>
              </div>

              {/* Discover Button */}
              <button
                onClick={handleDiscoverSessions}
                disabled={!remoteHost || discovering}
                className="w-full px-3 py-2 bg-accent hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
              >
                {discovering ? 'Discovering...' : 'Discover Sessions'}
              </button>

              {/* Error Display */}
              {discoveryError && (
                <div className="p-3 bg-status-error/10 border border-status-error/30 rounded text-status-error text-xs">
                  {discoveryError}
                </div>
              )}

              {/* Session List */}
              {discoveredSessions && discoveredSessions.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    Existing Sessions
                  </label>
                  <div className="border border-border rounded divide-y max-h-40 overflow-y-auto">
                    {discoveredSessions.map((session) => (
                      <button
                        key={session.sessionName}
                        onClick={() => selectSession(session)}
                        className="w-full text-left px-3 py-2 hover:bg-surface-2 text-sm transition-colors"
                      >
                        <div className="font-medium text-text-primary">{session.sessionName}</div>
                        <div className="text-[11px] text-text-muted">{session.workdir}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Create New Option */}
              <button
                onClick={() => setShowNewSessionForm(true)}
                className="w-full px-3 py-2 border border-border rounded text-sm font-medium text-center text-text-primary hover:bg-surface-2 transition-colors"
              >
                Create New Remote Session
              </button>

              {/* New Session Form */}
              {showNewSessionForm && (
                <div className="space-y-3 p-3 bg-surface-2 rounded border border-border">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">
                      Working Directory
                    </label>
                    <input
                      type="text"
                      placeholder="/home/user/projects/my_project"
                      value={remoteWorkdir}
                      onChange={(e) => setRemoteWorkdir(e.target.value)}
                      className="w-full bg-surface-1 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-focus transition-colors"
                    />
                    <p className="text-[10px] text-text-muted mt-1">
                      Will be created if it doesn't exist.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowNewSessionForm(false)}
                      className="flex-1 px-3 py-2 border border-border rounded text-sm text-text-secondary hover:text-text-primary transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={proceedWithNewSession}
                      disabled={!remoteWorkdir}
                      className="flex-1 px-3 py-2 bg-accent hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed text-white rounded text-sm font-medium transition-colors"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Remote mode - session selected (attach to existing) */}
          {mode === 'remote' && selectedSession && selectedSession.sessionName && (
            <div className="space-y-3">
              {/* Existing session - just show details, no task needed */}
              <div className="p-3 bg-accent/10 border border-accent/30 rounded">
                <div className="text-xs font-medium text-accent mb-2">Attaching to Existing Session</div>
                <div className="text-sm">
                  <div className="font-medium text-text-primary">{selectedSession.sessionName}</div>
                  <div className="text-[11px] text-text-muted mt-1">{selectedSession.workdir}</div>
                </div>
                <p className="text-[11px] text-text-muted mt-2">
                  This will connect to your running Claude session without any modifications.
                </p>
              </div>
            </div>
          )}

          {/* Remote mode - new session (need task) */}
          {mode === 'remote' && selectedSession && !selectedSession.sessionName && (
            <div className="space-y-3">
              {/* New session indicator */}
              <div className="p-3 bg-accent/10 border border-accent/30 rounded">
                <div className="text-xs font-medium text-accent mb-2">Creating New Remote Session</div>
                <div className="text-[11px] text-text-muted">
                  {selectedSession.workdir}
                </div>
              </div>

              {/* Task field (required for new sessions) */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  Task <span className="text-status-error">*</span>
                </label>
                <textarea
                  ref={taskRef}
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  placeholder="Describe what the agent should do..."
                  rows={3}
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-border-focus transition-colors"
                />
              </div>
            </div>
          )}

          {/* Shared fields - Local mode */}
          {mode === 'local' && (
            <>
              {/* Directory — shared between tabs */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  Working Directory
                  {tab === 'import' && importMode === 'browse' && sessionId && (
                    <span className="text-text-muted font-normal ml-1">(auto-filled from session)</span>
                  )}
                </label>
                <div className="flex gap-2">
                  <div
                    className={`flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm truncate ${
                      workdir ? 'text-text-primary' : 'text-text-muted'
                    }`}
                  >
                    {workdir || 'Select a directory...'}
                  </div>
                  <button
                    onClick={handleSelectDir}
                    className="px-3 py-2 bg-surface-3 hover:bg-border text-text-secondary text-xs rounded-lg transition-colors shrink-0"
                  >
                    Browse
                  </button>
                </div>
              </div>

              {/* Name (optional) — shared */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  Name{' '}
                  <span className="text-text-muted font-normal">(optional)</span>
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    tab === 'new' && workdir
                      ? `Folder: ${workdir.split('/').pop()}`
                      : tab === 'new'
                        ? 'Auto-generated from task'
                        : 'Auto-generated from session'
                  }
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-focus transition-colors"
                />
              </div>

              {/* Model — shared */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  Model
                </label>
                <div className="flex gap-1.5">
                  {models.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setModel(m.value)}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs transition-colors border ${
                        model === m.value
                          ? 'bg-accent/15 border-accent/40 text-accent font-medium'
                          : 'bg-surface-2 border-border text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Permission Mode — shared */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  Permission Mode
                </label>
                <div className="space-y-1.5">
                  {permissionModes.map((pm) => (
                    <button
                      key={pm.value}
                      onClick={() => setPermissionMode(pm.value)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors border ${
                        permissionMode === pm.value
                          ? 'bg-accent/15 border-accent/40'
                          : 'bg-surface-2 border-border hover:bg-surface-3'
                      }`}
                    >
                      <span
                        className={`font-medium ${
                          permissionMode === pm.value
                            ? 'text-accent'
                            : 'text-text-primary'
                        }`}
                      >
                        {pm.label}
                      </span>
                      <span className="text-text-muted ml-2">{pm.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Shared fields - Remote mode (when session selected) */}
          {mode === 'remote' && selectedSession && (
            <>
              {/* Name (optional) */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  Name{' '}
                  <span className="text-text-muted font-normal">(optional)</span>
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Auto-generated from task"
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-focus transition-colors"
                />
              </div>

              {/* Model */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  Model
                </label>
                <div className="flex gap-1.5">
                  {models.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setModel(m.value)}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs transition-colors border ${
                        model === m.value
                          ? 'bg-accent/15 border-accent/40 text-accent font-medium'
                          : 'bg-surface-2 border-border text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Permission Mode */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                  Permission Mode
                </label>
                <div className="space-y-1.5">
                  {permissionModes.map((pm) => (
                    <button
                      key={pm.value}
                      onClick={() => setPermissionMode(pm.value)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors border ${
                        permissionMode === pm.value
                          ? 'bg-accent/15 border-accent/40'
                          : 'bg-surface-2 border-border hover:bg-surface-3'
                      }`}
                    >
                      <span
                        className={`font-medium ${
                          permissionMode === pm.value
                            ? 'text-accent'
                            : 'text-text-primary'
                        }`}
                      >
                        {pm.label}
                      </span>
                      <span className="text-text-muted ml-2">{pm.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between shrink-0">
          <span className="text-[10px] text-text-muted">
            {mode === 'local'
              ? `Cmd+Enter to ${tab === 'new' ? 'create' : 'import'}`
              : selectedSession
                ? `Cmd+Enter to ${selectedSession.sessionName ? 'attach' : 'create'}`
                : ''}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (mode === 'local') {
                  tab === 'new' ? handleCreate() : handleImport()
                } else {
                  handleCreate()
                }
              }}
              disabled={!canCreate}
              className="px-4 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
            >
              {mode === 'local'
                ? tab === 'new'
                  ? 'Create Agent'
                  : 'Import Session'
                : selectedSession
                  ? selectedSession.sessionName
                    ? 'Attach to Session'
                    : 'Create Remote Agent'
                  : 'Discover Sessions'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
