import { useState, useRef, useCallback, useEffect } from 'react'

interface CompanionInputProps {
  agentId: string
  isActive: boolean
}

export function CompanionInput({ agentId, isActive }: CompanionInputProps) {
  const [message, setMessage] = useState('')
  const [screenshot, setScreenshot] = useState<string | null>(null) // base64
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null) // data URL
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [message])

  // Handle paste for screenshots
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const blob = item.getAsFile()
          if (!blob) continue

          const reader = new FileReader()
          reader.onload = () => {
            const dataUrl = reader.result as string
            setScreenshotPreview(dataUrl)
            // Extract base64 without the data URL prefix
            setScreenshot(dataUrl.split(',')[1])
          }
          reader.readAsDataURL(blob)
          break
        }
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [])

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file || !file.type.startsWith('image/')) return

      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        setScreenshotPreview(dataUrl)
        setScreenshot(dataUrl.split(',')[1])
      }
      reader.readAsDataURL(file)
    },
    []
  )

  const handleSend = useCallback(() => {
    if (!message.trim() && !screenshot) return

    if (screenshot) {
      window.api.sendScreenshot(agentId, screenshot, message.trim())
    } else {
      window.api.sendMessage(agentId, message.trim())
    }

    setMessage('')
    setScreenshot(null)
    setScreenshotPreview(null)
  }, [agentId, message, screenshot])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const clearScreenshot = useCallback(() => {
    setScreenshot(null)
    setScreenshotPreview(null)
  }, [])

  if (!isActive) return null

  return (
    <div className="px-3 py-2 border-t border-border shrink-0">
      {/* Screenshot preview */}
      {screenshotPreview && (
        <div className="mb-2 relative inline-block">
          <img
            src={screenshotPreview}
            alt="Screenshot"
            className="max-h-24 rounded-md border border-border"
          />
          <button
            onClick={clearScreenshot}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-surface-3 border border-border rounded-full flex items-center justify-center text-[10px] text-text-secondary hover:text-text-primary"
          >
            x
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Screenshot / file attach button */}
        <div className="flex gap-1 shrink-0 pb-0.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors text-sm"
            title="Attach image"
          >
            &#128247;
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message or paste a screenshot..."
          rows={1}
          className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-border-focus transition-colors"
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!message.trim() && !screenshot}
          className="shrink-0 px-3 py-2 bg-accent hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
        >
          Send
        </button>
      </div>

      <div className="text-[10px] text-text-muted mt-1 text-right">
        Enter to send &middot; Shift+Enter for newline &middot; Cmd+V to paste screenshot
      </div>
    </div>
  )
}
