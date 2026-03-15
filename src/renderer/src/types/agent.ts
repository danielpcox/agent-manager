export type AgentStatus =
  | 'starting'
  | 'running'
  | 'waiting'
  | 'done'
  | 'error'
  | 'killed'
  | 'reconnecting'
  | 'disconnected'

export type PermissionMode = 'autonomous' | 'readonly' | 'plan'

export type ConversationEventType =
  | 'user_message'
  | 'assistant_text'
  | 'tool_use'
  | 'tool_result'
  | 'thinking'
  | 'error'
  | 'result_summary'

export interface ConversationEvent {
  id: string
  timestamp: number
  type: ConversationEventType
  content: string
  toolName?: string
  toolInput?: string
  isError?: boolean
}

export interface Agent {
  id: string
  name: string
  task: string
  workdir: string
  status: AgentStatus
  model: string
  permissionMode: PermissionMode
  sessionId: string | null
  remoteControlUrl: string | null
  createdAt: number
  updatedAt: number
  statusChangedAt: number
  runningTimeMs: number
  totalCostUsd: number
  tokenContext: number
  isUnread: boolean
  isTabled: boolean
  events: ConversationEvent[]
  isRemote?: boolean
  remoteHost?: string
  remoteSessionName?: string
}

export interface CreateAgentParams {
  name?: string
  task: string
  workdir: string
  model?: string
  permissionMode?: PermissionMode
}

export interface ImportAgentParams {
  name?: string
  workdir: string
  sessionId?: string
  continueRecent?: boolean
  model?: string
  permissionMode?: PermissionMode
}

export interface CreateRemoteAgentParams {
  user: string
  host: string
  workdir: string
  sessionName?: string
  task: string
  name?: string
  model?: string
  permissionMode?: PermissionMode
}

export interface DiscoverRemoteSessionsParams {
  user: string
  host: string
  keyPath?: string
}

export interface RemoteSessionInfo {
  sessionName: string
  workdir: string
}
