import { useEffect, useState } from 'react'

interface Props {
  workdir: string
  isRemote?: boolean
  remoteHost?: string
}

export function MemoryPanel({ workdir, isRemote, remoteHost }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    window.api.getSessionMemory(workdir, isRemote, remoteHost)
      .then((c) => { setContent(c as string | null); setLoading(false) })
      .catch(() => setLoading(false))
  }, [workdir, isRemote, remoteHost])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        Loading memory…
      </div>
    )
  }

  if (!content) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        No memory file found for this project.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap leading-relaxed">
        {content}
      </pre>
    </div>
  )
}
