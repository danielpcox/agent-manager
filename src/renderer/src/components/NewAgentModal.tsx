import { useState, useCallback, useRef, useEffect } from 'react'
import type { PermissionMode } from '../types/agent'

interface NewAgentModalProps {
  onClose: () => void
}

type ModalTab = 'new' | 'import'

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

  const handleCreate = useCallback(async () => {
    if (!task.trim() || !workdir) return

    await window.api.createAgent({
      task: task.trim(),
      workdir,
      name: name.trim() || undefined,
      model,
      permissionMode
    })

    onClose()
  }, [task, workdir, name, model, permissionMode, onClose])

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
    setName(s.summary.substring(0, 30).replace(/[^a-zA-Z0-9\s-]/g, '').trim())
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
    tab === 'new'
      ? !!(task.trim() && workdir)
      : importMode === 'continue'
        ? !!workdir
        : !!(sessionId.trim() && workdir)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-surface-1 border border-border rounded-xl w-[600px] max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header with tabs */}
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

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {tab === 'new' ? (
            /* ---- New Agent tab ---- */
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
          ) : (
            /* ---- Import Session tab ---- */
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
              placeholder={tab === 'new' ? 'Auto-generated from task' : 'Auto-generated from session'}
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
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between shrink-0">
          <span className="text-[10px] text-text-muted">
            Cmd+Enter to {tab === 'new' ? 'create' : 'import'}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={tab === 'new' ? handleCreate : handleImport}
              disabled={!canCreate}
              className="px-4 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
            >
              {tab === 'new' ? 'Create Agent' : 'Import Session'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
