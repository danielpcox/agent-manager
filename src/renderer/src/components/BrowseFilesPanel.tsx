import { useEffect, useState } from 'react'

interface FileEntry {
  path: string
  size: number
  isDir: boolean
}

interface BrowseFilesPanelProps {
  workdir: string
  onSelectFile: (path: string) => void
}

export function BrowseFilesPanel({ workdir, onSelectFile }: BrowseFilesPanelProps) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    setLoading(true)
    setError(null)
    window.api
      .listDir(workdir, workdir)
      .then((result) => {
        setFiles(result.files || [])
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [workdir])

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const filteredFiles = files.filter((f) =>
    f.path.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div className="flex-1 flex flex-col bg-surface-1 rounded-lg overflow-hidden">
      {/* Search Bar */}
      <div className="px-3 py-2 border-b border-border bg-surface-2">
        <input
          type="text"
          placeholder="Filter files…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full px-2 py-1.5 text-sm bg-surface-3 border border-border/50 rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/50"
        />
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            Loading files…
          </div>
        )}

        {error && (
          <div className="p-4 text-sm text-red-400">
            <p className="font-medium mb-1">Error</p>
            <p className="text-text-muted">{error}</p>
          </div>
        )}

        {!loading && !error && filteredFiles.length === 0 && (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            {filter ? 'No files match filter' : 'No files found'}
          </div>
        )}

        {!loading && !error && filteredFiles.length > 0 && (
          <div className="divide-y divide-border/30">
            {filteredFiles.map((file) => (
              <button
                key={file.path}
                onClick={() => !file.isDir && onSelectFile(file.path)}
                disabled={file.isDir}
                className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                  file.isDir
                    ? 'bg-surface-2 text-text-muted cursor-default'
                    : 'bg-surface-1 text-text-secondary hover:bg-surface-2 hover:text-text-primary active:bg-surface-3 cursor-pointer'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono truncate">
                    {file.isDir ? '📁 ' : '📄 '}
                    {file.path}
                  </span>
                  <span className="text-[10px] text-text-muted shrink-0 ml-auto">
                    {formatSize(file.size)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 text-[10px] text-text-muted border-t border-border bg-surface-2">
        {filteredFiles.length > 0 && (
          <p>
            {filteredFiles.length} file{filteredFiles.length === 1 ? '' : 's'}
            {filter && ` matching "${filter}"`}
          </p>
        )}
      </div>
    </div>
  )
}
