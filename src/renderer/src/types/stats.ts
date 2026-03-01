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
