export interface SessionStats {
  slug: string | null
  gitBranch: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  toolCallCount: number
  userMessageCount: number
  filesTouched: string[]
  firstActivity: string | null
  lastActivity: string | null
}

export interface TranscriptBlock {
  type: 'thinking' | 'text' | 'tool_use' | 'tool_result'
  content: string
  toolName?: string
}

export interface TranscriptEntry {
  role: 'user' | 'assistant'
  timestamp: string | null
  blocks: TranscriptBlock[]
}

export interface GlobalStats {
  version: number
  lastComputedDate: string
  dailyActivity: {
    date: string
    messageCount: number
    sessionCount: number
    toolCallCount: number
  }[]
  dailyModelTokens: {
    date: string
    tokensByModel: Record<string, number>
  }[]
}
