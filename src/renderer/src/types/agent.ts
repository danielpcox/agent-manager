export type AgentStatus =
  | 'starting'
  | 'running'
  | 'waiting'
  | 'done'
  | 'error'
  | 'killed'

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
  turns: number
  isUnread: boolean
  isTabled: boolean
  events: ConversationEvent[]
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
