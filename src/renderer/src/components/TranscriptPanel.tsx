import { useEffect, useRef, useState } from 'react'
import type { TranscriptEntry } from '../types/stats'

interface Props {
  sessionId: string
  workdir: string
  onSelectFile?: (filePath: string) => void
}

// Detect absolute file paths in text (e.g. /path/to/file.txt, /Users/name/project/src/app.ts)
function linkifyPaths(text: string, onSelectFile?: (path: string) => void): (string | JSX.Element)[] {
  // Match absolute paths: /... with at least one dot (file extension)
  // Allow alphanumeric, dots, hyphens, underscores
  const pathRegex = /(\/[a-zA-Z0-9._/-]+\.[a-zA-Z0-9]+)/g

  const parts: (string | JSX.Element)[] = []
  let lastIndex = 0
  let matchIndex = 0

  for (const match of text.matchAll(pathRegex)) {
    const path = match[0]
    const start = match.index!

    // Add text before the match
    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start))
    }

    // Add the clickable path
    parts.push(
      <button
        key={`path-${matchIndex++}`}
        onClick={() => onSelectFile?.(path)}
        disabled={!onSelectFile}
        className={`inline ${
          onSelectFile
            ? 'text-accent hover:underline cursor-pointer'
            : 'text-text-secondary'
        }`}
        title={path}
      >
        {path}
      </button>
    )

    lastIndex = start + path.length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(true)
  return (
    <div className="my-1 rounded border border-border/50 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1 text-[10px] text-text-muted hover:text-text-secondary bg-surface-1 hover:bg-surface-2 transition-colors text-left"
      >
        <span className="opacity-60">{expanded ? '▾' : '▸'}</span>
        <span className="font-medium uppercase tracking-wider">Thinking</span>
        <span className="ml-auto opacity-50">{content.length.toLocaleString()} chars</span>
      </button>
      {expanded && (
        <pre className="px-3 py-2 text-[11px] font-mono text-text-muted whitespace-pre-wrap leading-relaxed bg-surface-1/50">
          {content}
        </pre>
      )}
    </div>
  )
}

function ToolUseBlock({ toolName, content }: { toolName: string; content: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="my-1 rounded border border-border/40 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1 text-[10px] text-text-muted hover:text-text-secondary bg-surface-1 hover:bg-surface-2 transition-colors text-left"
      >
        <span className="opacity-60">{expanded ? '▾' : '▸'}</span>
        <span className="font-mono text-accent/80">{toolName}</span>
      </button>
      {expanded && content && (
        <pre className="px-3 py-2 text-[11px] font-mono text-text-muted whitespace-pre-wrap leading-relaxed bg-surface-1/50">
          {content}
        </pre>
      )}
    </div>
  )
}

function EntryView({ entry, onSelectFile }: { entry: TranscriptEntry; onSelectFile?: (path: string) => void }) {
  if (entry.role === 'user') {
    const text = entry.blocks.filter(b => b.type === 'text').map(b => b.content).join('\n')
    if (!text.trim()) return null
    return (
      <div className="mb-4">
        <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-1">You</div>
        <div className="text-sm text-text-primary bg-surface-2 rounded px-3 py-2 whitespace-pre-wrap leading-relaxed">
          {linkifyPaths(text, onSelectFile)}
        </div>
      </div>
    )
  }

  return (
    <div className="mb-4">
      <div className="text-[10px] text-accent uppercase tracking-wider font-semibold mb-1">Claude</div>
      {entry.blocks.map((block, i) => {
        if (block.type === 'thinking') {
          return <ThinkingBlock key={i} content={block.content} />
        }
        if (block.type === 'tool_use') {
          return <ToolUseBlock key={i} toolName={block.toolName!} content={block.content} />
        }
        if (block.type === 'text' && block.content.trim()) {
          return (
            <div key={i} className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed mt-1">
              {linkifyPaths(block.content, onSelectFile)}
            </div>
          )
        }
        return null
      })}
    </div>
  )
}

export function TranscriptPanel({ sessionId, workdir, onSelectFile }: Props) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    window.api.getSessionTranscript(sessionId, workdir)
      .then((e) => {
        setEntries(e as TranscriptEntry[])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [sessionId, workdir])

  // Scroll to bottom on load
  useEffect(() => {
    if (!loading) bottomRef.current?.scrollIntoView()
  }, [loading])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        Loading transcript…
      </div>
    )
  }

  if (!entries.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        No transcript found.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      {entries.map((entry, i) => <EntryView key={i} entry={entry} onSelectFile={onSelectFile} />)}
      <div ref={bottomRef} />
    </div>
  )
}
