import { useState, useCallback, useRef, useEffect } from 'react'
import type { PermissionMode } from '../types/agent'

interface NewAgentModalProps {
  onClose: () => void
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

export function NewAgentModal({ onClose }: NewAgentModalProps) {
  const [task, setTask] = useState('')
  const [workdir, setWorkdir] = useState('')
  const [name, setName] = useState('')
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('autonomous')
  const taskRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    taskRef.current?.focus()
  }, [])

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && e.metaKey) {
        e.preventDefault()
        handleCreate()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [handleCreate, onClose]
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-surface-1 border border-border rounded-xl w-[520px] shadow-2xl">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">
            New Agent
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-secondary text-lg leading-none"
          >
            x
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Task */}
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

          {/* Directory */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Working Directory
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
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between">
          <span className="text-[10px] text-text-muted">Cmd+Enter to create</span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!task.trim() || !workdir}
              className="px-4 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
            >
              Create Agent
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
