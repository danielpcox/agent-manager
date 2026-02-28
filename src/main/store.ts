import Store from 'electron-store'
import type { Agent } from '../renderer/src/types/agent'

interface StoreSchema {
  agents: Agent[]
}

const store = new Store<StoreSchema>({
  name: 'agent-manager-data',
  defaults: {
    agents: []
  }
})

export function saveAgents(agents: Agent[]): void {
  // Strip events array to keep storage lean — only persist metadata
  const slim = agents.map((a) => ({
    ...a,
    events: a.events.slice(-100) // keep last 100 events per agent
  }))
  store.set('agents', slim)
}

export function loadAgents(): Agent[] {
  return store.get('agents', [])
}

export function clearAgents(): void {
  store.set('agents', [])
}
