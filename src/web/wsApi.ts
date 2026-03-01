import type { Agent, AgentStatus, ConversationEvent, CreateAgentParams } from './types/agent'

type Callback<T> = (data: T) => void

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

let ws: WebSocket | null = null
let reconnectDelay = 1000
let pingInterval: ReturnType<typeof setInterval> | null = null

const listeners = {
  ptyData: new Set<Callback<{ agentId: string; data: string }>>(),
  agentCreated: new Set<Callback<Agent>>(),
  agentStatusChanged: new Set<Callback<{ agentId: string; status: AgentStatus }>>(),
  agentUpdated: new Set<Callback<Agent>>(),
  agentEvent: new Set<Callback<{ agentId: string; event: ConversationEvent }>>(),
  agentRemoved: new Set<Callback<{ agentId: string }>>(),
  init: new Set<Callback<{ agents: Agent[] }>>(),
}

const pendingRequests = new Map<string, PendingRequest>()
let lastInitData: { agents: Agent[] } | null = null

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'
const connectionListeners = new Set<Callback<ConnectionStatus>>()
let currentStatus: ConnectionStatus = 'disconnected'

function setStatus(s: ConnectionStatus) {
  currentStatus = s
  connectionListeners.forEach(cb => cb(s))
}

export function onConnectionStatus(cb: Callback<ConnectionStatus>): () => void {
  connectionListeners.add(cb)
  cb(currentStatus)
  return () => connectionListeners.delete(cb)
}

function getWsUrl(): string {
  const params = new URLSearchParams(window.location.search)
  const pin = params.get('pin') || sessionStorage.getItem('wsPin') || ''
  if (pin) sessionStorage.setItem('wsPin', pin)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  return `${protocol}//${host}?pin=${pin}`
}

function connect() {
  setStatus('connecting')
  const url = getWsUrl()
  ws = new WebSocket(url)

  ws.onopen = () => {
    reconnectDelay = 1000
    setStatus('connected')
    if (pingInterval) clearInterval(pingInterval)
    pingInterval = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
    }, 30000)
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      switch (msg.type) {
        case 'init':
          lastInitData = { agents: msg.agents }
          listeners.init.forEach(cb => cb(lastInitData!))
          break
        case 'agent:ptyData':
          listeners.ptyData.forEach(cb => cb({ agentId: msg.agentId, data: msg.data }))
          break
        case 'agent:created':
          listeners.agentCreated.forEach(cb => cb(msg.agent))
          break
        case 'agent:statusChanged':
          listeners.agentStatusChanged.forEach(cb => cb({ agentId: msg.agentId, status: msg.status }))
          break
        case 'agent:updated':
          listeners.agentUpdated.forEach(cb => cb(msg.agent))
          break
        case 'agent:event':
          listeners.agentEvent.forEach(cb => cb({ agentId: msg.agentId, event: msg.event }))
          break
        case 'agent:removed':
          listeners.agentRemoved.forEach(cb => cb({ agentId: msg.agentId }))
          break
        case 'capturePane:response':
        case 'agent:created:response':
        case 'fs:checkDir:response': {
          const req = pendingRequests.get(msg.requestId)
          if (req) {
            pendingRequests.delete(msg.requestId)
            if (msg.type === 'capturePane:response') req.resolve(msg.data)
            else if (msg.type === 'agent:created:response') req.resolve(msg.agent)
            else req.resolve({ exists: msg.exists, resolvedPath: msg.resolvedPath })
          }
          break
        }
        case 'error': {
          if (msg.requestId) {
            const req = pendingRequests.get(msg.requestId)
            if (req) { pendingRequests.delete(msg.requestId); req.reject(new Error(msg.message)) }
          }
          break
        }
      }
    } catch (err) {
      console.error('[wsApi] parse error', err)
    }
  }

  ws.onclose = () => {
    setStatus('disconnected')
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null }
    setTimeout(connect, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, 30000)
  }

  ws.onerror = () => {
    ws?.close()
  }
}

function send(msg: object) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function sendWithResponse<T>(msg: object & { requestId: string }): Promise<T> {
  return new Promise((resolve, reject) => {
    pendingRequests.set(msg.requestId, { resolve: resolve as (v: unknown) => void, reject })
    send(msg)
    setTimeout(() => {
      if (pendingRequests.has(msg.requestId)) {
        pendingRequests.delete(msg.requestId)
        reject(new Error('Request timeout'))
      }
    }, 30000)
  })
}

let reqCounter = 0
function nextId(): string { return `req-${++reqCounter}` }

connect()

export const wsApi = {
  createAgent: (params: CreateAgentParams, createWorkdir = false): Promise<Agent> => {
    const requestId = nextId()
    return sendWithResponse<Agent>({ type: 'agent:create', requestId, params, createWorkdir })
  },
  checkDir: (dirPath: string): Promise<{ exists: boolean; resolvedPath: string }> => {
    const requestId = nextId()
    return sendWithResponse<{ exists: boolean; resolvedPath: string }>({ type: 'fs:checkDir', requestId, path: dirPath })
  },
  sendMessage: (agentId: string, message: string): Promise<void> => {
    send({ type: 'agent:sendMessage', agentId, message })
    return Promise.resolve()
  },
  writePty: (agentId: string, data: string): void => {
    send({ type: 'agent:writePty', agentId, data })
  },
  resizePtyForRedraw: (agentId: string, cols: number, rows: number): Promise<void> => {
    send({ type: 'agent:resizePtyForRedraw', agentId, cols, rows })
    return Promise.resolve()
  },
  killAgent: (agentId: string): Promise<void> => {
    send({ type: 'agent:kill', agentId })
    return Promise.resolve()
  },
  removeAgent: (agentId: string): Promise<void> => {
    send({ type: 'agent:remove', agentId })
    return Promise.resolve()
  },
  markRead: (agentId: string): Promise<void> => {
    send({ type: 'agent:markRead', agentId })
    return Promise.resolve()
  },
  renameAgent: (agentId: string, name: string): Promise<void> => {
    send({ type: 'agent:rename', agentId, name })
    return Promise.resolve()
  },
  tableAgent: (agentId: string, tabled: boolean): Promise<void> => {
    send({ type: 'agent:table', agentId, tabled })
    return Promise.resolve()
  },
  capturePane: (agentId: string): Promise<string> => {
    const requestId = nextId()
    send({ type: 'subscribe', agentId })
    return sendWithResponse<string>({ type: 'capturePane', requestId, agentId })
  },
  subscribeToAgent: (agentId: string): void => {
    send({ type: 'subscribe', agentId })
  },
  unsubscribeFromAgent: (agentId: string): void => {
    send({ type: 'unsubscribe', agentId })
  },
  onInit: (cb: (data: { agents: Agent[] }) => void): (() => void) => {
    listeners.init.add(cb)
    if (lastInitData) cb(lastInitData)
    return () => listeners.init.delete(cb)
  },
  onPtyData: (cb: (data: { agentId: string; data: string }) => void): (() => void) => {
    listeners.ptyData.add(cb)
    return () => listeners.ptyData.delete(cb)
  },
  onAgentCreated: (cb: (agent: Agent) => void): (() => void) => {
    listeners.agentCreated.add(cb)
    return () => listeners.agentCreated.delete(cb)
  },
  onAgentStatusChanged: (cb: (data: { agentId: string; status: AgentStatus }) => void): (() => void) => {
    listeners.agentStatusChanged.add(cb)
    return () => listeners.agentStatusChanged.delete(cb)
  },
  onAgentUpdated: (cb: (agent: Agent) => void): (() => void) => {
    listeners.agentUpdated.add(cb)
    return () => listeners.agentUpdated.delete(cb)
  },
  onAgentEvent: (cb: (data: { agentId: string; event: ConversationEvent }) => void): (() => void) => {
    listeners.agentEvent.add(cb)
    return () => listeners.agentEvent.delete(cb)
  },
  onAgentRemoved: (cb: (data: { agentId: string }) => void): (() => void) => {
    listeners.agentRemoved.add(cb)
    return () => listeners.agentRemoved.delete(cb)
  },
}
