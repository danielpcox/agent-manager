import { useEffect, useRef, useState } from 'react'
import { useAgentStore } from './store/agentStore'
import { Sidebar } from './components/Sidebar'
import { InboxView } from './components/InboxView'
import { AgentDetail } from './components/AgentDetail'
import { NewAgentModal } from './components/NewAgentModal'
import { UsageView } from './components/UsageView'
import { BtopView } from './components/BtopView'
import { GlobalStatsView } from './components/GlobalStatsView'
import type { Agent, AgentStatus, ConversationEvent } from './types/agent'
import type { SessionStats, GlobalStats, TranscriptEntry } from './types/stats'

export type AppView = 'agents' | 'usage' | 'btop' | 'stats'

declare global {
  interface Window {
    api: {
      createAgent: (params: unknown) => Promise<Agent>
      importAgent: (params: unknown) => Promise<Agent>
      sendMessage: (agentId: string, message: string) => Promise<void>
      sendScreenshot: (agentId: string, imageBase64: string, message: string) => Promise<void>
      writePty: (agentId: string, data: string) => Promise<void>
      resizePty: (agentId: string, cols: number, rows: number) => Promise<void>
      resizePtyForRedraw: (agentId: string, cols: number, rows: number) => Promise<void>
      enableRemoteControl: (agentId: string) => Promise<void>
      killAgent: (agentId: string) => Promise<void>
      removeAgent: (agentId: string) => Promise<void>
      markRead: (agentId: string) => Promise<void>
      renameAgent: (agentId: string, name: string) => Promise<void>
      tableAgent: (agentId: string, tabled: boolean) => Promise<void>
      setTerminalTabActive: (agentId: string, active: boolean) => void
      getAllAgents: () => Promise<Agent[]>
      getAgent: (agentId: string) => Promise<Agent | null>
      getOutputBuffer: (agentId: string, offset?: number, length?: number) => Promise<{ data: string; totalLength: number }>
      capturePane: (agentId: string) => Promise<string>
      selectDirectory: () => Promise<string | null>
      listSessions: () => Promise<{ sessionId: string; project: string; summary: string; timestamp: string; mtime: number }[]>
      onPtyData: (cb: (data: { agentId: string; data: string }) => void) => () => void
      onAgentCreated: (cb: (agent: Agent) => void) => () => void
      onAgentStatusChanged: (cb: (data: { agentId: string; status: AgentStatus }) => void) => () => void
      onAgentUpdated: (cb: (agent: Agent) => void) => () => void
      onAgentEvent: (cb: (data: { agentId: string; event: ConversationEvent }) => void) => () => void
      onAgentRemoved: (cb: (data: { agentId: string }) => void) => () => void
      startBtop: (cols: number, rows: number) => Promise<void>
      writeBtop: (data: string) => Promise<void>
      resizeBtop: (cols: number, rows: number) => Promise<void>
      stopBtop: () => Promise<void>
      onBtopData: (cb: (data: string) => void) => () => void
      getWebInfo: () => Promise<{ url: string; pin: string } | null>
      getSessionTranscript: (sessionId: string, workdir: string) => Promise<TranscriptEntry[]>
      getSessionStats: (sessionId: string, workdir: string) => Promise<SessionStats | null>
      getSessionMemory: (workdir: string) => Promise<string | null>
      getGlobalStats: () => Promise<GlobalStats | null>
    }
  }
}

function playDing(): void {
  const ctx = new AudioContext()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = 'sine'
  osc.frequency.setValueAtTime(880, ctx.currentTime)
  gain.gain.setValueAtTime(0.4, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2)
  osc.start()
  osc.stop(ctx.currentTime + 1.2)
}

export default function App() {
  const [showNewAgent, setShowNewAgent] = useState(false)
  const [view, setView] = useState<AppView>('agents')
  const [bellEnabled, setBellEnabled] = useState(() => localStorage.getItem('bellEnabled') === 'true')
  const toggleBell = () => setBellEnabled((prev) => {
    const next = !prev
    localStorage.setItem('bellEnabled', String(next))
    return next
  })
  const {
    agents,
    selectedAgentId,
    addAgent,
    updateAgent,
    updateAgentStatus,
    addAgentEvent,
    removeAgent,
    selectAgent,
    markRead,
    setAgents
  } = useAgentStore()

  useEffect(() => {
    window.api.getAllAgents().then(setAgents)

    const unsubs = [
      window.api.onAgentCreated((agent) => addAgent(agent)),
      window.api.onAgentStatusChanged(({ agentId, status }) =>
        updateAgentStatus(agentId, status as AgentStatus)
      ),
      window.api.onAgentUpdated((agent) => updateAgent(agent as Agent)),
      window.api.onAgentEvent(({ agentId, event }) =>
        addAgentEvent(agentId, event as ConversationEvent)
      ),
      window.api.onAgentRemoved(({ agentId }) => removeAgent(agentId))
    ]

    return () => unsubs.forEach((unsub) => unsub())
  }, [])

  // Bell notification: ding when an agent transitions running→waiting after >30s of running
  const prevStatusRef = useRef<Record<string, AgentStatus>>({})
  const runningStartRef = useRef<Record<string, number>>({})
  useEffect(() => {
    agents.forEach((agent) => {
      const prev = prevStatusRef.current[agent.id]
      if (prev !== agent.status) {
        if (agent.status === 'running' && prev !== 'running') {
          runningStartRef.current[agent.id] = Date.now()
        }
        if (prev === 'running' && agent.status === 'waiting') {
          const start = runningStartRef.current[agent.id] ?? 0
          if (bellEnabled && start > 0 && Date.now() - start > 30_000) {
            playDing()
          }
        }
        prevStatusRef.current[agent.id] = agent.status
      }
    })
  }, [agents, bellEnabled])

  // Global hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs/textareas
      const tag = (e.target as HTMLElement)?.tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA'

      // Cmd+N — new agent
      if (e.metaKey && e.key === 'n') {
        e.preventDefault()
        setShowNewAgent(true)
        return
      }

      // Cmd+1/2/3 — switch views
      if (e.metaKey && e.key === '1') {
        e.preventDefault()
        setView('agents')
        return
      }
      if (e.metaKey && e.key === '2') {
        e.preventDefault()
        setView('usage')
        return
      }
      if (e.metaKey && e.key === '3') {
        e.preventDefault()
        setView('btop')
        return
      }
      if (e.metaKey && e.key === '4') {
        e.preventDefault()
        setView('stats')
        return
      }

      // Cmd+E — focus terminal
      if (e.metaKey && e.key === 'e' && !isInput) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('focus-terminal'))
        return
      }

      // Cmd+[ / Cmd+] — prev/next agent (tag !== 'INPUT' allows xterm's hidden textarea)
      if (e.metaKey && (e.key === '[' || e.key === ']') && tag !== 'INPUT') {
        e.preventDefault()
        // Match sidebar order exactly: non-tabled, newest first
        const sorted = [...agents]
          .filter((a) => !a.isTabled)
          .sort((a, b) => b.createdAt - a.createdAt)
        if (sorted.length === 0) return

        const currentIdx = sorted.findIndex((a) => a.id === selectedAgentId)
        let nextIdx: number
        if (e.key === ']') {
          nextIdx = currentIdx < sorted.length - 1 ? currentIdx + 1 : 0
        } else {
          nextIdx = currentIdx > 0 ? currentIdx - 1 : sorted.length - 1
        }
        const next = sorted[nextIdx]
        setView('agents')
        selectAgent(next.id)
        markRead(next.id)
        window.api.markRead(next.id)
        return
      }

      // Cmd+W — close/deselect current agent detail (not kill)
      if (e.metaKey && e.key === 'w' && !isInput) {
        e.preventDefault()
        selectAgent(null)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [agents, selectedAgentId, selectAgent, markRead])

  return (
    <div className="h-screen flex bg-surface-0">
      {/* Draggable title bar area */}
      <div
        className="fixed top-0 left-0 right-0 h-[38px] z-50"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* Left sidebar */}
      <Sidebar
        onNewAgent={() => setShowNewAgent(true)}
        currentView={view}
        onViewChange={setView}
        bellEnabled={bellEnabled}
        onToggleBell={toggleBell}
      />

      {/* Center — inbox (always visible for agent overview) */}
      {view === 'agents' && (
        <InboxView onNewAgent={() => setShowNewAgent(true)} />
      )}

      {/* Right — always-mounted views, hidden when inactive */}
      <UsageView active={view === 'usage'} />
      {view === 'btop' && <BtopView />}
      {view === 'stats' && <GlobalStatsView />}
      {view === 'agents' && <AgentDetail />}

      {/* New agent modal */}
      {showNewAgent && (
        <NewAgentModal onClose={() => setShowNewAgent(false)} />
      )}
    </div>
  )
}
