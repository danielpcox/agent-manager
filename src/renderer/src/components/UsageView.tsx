import { useRef } from 'react'

export function UsageView({ active }: { active: boolean }) {
  const webviewRef = useRef<Electron.WebviewTag>(null)

  const handleReload = () => {
    webviewRef.current?.reload()
  }

  return (
    <div className={`flex-1 flex flex-col bg-surface-0 pt-[38px] min-w-0 ${active ? '' : 'hidden'}`}>
      <div className="px-4 py-3 border-b border-border shrink-0 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Usage</h2>
          <p className="text-[11px] text-text-muted mt-0.5">
            claude.ai/settings/usage
          </p>
        </div>
        <button
          onClick={handleReload}
          className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary border border-border hover:border-text-muted/50 rounded-md transition-colors"
          title="Reload usage data"
        >
          Reload
        </button>
      </div>
      <div className="flex-1">
        {/* @ts-expect-error webview is an Electron-specific element */}
        <webview
          ref={webviewRef}
          src="https://claude.ai/settings/usage"
          className="w-full h-full"
          allowpopups="true"
        />
      </div>
    </div>
  )
}
