import { useState, useCallback } from 'react'
import type { PermissionMode } from '../types/agent'
import { wsApi } from '../wsApi'

interface NewAgentModalProps {
  onClose: () => void
}

const models = [
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' }
]

const permissionModes: { value: PermissionMode; label: string }[] = [
  { value: 'autonomous', label: 'Autonomous' },
  { value: 'plan', label: 'Plan First' },
  { value: 'readonly', label: 'Read Only' }
]

export function NewAgentModal({ onClose }: NewAgentModalProps) {
  const [task, setTask] = useState('')
  const [workdir, setWorkdir] = useState('~/projects/')
  const [name, setName] = useState('')
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('autonomous')
  const [submitting, setSubmitting] = useState(false)
  const [confirmCreate, setConfirmCreate] = useState<{ resolvedPath: string } | null>(null)

  const canCreate = !!task.trim() && !!workdir.trim()

  const doCreate = useCallback(async (createWorkdir: boolean) => {
    setSubmitting(true)
    try {
      await wsApi.createAgent({
        task: task.trim(),
        workdir: workdir.trim(),
        name: name.trim() || undefined,
        model,
        permissionMode
      }, createWorkdir)
      onClose()
    } catch {
      setSubmitting(false)
    }
  }, [task, workdir, name, model, permissionMode, onClose])

  const handleCreate = useCallback(async () => {
    if (!canCreate || submitting) return
    const { exists, resolvedPath } = await wsApi.checkDir(workdir.trim())
    if (!exists) {
      setConfirmCreate({ resolvedPath })
    } else {
      doCreate(false)
    }
  }, [canCreate, submitting, workdir, doCreate])

  if (confirmCreate) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center px-6">
        <div className="bg-surface-1 rounded-2xl p-6 w-full max-w-sm space-y-4">
          <h3 className="text-base font-semibold text-text-primary">Create directory?</h3>
          <p className="text-sm text-text-secondary break-all font-mono">{confirmCreate.resolvedPath}</p>
          <p className="text-sm text-text-muted">This directory doesn't exist. Create it?</p>
          <div className="flex gap-3">
            <button
              onClick={() => setConfirmCreate(null)}
              className="flex-1 py-2.5 rounded-xl border border-border text-sm text-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={() => doCreate(true)}
              disabled={submitting}
              className="flex-1 py-2.5 rounded-xl bg-accent text-white text-sm font-medium disabled:opacity-30"
            >
              {submitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex flex-col justify-end"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-surface-1 rounded-t-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold text-text-primary">New Agent</h2>
          <button onClick={onClose} className="text-text-muted text-xl w-8 h-8 flex items-center justify-center">×</button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Task</label>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="Describe what the agent should do..."
              rows={4}
              className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-border-focus"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Working Directory</label>
            <input
              value={workdir}
              onChange={(e) => setWorkdir(e.target.value)}
              placeholder="/path/to/project"
              className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-focus font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Name <span className="text-text-muted font-normal">(optional)</span></label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Auto-generated from task"
              className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-focus"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Model</label>
            <div className="flex gap-1.5">
              {models.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setModel(m.value)}
                  className={`flex-1 px-2 py-2 rounded-xl text-xs border transition-colors ${
                    model === m.value
                      ? 'bg-accent/15 border-accent/40 text-accent font-medium'
                      : 'bg-surface-2 border-border text-text-secondary'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Permission Mode</label>
            <div className="flex gap-1.5">
              {permissionModes.map((pm) => (
                <button
                  key={pm.value}
                  onClick={() => setPermissionMode(pm.value)}
                  className={`flex-1 px-2 py-2 rounded-xl text-xs border transition-colors ${
                    permissionMode === pm.value
                      ? 'bg-accent/15 border-accent/40 text-accent font-medium'
                      : 'bg-surface-2 border-border text-text-secondary'
                  }`}
                >
                  {pm.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border shrink-0">
          <button
            onClick={handleCreate}
            disabled={!canCreate || submitting}
            className="w-full py-3.5 bg-accent hover:bg-accent-hover disabled:opacity-30 text-white font-semibold rounded-xl transition-colors"
          >
            {submitting ? 'Creating...' : 'Create Agent'}
          </button>
        </div>
      </div>
    </div>
  )
}
