export function UsageView() {
  return (
    <div className="flex-1 flex flex-col bg-surface-0 pt-[38px] min-w-0">
      <div className="px-4 py-3 border-b border-border shrink-0">
        <h2 className="text-sm font-semibold text-text-primary">Usage</h2>
        <p className="text-[11px] text-text-muted mt-0.5">
          claude.ai/settings/usage
        </p>
      </div>
      <div className="flex-1">
        <webview
          src="https://claude.ai/settings/usage"
          className="w-full h-full"
          // @ts-expect-error webview is an Electron-specific element
          allowpopups="true"
        />
      </div>
    </div>
  )
}
