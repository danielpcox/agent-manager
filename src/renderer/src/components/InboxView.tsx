import { useState, useRef, useEffect } from 'react'
import { useAgentStore } from '../store/agentStore'
import { InboxCard } from './InboxCard'

type FilterTab = 'all' | 'active' | 'attention' | 'tabled'

const tabs: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Running' },
  { key: 'attention', label: 'Needs Attention' },
  { key: 'tabled', label: 'Tabled' }
]

interface InboxViewProps {
  onNewAgent: () => void
}

export function InboxView({ onNewAgent }: InboxViewProps) {
  const {
    filterTab,
    setFilterTab,
    filteredAgents,
    selectAgent,
    markRead,
    attentionCount,
    agents
  } = useAgentStore()

  const [searchQuery, setSearchQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // Cmd+F to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'f') {
        const tag = (e.target as HTMLElement)?.tagName
        // Don't steal focus from terminal
        if (tag !== 'TEXTAREA') {
          e.preventDefault()
          searchRef.current?.focus()
          searchRef.current?.select()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const filtered = filteredAgents()
  const visible = searchQuery
    ? filtered.filter((a) => {
        const q = searchQuery.toLowerCase()
        return (
          a.name.toLowerCase().includes(q) ||
          a.workdir.toLowerCase().includes(q) ||
          a.task.toLowerCase().includes(q) ||
          a.model.toLowerCase().includes(q)
        )
      })
    : filtered
  const attention = attentionCount()

  const handleSelect = (agentId: string) => {
    selectAgent(agentId)
    markRead(agentId)
    window.api.markRead(agentId)
  }

  return (
    <div className="w-80 shrink-0 bg-surface-0 border-r border-border flex flex-col pt-[38px]">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-text-primary">Inbox</h2>
          {attention > 0 && (
            <span className="bg-status-waiting/20 text-status-waiting text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {attention}
            </span>
          )}
        </div>
        <button
          onClick={onNewAgent}
          className="text-xs text-accent hover:text-accent-hover transition-colors font-medium"
        >
          + New Agent
        </button>
      </div>

      {/* Search */}
      <div className="px-4 pb-2">
        <input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearchQuery('')
              searchRef.current?.blur()
            }
          }}
          placeholder="Search agents..."
          className="w-full px-2.5 py-1.5 bg-surface-2 border border-border rounded-md text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-border-focus transition-colors"
        />
      </div>

      {/* Filter tabs */}
      <div className="px-4 pb-2 flex gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilterTab(tab.key)}
            className={`px-2 py-1 rounded-md text-xs transition-colors ${
              filterTab === tab.key
                ? 'bg-surface-3 text-text-primary font-medium'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Inbox list */}
      <div className="flex-1 overflow-y-auto px-2">
        {agents.length === 0 ? (
          <div className="px-4 py-12 text-center text-text-muted text-sm">
            <div className="text-3xl mb-3 opacity-30">&#9671;</div>
            <div className="mb-1">No agents running</div>
            <div className="text-xs">
              Create your first agent to get started
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-8 text-center text-text-muted text-xs">
            {searchQuery ? 'No agents match your search.' : 'No agents match this filter.'}
          </div>
        ) : (() => {
          const active = visible.filter((a) => !a.isTabled)
          const tabled = visible.filter((a) => a.isTabled)
          return (
            <>
              {active.map((agent) => (
                <InboxCard
                  key={agent.id}
                  agent={agent}
                  onClick={() => handleSelect(agent.id)}
                />
              ))}
              {tabled.length > 0 && (
                <>
                  <div className="border-t border-border my-2 mx-1" />
                  <div className="px-2 pb-1 text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                    Tabled
                  </div>
                  {tabled.map((agent) => (
                    <InboxCard
                      key={agent.id}
                      agent={agent}
                      tabled
                      onClick={() => handleSelect(agent.id)}
                    />
                  ))}
                </>
              )}
            </>
          )
        })()}
      </div>
    </div>
  )
}
