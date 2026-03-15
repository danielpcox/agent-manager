import { useEffect, useState } from 'react'
import type { SessionStats } from '../types/stats'

interface Props {
  sessionId: string
  workdir: string
  onSelectFile?: (filePath: string) => void
  isRemote?: boolean
  remoteHost?: string
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function relPath(filePath: string, workdir: string): string {
  if (filePath.startsWith(workdir + '/')) return filePath.slice(workdir.length + 1)
  return filePath
}

export function SessionStatsPanel({ sessionId, workdir, onSelectFile, isRemote, remoteHost }: Props) {
  const [stats, setStats] = useState<SessionStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    window.api.getSessionStats(sessionId, workdir, isRemote, remoteHost)
      .then((s) => { setStats(s as SessionStats | null); setLoading(false) })
      .catch(() => setLoading(false))
  }, [sessionId, workdir, isRemote, remoteHost])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        Loading session stats…
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        No session data found.
      </div>
    )
  }

  const totalTokens = stats.inputTokens + stats.outputTokens

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5 text-sm">
      {/* Identity */}
      {(stats.slug || stats.gitBranch) && (
        <section>
          <h3 className="text-[10px] uppercase tracking-wider font-semibold text-text-muted mb-2">Identity</h3>
          <div className="space-y-1">
            {stats.slug && (
              <div className="flex gap-2">
                <span className="text-text-muted w-24 shrink-0">Slug</span>
                <span className="text-text-primary font-mono text-xs">{stats.slug}</span>
              </div>
            )}
            {stats.gitBranch && (
              <div className="flex gap-2">
                <span className="text-text-muted w-24 shrink-0">Branch</span>
                <span className="text-text-primary font-mono text-xs">{stats.gitBranch}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Tokens */}
      <section>
        <h3 className="text-[10px] uppercase tracking-wider font-semibold text-text-muted mb-2">Tokens</h3>
        <div className="space-y-1">
          <div className="flex gap-2">
            <span className="text-text-muted w-24 shrink-0">Input</span>
            <span className="text-text-primary">{stats.inputTokens.toLocaleString()}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-text-muted w-24 shrink-0">Output</span>
            <span className="text-text-primary">{stats.outputTokens.toLocaleString()}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-text-muted w-24 shrink-0">Total</span>
            <span className="text-text-primary font-medium">{totalTokens.toLocaleString()}</span>
          </div>
          {(stats.cacheReadTokens > 0 || stats.cacheCreationTokens > 0) && (
            <>
              <div className="border-t border-border/50 my-1.5" />
              <div className="flex gap-2">
                <span className="text-text-muted w-24 shrink-0">Cache read</span>
                <span className="text-text-secondary">{stats.cacheReadTokens.toLocaleString()}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-text-muted w-24 shrink-0">Cache write</span>
                <span className="text-text-secondary">{stats.cacheCreationTokens.toLocaleString()}</span>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Activity */}
      <section>
        <h3 className="text-[10px] uppercase tracking-wider font-semibold text-text-muted mb-2">Activity</h3>
        <div className="space-y-1">
          <div className="flex gap-2">
            <span className="text-text-muted w-24 shrink-0">User msgs</span>
            <span className="text-text-primary">{stats.userMessageCount}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-text-muted w-24 shrink-0">Tool calls</span>
            <span className="text-text-primary">{stats.toolCallCount}</span>
          </div>
        </div>
      </section>

      {/* Timeline */}
      {(stats.firstActivity || stats.lastActivity) && (
        <section>
          <h3 className="text-[10px] uppercase tracking-wider font-semibold text-text-muted mb-2">Timeline</h3>
          <div className="space-y-1">
            {stats.firstActivity && (
              <div className="flex gap-2">
                <span className="text-text-muted w-24 shrink-0">Started</span>
                <span className="text-text-secondary text-xs">{formatDate(stats.firstActivity)}</span>
              </div>
            )}
            {stats.lastActivity && (
              <div className="flex gap-2">
                <span className="text-text-muted w-24 shrink-0">Last</span>
                <span className="text-text-secondary text-xs">{formatDate(stats.lastActivity)}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Files touched */}
      {stats.filesTouched.length > 0 && (
        <section>
          <h3 className="text-[10px] uppercase tracking-wider font-semibold text-text-muted mb-2">
            Files Touched ({stats.filesTouched.length})
          </h3>
          <div className="space-y-0.5">
            {stats.filesTouched.map((f) => (
              <button
                key={f}
                onClick={() => onSelectFile?.(f)}
                disabled={!onSelectFile}
                className={`w-full text-left font-mono text-[11px] truncate px-1.5 py-0.5 rounded transition-colors ${
                  onSelectFile
                    ? 'text-accent hover:bg-surface-2 active:bg-surface-3 cursor-pointer'
                    : 'text-text-secondary'
                }`}
                title={f}
              >
                {relPath(f, workdir)}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
