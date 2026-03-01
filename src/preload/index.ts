import { contextBridge, ipcRenderer } from 'electron'

export type AgentEventCallback = (data: unknown) => void

const api = {
  // Agent management
  createAgent: (params: unknown) => ipcRenderer.invoke('agent:create', params),
  importAgent: (params: unknown) => ipcRenderer.invoke('agent:import', params),
  sendMessage: (agentId: string, message: string) =>
    ipcRenderer.invoke('agent:sendMessage', { agentId, message }),
  sendScreenshot: (agentId: string, imageBase64: string, message: string) =>
    ipcRenderer.invoke('agent:sendScreenshot', { agentId, imageBase64, message }),
  writePty: (agentId: string, data: string) =>
    ipcRenderer.invoke('agent:writePty', { agentId, data }),
  resizePty: (agentId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('agent:resizePty', { agentId, cols, rows }),
  resizePtyForRedraw: (agentId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('agent:resizePtyForRedraw', { agentId, cols, rows }),
  enableRemoteControl: (agentId: string) =>
    ipcRenderer.invoke('agent:enableRemoteControl', { agentId }),
  killAgent: (agentId: string) => ipcRenderer.invoke('agent:kill', { agentId }),
  removeAgent: (agentId: string) => ipcRenderer.invoke('agent:remove', { agentId }),
  markRead: (agentId: string) => ipcRenderer.invoke('agent:markRead', { agentId }),
  renameAgent: (agentId: string, name: string) =>
    ipcRenderer.invoke('agent:rename', { agentId, name }),
  tableAgent: (agentId: string, tabled: boolean) =>
    ipcRenderer.invoke('agent:table', { agentId, tabled }),
  getAllAgents: () => ipcRenderer.invoke('agent:getAll'),
  getAgent: (agentId: string) => ipcRenderer.invoke('agent:get', { agentId }),
  getOutputBuffer: (agentId: string, offset?: number, length?: number) =>
    ipcRenderer.invoke('agent:getOutputBuffer', { agentId, offset, length }) as Promise<{ data: string; totalLength: number }>,
  capturePane: (agentId: string) =>
    ipcRenderer.invoke('agent:capturePane', { agentId }) as Promise<string>,
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  getWebInfo: () => ipcRenderer.invoke('web:getInfo') as Promise<{ url: string; pin: string } | null>,

  // Event listeners
  onPtyData: (callback: (data: { agentId: string; data: string }) => void) => {
    const handler = (_event: unknown, data: { agentId: string; data: string }) => callback(data)
    ipcRenderer.on('agent:ptyData', handler)
    return () => ipcRenderer.removeListener('agent:ptyData', handler)
  },
  onAgentCreated: (callback: (agent: unknown) => void) => {
    const handler = (_event: unknown, agent: unknown) => callback(agent)
    ipcRenderer.on('agent:created', handler)
    return () => ipcRenderer.removeListener('agent:created', handler)
  },
  onAgentStatusChanged: (
    callback: (data: { agentId: string; status: string }) => void
  ) => {
    const handler = (_event: unknown, data: { agentId: string; status: string }) =>
      callback(data)
    ipcRenderer.on('agent:statusChanged', handler)
    return () => ipcRenderer.removeListener('agent:statusChanged', handler)
  },
  onAgentUpdated: (callback: (agent: unknown) => void) => {
    const handler = (_event: unknown, agent: unknown) => callback(agent)
    ipcRenderer.on('agent:updated', handler)
    return () => ipcRenderer.removeListener('agent:updated', handler)
  },
  onAgentEvent: (
    callback: (data: { agentId: string; event: unknown }) => void
  ) => {
    const handler = (_event: unknown, data: { agentId: string; event: unknown }) =>
      callback(data)
    ipcRenderer.on('agent:event', handler)
    return () => ipcRenderer.removeListener('agent:event', handler)
  },
  onAgentRemoved: (callback: (data: { agentId: string }) => void) => {
    const handler = (_event: unknown, data: { agentId: string }) => callback(data)
    ipcRenderer.on('agent:removed', handler)
    return () => ipcRenderer.removeListener('agent:removed', handler)
  },

  // btop system monitor
  startBtop: (cols: number, rows: number) =>
    ipcRenderer.invoke('btop:start', { cols, rows }),
  writeBtop: (data: string) => ipcRenderer.invoke('btop:write', { data }),
  resizeBtop: (cols: number, rows: number) =>
    ipcRenderer.invoke('btop:resize', { cols, rows }),
  stopBtop: () => ipcRenderer.invoke('btop:stop'),
  onBtopData: (callback: (data: string) => void) => {
    const handler = (_event: unknown, data: string) => callback(data)
    ipcRenderer.on('btop:data', handler)
    return () => ipcRenderer.removeListener('btop:data', handler)
  },

  // Session intelligence
  getSessionTranscript: (sessionId: string, workdir: string) =>
    ipcRenderer.invoke('session:getTranscript', { sessionId, workdir }),
  getSessionStats: (sessionId: string, workdir: string) =>
    ipcRenderer.invoke('session:getStats', { sessionId, workdir }),
  getSessionMemory: (workdir: string) =>
    ipcRenderer.invoke('session:getMemory', { workdir }),
  getGlobalStats: () => ipcRenderer.invoke('stats:getGlobal')
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
