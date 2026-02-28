import { create } from 'zustand'
import type { Agent, AgentStatus, ConversationEvent, CreateAgentParams } from '../types/agent'

type FilterTab = 'all' | 'active' | 'attention' | 'tabled'

interface AgentStore {
  agents: Agent[]
  selectedAgentId: string | null
  filterTab: FilterTab

  // Actions
  setAgents: (agents: Agent[]) => void
  addAgent: (agent: Agent) => void
  updateAgent: (agent: Agent) => void
  updateAgentStatus: (agentId: string, status: AgentStatus) => void
  addAgentEvent: (agentId: string, event: ConversationEvent) => void
  removeAgent: (agentId: string) => void
  selectAgent: (agentId: string | null) => void
  setFilterTab: (tab: FilterTab) => void
  markRead: (agentId: string) => void

  // Derived
  filteredAgents: () => Agent[]
  selectedAgent: () => Agent | null
  unreadCount: () => number
  attentionCount: () => number
}

const statusPriority: Record<AgentStatus, number> = {
  waiting: 0,
  error: 1,
  running: 2,
  starting: 3,
  done: 4,
  killed: 5
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  selectedAgentId: null,
  filterTab: 'all',

  setAgents: (agents) => set({ agents }),

  addAgent: (agent) =>
    set((state) => ({ agents: [...state.agents, agent] })),

  updateAgent: (agent) =>
    set((state) => ({
      agents: state.agents.map((a) => (a.id === agent.id ? agent : a))
    })),

  updateAgentStatus: (agentId, status) =>
    set((state) => {
      const now = Date.now()
      return {
        agents: state.agents.map((a) => {
          if (a.id !== agentId) return a
          // Accumulate running time when leaving running/starting
          let runningTimeMs = a.runningTimeMs || 0
          if ((a.status === 'running' || a.status === 'starting') && status !== a.status) {
            runningTimeMs += now - (a.statusChangedAt || now)
          }
          return {
            ...a,
            status,
            updatedAt: now,
            statusChangedAt: now,
            runningTimeMs,
            isUnread:
              status === 'waiting' || status === 'done' || status === 'error'
                ? true
                : a.isUnread
          }
        })
      }
    }),

  addAgentEvent: (agentId, event) =>
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentId
          ? { ...a, events: [...a.events, event], updatedAt: Date.now() }
          : a
      )
    })),

  removeAgent: (agentId) =>
    set((state) => ({
      agents: state.agents.filter((a) => a.id !== agentId),
      selectedAgentId:
        state.selectedAgentId === agentId ? null : state.selectedAgentId
    })),

  selectAgent: (agentId) => set({ selectedAgentId: agentId }),

  setFilterTab: (tab) => set({ filterTab: tab }),

  markRead: (agentId) =>
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentId ? { ...a, isUnread: false } : a
      )
    })),

  filteredAgents: () => {
    const { agents, filterTab } = get()
    let filtered = agents

    switch (filterTab) {
      case 'all':
        filtered = agents.filter((a) => !a.isTabled)
        break
      case 'active':
        filtered = agents.filter((a) =>
          !a.isTabled && ['running', 'starting'].includes(a.status)
        )
        break
      case 'attention':
        filtered = agents.filter((a) =>
          !a.isTabled && ['waiting', 'error'].includes(a.status)
        )
        break
      case 'tabled':
        filtered = agents.filter((a) => a.isTabled)
        break
    }

    return filtered.sort((a, b) => {
      const pa = statusPriority[a.status] ?? 99
      const pb = statusPriority[b.status] ?? 99
      if (pa !== pb) return pa - pb
      return b.updatedAt - a.updatedAt
    })
  },

  selectedAgent: () => {
    const { agents, selectedAgentId } = get()
    return agents.find((a) => a.id === selectedAgentId) || null
  },

  unreadCount: () => get().agents.filter((a) => a.isUnread).length,

  attentionCount: () =>
    get().agents.filter((a) =>
      !a.isTabled && ['waiting', 'error'].includes(a.status)
    ).length
}))
