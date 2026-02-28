import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export function BtopView() {
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)

  useEffect(() => {
    if (!termRef.current) return

    const terminal = new Terminal({
      theme: {
        background: '#0a0a0f',
        foreground: '#e4e4ef',
        cursor: '#6c8cff',
        selectionBackground: '#6c8cff40'
      },
      fontSize: 12,
      fontFamily: "'SF Mono', 'Fira Code', Menlo, monospace",
      cursorBlink: false,
      scrollback: 1000,
      allowProposedApi: true
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(termRef.current)
    fitAddon.fit()
    terminalRef.current = terminal

    // Start btop (no-op if already running on main side)
    window.api.startBtop(terminal.cols, terminal.rows)

    // Handle btop output
    const unsub = window.api.onBtopData((data: string) => {
      terminal.write(data)
    })

    // Handle user input
    terminal.onData((data) => {
      window.api.writeBtop(data)
    })

    terminal.onResize(({ cols, rows }) => {
      window.api.resizeBtop(cols, rows)
    })

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
    })
    resizeObserver.observe(termRef.current)

    return () => {
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      unsub()
      // Don't stop btop — keep it running so we don't respawn on every tab switch
    }
  }, [])

  return (
    <div className="flex-1 flex flex-col bg-surface-0 pt-[38px] min-w-0">
      <div className="px-4 py-3 border-b border-border shrink-0">
        <h2 className="text-sm font-semibold text-text-primary">System Monitor</h2>
        <p className="text-[11px] text-text-muted mt-0.5">btop</p>
      </div>
      <div className="flex-1 min-h-0">
        <div ref={termRef} className="xterm-container" />
      </div>
    </div>
  )
}
