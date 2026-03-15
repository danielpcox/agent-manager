import { useEffect, useState } from 'react'

interface FileViewerModalProps {
  filePath: string
  workdir: string
  onClose: () => void
}

export function FileViewerModal({ filePath, workdir, onClose }: FileViewerModalProps) {
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
    window.api
      .readFile(filePath, workdir)
      .then((result) => {
        setContent(result.content)
        setSize(result.size)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [filePath, workdir])

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-2 rounded-lg shadow-lg flex flex-col max-h-[90vh] w-full max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border bg-surface-1 rounded-t-lg">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-surface-3 transition-colors text-sm text-text-secondary hover:text-text-primary"
            title="Close (Esc)"
          >
            ← Back
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-text-muted truncate">{filePath}</p>
            {size > 0 && !loading && !error && (
              <p className="text-[10px] text-text-muted mt-1">{formatSize(size)}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-surface-3 transition-colors text-text-muted hover:text-text-primary"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="flex items-center justify-center h-full text-text-muted">
              <p>Loading file…</p>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-full p-4">
              <div className="text-center">
                <p className="text-red-400 font-medium mb-2">Error reading file</p>
                <p className="text-sm text-text-muted">{error}</p>
              </div>
            </div>
          )}

          {!loading && !error && (
            <pre className="text-[11px] font-mono leading-relaxed p-4 whitespace-pre-wrap break-words text-text-primary">
              {content}
            </pre>
          )}
        </div>
      </div>

      {/* Close on Escape */}
      {typeof window !== 'undefined' &&
        useEffect(() => {
          const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
          }
          window.addEventListener('keydown', handler)
          return () => window.removeEventListener('keydown', handler)
        }, [onClose])}
    </div>
  )
}
