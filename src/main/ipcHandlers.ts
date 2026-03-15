import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import readline from 'readline'
import { execSync } from 'child_process'
import { AgentManager } from './agentManager'
import { getWebInfo } from './webServer'
import { sshPool } from './sshConnection'

// Debug logging
const debugLogPath = path.join(os.homedir(), '.agent-manager-debug.log')
function debugLog(msg: string) {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${msg}`)
  try {
    fs.appendFileSync(debugLogPath, `[${timestamp}] ${msg}\n`)
  } catch (e) {
    // ignore
  }
}

interface SessionInfo {
  sessionId: string
  project: string
  summary: string
  timestamp: string
  mtime: number
}

function decodeClaudeProjectPath(encoded: string): string {
  // Claude encodes paths: '/' -> '-', '_' -> '-', prepend '-'
  // e.g. /Users/dan/projects/haze_map -> -Users-dan-projects-haze-map
  // This is lossy, so we walk the filesystem trying variants.
  const stripped = encoded.replace(/^-/, '')
  const parts = stripped.split('-')

  let resolved = '/'
  let i = 0
  while (i < parts.length) {
    let found = false
    // Try increasingly longer hyphenated segments
    for (let j = parts.length; j > i; j--) {
      const segment = parts.slice(i, j).join('-')
      // Try the segment as-is, then with underscores replacing hyphens
      const variants = [segment]
      if (segment.includes('-')) {
        variants.push(segment.replace(/-/g, '_'))
      }
      for (const variant of variants) {
        const testPath = path.join(resolved, variant)
        if (fs.existsSync(testPath)) {
          resolved = testPath
          i = j
          found = true
          break
        }
      }
      if (found) break
    }
    if (!found) {
      resolved = path.join(resolved, parts[i])
      i++
    }
  }
  return resolved
}

function extractSessionMeta(filePath: string): { summary: string; timestamp: string; cwd: string | null } | null {
  // Read the first ~20KB synchronously — enough to find cwd and first user message
  const fd = fs.openSync(filePath, 'r')
  const buf = Buffer.alloc(20480)
  const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0)
  fs.closeSync(fd)

  const chunk = buf.toString('utf-8', 0, bytesRead)
  const lines = chunk.split('\n')

  let cwd: string | null = null

  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const d = JSON.parse(line)
      // Grab cwd from the first message that has it
      if (!cwd && d.cwd) {
        cwd = d.cwd
      }
      if (d.type === 'user' && !d.isMeta) {
        const content = d.message?.content
        let summary = ''
        if (typeof content === 'string') {
          summary = content.substring(0, 150)
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'text') {
              summary = block.text.substring(0, 150)
              break
            }
          }
        }
        if (summary) {
          return { summary, timestamp: d.timestamp || '', cwd }
        }
      }
    } catch {
      continue
    }
  }
  return null
}

async function listClaudeSessions(): Promise<SessionInfo[]> {
  const base = path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(base)) return []

  const sessions: SessionInfo[] = []
  const projDirs = fs.readdirSync(base, { withFileTypes: true })

  for (const projDir of projDirs) {
    if (!projDir.isDirectory()) continue

    const projPath = path.join(base, projDir.name)
    const fallbackPath = decodeClaudeProjectPath(projDir.name)

    let files: string[]
    try {
      files = fs.readdirSync(projPath).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }

    for (const file of files) {
      try {
        const sessionId = file.replace('.jsonl', '')
        const filePath = path.join(projPath, file)
        const stat = fs.statSync(filePath)

        const result = extractSessionMeta(filePath)
        if (result) {
          sessions.push({
            sessionId,
            project: result.cwd || fallbackPath,
            summary: result.summary,
            timestamp: result.timestamp,
            mtime: stat.mtimeMs
          })
        }
      } catch {
        continue
      }
    }
  }

  sessions.sort((a, b) => b.mtime - a.mtime)
  return sessions
}

interface RemoteSessionInfo {
  sessionName: string
  workdir: string
}

async function discoverRemoteSessions(
  user: string,
  host: string,
  keyPath?: string
): Promise<{ sessions: RemoteSessionInfo[]; canConnect: boolean }> {
  try {
    console.log(`[Discovery] Starting session discovery for ${user}@${host}`)

    // Get or create SSH connection
    const ssh = await sshPool.getConnection({ user, host, keyPath })
    console.log(`[Discovery] SSH connection obtained`)

    // Test connection
    const testResult = await ssh.ping()
    if (!testResult) {
      throw new Error(
        `Cannot connect to ${user}@${host}. Check SSH configuration, network connectivity, and that the host is reachable.`
      )
    }
    console.log(`[Discovery] SSH connection test passed`)

    // List tmux sessions on remote: tmux list-sessions -F "#{session_name}|#{pane_current_path}"
    let sessionsOutput = ''
    try {
      console.log(`[Discovery] Listing tmux sessions...`)
      sessionsOutput = await ssh.exec(`tmux list-sessions -F "#{session_name}|#{pane_current_path}" 2>/dev/null || echo ""`)
      console.log(`[Discovery] Tmux output: ${sessionsOutput}`)
    } catch (err) {
      // tmux might not be running any sessions
      console.log(`[Discovery] Tmux command failed (might not have sessions):`, err)
      sessionsOutput = ''
    }

    const claudeSessions: RemoteSessionInfo[] = []

    for (const line of sessionsOutput.split('\n')) {
      if (!line.trim()) continue

      const [sessionName, workdir] = line.split('|')
      if (!sessionName) continue

      console.log(`[Discovery] Checking session "${sessionName}" at ${workdir}...`)

      // Get the current command in the main pane of this session
      try {
        const paneInfoOutput = await ssh.exec(
          `tmux list-panes -t "${sessionName}" -F "#{pane_current_command}" 2>/dev/null | head -1 || echo ""`
        )
        const paneCommand = paneInfoOutput.trim()
        console.log(`[Discovery] Session "${sessionName}" pane command: ${paneCommand}`)

        // Include the session if it has Claude or other useful commands
        if (paneCommand === 'claude' || paneCommand === 'bash' || paneCommand === '') {
          console.log(`[Discovery] ✓ Including session: "${sessionName}" (${paneCommand || 'shell'})`)
          claudeSessions.push({
            sessionName,
            workdir: workdir || '(unknown)'
          })
        } else {
          console.log(`[Discovery] ℹ Including session: "${sessionName}" (${paneCommand})`)
          claudeSessions.push({
            sessionName,
            workdir: workdir || '(unknown)'
          })
        }
      } catch (err) {
        // Include sessions even if we can't inspect them
        console.log(`[Discovery] Error checking session "${sessionName}" but including it anyway:`, err)
        claudeSessions.push({
          sessionName,
          workdir: workdir || '(unknown)'
        })
      }
    }

    console.log(`[Discovery] Found ${claudeSessions.length} tmux sessions`)
    return { sessions: claudeSessions, canConnect: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[Discovery] Failed to discover remote sessions: ${message}`)
    throw new Error(`Failed to discover remote sessions: ${message}`)
  }
}

function encodeProjectPath(absPath: string): string {
  return '-' + absPath.replace(/^\//, '').replace(/[/_]/g, '-')
}

function findSessionFile(sessionId: string, workdir: string): string | null {
  const base = path.join(os.homedir(), '.claude', 'projects')
  const candidate = path.join(base, encodeProjectPath(workdir), `${sessionId}.jsonl`)
  if (fs.existsSync(candidate)) return candidate
  if (!fs.existsSync(base)) return null
  for (const dir of fs.readdirSync(base)) {
    const p = path.join(base, dir, `${sessionId}.jsonl`)
    if (fs.existsSync(p)) return p
  }
  return null
}

function findMostRecentSessionFile(workdir: string): string | null {
  const base = path.join(os.homedir(), '.claude', 'projects', encodeProjectPath(workdir))
  if (!fs.existsSync(base)) return null
  let best: { path: string; mtime: number } | null = null
  for (const f of fs.readdirSync(base)) {
    if (!f.endsWith('.jsonl')) continue
    const p = path.join(base, f)
    try {
      const mtime = fs.statSync(p).mtimeMs
      if (!best || mtime > best.mtime) best = { path: p, mtime }
    } catch { /* ignore */ }
  }
  return best?.path ?? null
}

interface SessionStats {
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

async function parseSessionStats(sessionId: string, workdir: string): Promise<SessionStats | null> {
  const filePath = findMostRecentSessionFile(workdir) ?? findSessionFile(sessionId, workdir)
  if (!filePath) return null

  const stats: SessionStats = {
    slug: null,
    gitBranch: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    toolCallCount: 0,
    userMessageCount: 0,
    filesTouched: [],
    firstActivity: null,
    lastActivity: null
  }

  const filesTouchedSet = new Set<string>()

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  })

  let lineCount = 0
  for await (const line of rl) {
    // Yield to the event loop every 200 lines so PTY data events aren't starved
    if (++lineCount % 200 === 0) await new Promise<void>(r => setImmediate(r))
    if (!line.trim()) continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    if (!stats.slug && entry.sessionSlug) stats.slug = entry.sessionSlug as string
    if (!stats.gitBranch && entry.gitBranch) stats.gitBranch = entry.gitBranch as string

    const ts = entry.timestamp as string | undefined
    if (ts) {
      if (!stats.firstActivity) stats.firstActivity = ts
      stats.lastActivity = ts
    }

    if (entry.type === 'assistant') {
      const msg = entry.message as Record<string, unknown> | undefined
      if (msg?.usage) {
        const usage = msg.usage as Record<string, number>
        stats.inputTokens += usage.input_tokens || 0
        stats.outputTokens += usage.output_tokens || 0
        stats.cacheReadTokens += usage.cache_read_input_tokens || 0
        stats.cacheCreationTokens += usage.cache_creation_input_tokens || 0
      }
      const content = msg?.content
      if (Array.isArray(content)) {
        for (const block of content as Record<string, unknown>[]) {
          if (block?.type === 'tool_use') stats.toolCallCount++
        }
      }
    }

    if (entry.type === 'user' && !entry.isMeta) {
      stats.userMessageCount++
    }

    const toolResult = entry.toolUseResult as Record<string, unknown> | undefined
    if (toolResult?.filePath) {
      filesTouchedSet.add(toolResult.filePath as string)
    }
  }

  stats.filesTouched = [...filesTouchedSet].sort()
  return stats
}

interface TranscriptBlock {
  type: 'thinking' | 'text' | 'tool_use' | 'tool_result'
  content: string
  toolName?: string
}

interface TranscriptEntry {
  role: 'user' | 'assistant'
  timestamp: string | null
  blocks: TranscriptBlock[]
}

async function parseSessionTranscript(sessionId: string, workdir: string): Promise<TranscriptEntry[]> {
  const filePath = findMostRecentSessionFile(workdir) ?? findSessionFile(sessionId, workdir)
  if (!filePath) return []

  const entries: TranscriptEntry[] = []

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  })

  let lineCount = 0
  for await (const line of rl) {
    if (++lineCount % 200 === 0) await new Promise<void>(r => setImmediate(r))
    if (!line.trim()) continue
    let entry: Record<string, unknown>
    try { entry = JSON.parse(line) } catch { continue }

    const ts = (entry.timestamp as string) || null

    if (entry.type === 'user' && !entry.isMeta) {
      const content = (entry.message as Record<string, unknown>)?.content
      const blocks: TranscriptBlock[] = []
      if (typeof content === 'string') {
        if (content.trim()) blocks.push({ type: 'text', content })
      } else if (Array.isArray(content)) {
        for (const block of content as Record<string, unknown>[]) {
          if (block.type === 'text' && block.text) {
            blocks.push({ type: 'text', content: block.text as string })
          } else if (block.type === 'tool_result') {
            const inner = block.content
            const text = typeof inner === 'string' ? inner
              : Array.isArray(inner) ? (inner as Record<string, unknown>[]).filter(b => b.type === 'text').map(b => b.text).join('\n')
              : ''
            if (text) blocks.push({ type: 'tool_result', content: text })
          }
        }
      }
      if (blocks.length) entries.push({ role: 'user', timestamp: ts, blocks })
    }

    if (entry.type === 'assistant') {
      const content = (entry.message as Record<string, unknown>)?.content
      if (!Array.isArray(content)) continue
      const blocks: TranscriptBlock[] = []
      for (const block of content as Record<string, unknown>[]) {
        if (block.type === 'thinking' && block.thinking) {
          blocks.push({ type: 'thinking', content: block.thinking as string })
        } else if (block.type === 'text' && block.text) {
          blocks.push({ type: 'text', content: block.text as string })
        } else if (block.type === 'tool_use' && block.name) {
          const input = block.input ? JSON.stringify(block.input, null, 2) : ''
          blocks.push({ type: 'tool_use', content: input, toolName: block.name as string })
        }
      }
      if (blocks.length) entries.push({ role: 'assistant', timestamp: ts, blocks })
    }
  }

  return entries
}

function getSessionMemory(workdir: string): string | null {
  const base = path.join(os.homedir(), '.claude', 'projects')
  // Try encoded path directly
  const memPath = path.join(base, encodeProjectPath(workdir), 'memory', 'MEMORY.md')
  if (fs.existsSync(memPath)) return fs.readFileSync(memPath, 'utf-8')
  // Fallback: search all project dirs (handles encoding collisions)
  if (fs.existsSync(base)) {
    for (const dir of fs.readdirSync(base)) {
      const p = path.join(base, dir, 'memory', 'MEMORY.md')
      if (fs.existsSync(p)) {
        // Rough match: encoded dir should contain all path segments
        const segments = workdir.replace(/^\//, '').replace(/_/g, '-').split('/')
        if (segments.every((seg) => dir.includes(seg))) {
          return fs.readFileSync(p, 'utf-8')
        }
      }
    }
  }
  // Also check CLAUDE.md in the project workdir itself
  const claudePath = path.join(workdir, 'CLAUDE.md')
  if (fs.existsSync(claudePath)) return fs.readFileSync(claudePath, 'utf-8')
  return null
}

function getGlobalStats(): object | null {
  const p = path.join(os.homedir(), '.claude', 'stats-cache.json')
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

// Remote session handlers (over SSH)
async function parseSessionTranscriptRemote(sessionId: string, workdir: string, remoteHost: string): Promise<TranscriptEntry[]> {
  const [user, host] = remoteHost.split('@')
  try {
    const ssh = await sshPool.getConnection({ user, host })

    // Find the most recent .jsonl file (use ~ to expand to remote home dir)
    const encodedPath = encodeProjectPath(workdir)
    debugLog(`[parseSessionTranscriptRemote] Looking for files at ~/.claude/projects/${encodedPath}/*.jsonl on ${remoteHost}`)
    const findCmd = `ls -t ~/.claude/projects/${encodedPath}/*.jsonl 2>/dev/null | head -1`
    let filePath: string

    try {
      filePath = (await ssh.exec(findCmd)).trim()
      debugLog(`[parseSessionTranscriptRemote] Found file: ${filePath}`)
      if (!filePath) {
        debugLog(`[parseSessionTranscriptRemote] No session files found in ~/.claude/projects/${encodedPath}`)
        return []
      }
    } catch (err) {
      debugLog(`[parseSessionTranscriptRemote] Failed to find session files: ${err}`)
      return []
    }

    // Read the file content
    debugLog(`[parseSessionTranscriptRemote] Reading file: ${filePath}`)
    const content = await ssh.exec(`cat ${filePath}`)

    // Parse like local version
    const entries: TranscriptEntry[] = []
    const lines = content.split('\n')
    let lineCount = 0

    for (const line of lines) {
      if (!line.trim()) continue
      lineCount++
      let entry: Record<string, unknown>
      try { entry = JSON.parse(line) } catch (e) {
        debugLog(`[parseSessionTranscriptRemote] Failed to parse line ${lineCount}: ${e}`)
        continue
      }

      const ts = (entry.timestamp as string) || null
      const entryType = entry.type as string

      if (entry.type === 'user' && !entry.isMeta) {
        const content = (entry.message as Record<string, unknown>)?.content
        const blocks: TranscriptBlock[] = []
        if (typeof content === 'string') {
          if (content.trim()) blocks.push({ type: 'text', content })
        } else if (Array.isArray(content)) {
          for (const block of content as Record<string, unknown>[]) {
            if (block.type === 'text' && block.text) {
              blocks.push({ type: 'text', content: block.text as string })
            } else if (block.type === 'tool_result') {
              const inner = block.content
              const text = typeof inner === 'string' ? inner
                : Array.isArray(inner) ? (inner as Record<string, unknown>[]).filter(b => b.type === 'text').map(b => b.text).join('\n')
                : ''
              if (text) blocks.push({ type: 'tool_result', content: text })
            }
          }
        }
        if (blocks.length) entries.push({ role: 'user', timestamp: ts, blocks })
      }

      if (entry.type === 'assistant') {
        const content = (entry.message as Record<string, unknown>)?.content
        if (!Array.isArray(content)) continue
        const blocks: TranscriptBlock[] = []
        for (const block of content as Record<string, unknown>[]) {
          if (block.type === 'thinking' && block.thinking) {
            blocks.push({ type: 'thinking', content: block.thinking as string })
          } else if (block.type === 'text' && block.text) {
            blocks.push({ type: 'text', content: block.text as string })
          } else if (block.type === 'tool_use' && block.name) {
            const input = block.input ? JSON.stringify(block.input, null, 2) : ''
            blocks.push({ type: 'tool_use', content: input, toolName: block.name as string })
          }
        }
        if (blocks.length) entries.push({ role: 'assistant', timestamp: ts, blocks })
      }
    }

    debugLog(`[parseSessionTranscriptRemote] Parsed ${lineCount} lines, found ${entries.length} transcript entries`)
    return entries
  } catch (err) {
    console.error('[parseSessionTranscriptRemote]', err)
    return []
  }
}

async function parseSessionStatsRemote(sessionId: string, workdir: string, remoteHost: string): Promise<SessionStats | null> {
  const [user, host] = remoteHost.split('@')
  try {
    const ssh = await sshPool.getConnection({ user, host })

    // Find the most recent .jsonl file (use ~ to expand to remote home dir)
    const encodedPath = encodeProjectPath(workdir)
    const findCmd = `ls -t ~/.claude/projects/${encodedPath}/*.jsonl 2>/dev/null | head -1`
    let filePath: string

    try {
      filePath = (await ssh.exec(findCmd)).trim()
      if (!filePath) {
        console.log(`[parseSessionStatsRemote] No session files found in ~/.claude/projects/${encodedPath}`)
        return null
      }
    } catch (err) {
      console.error(`[parseSessionStatsRemote] Failed to find session files:`, err)
      return null
    }

    // Read the file content
    const content = await ssh.exec(`cat ${filePath}`)

    // Parse like local version
    const stats: SessionStats = {
      slug: null,
      gitBranch: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      toolCallCount: 0,
      userMessageCount: 0,
      filesTouched: [],
      firstActivity: null,
      lastActivity: null
    }

    const filesTouchedSet = new Set<string>()
    const lines = content.split('\n')

    for (const line of lines) {
      if (!line.trim()) continue
      let entry: Record<string, unknown>
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }

      if (!stats.slug && entry.sessionSlug) stats.slug = entry.sessionSlug as string
      if (!stats.gitBranch && entry.gitBranch) stats.gitBranch = entry.gitBranch as string

      const ts = entry.timestamp as string | undefined
      if (ts) {
        if (!stats.firstActivity) stats.firstActivity = ts
        stats.lastActivity = ts
      }

      if (entry.type === 'assistant') {
        const msg = entry.message as Record<string, unknown> | undefined
        if (msg?.usage) {
          const usage = msg.usage as Record<string, number>
          stats.inputTokens += usage.input_tokens || 0
          stats.outputTokens += usage.output_tokens || 0
          stats.cacheReadTokens += usage.cache_read_input_tokens || 0
          stats.cacheCreationTokens += usage.cache_creation_input_tokens || 0
        }
        const content = msg?.content
        if (Array.isArray(content)) {
          for (const block of content as Record<string, unknown>[]) {
            if (block?.type === 'tool_use') stats.toolCallCount++
          }
        }
      }

      if (entry.type === 'user' && !entry.isMeta) {
        stats.userMessageCount++
      }

      const toolResult = entry.toolUseResult as Record<string, unknown> | undefined
      if (toolResult?.filePath) {
        filesTouchedSet.add(toolResult.filePath as string)
      }
    }

    stats.filesTouched = [...filesTouchedSet].sort()
    return stats
  } catch (err) {
    console.error('[parseSessionStatsRemote]', err)
    return null
  }
}

async function getSessionMemoryRemote(workdir: string, remoteHost: string): Promise<string | null> {
  const [user, host] = remoteHost.split('@')
  try {
    const ssh = await sshPool.getConnection({ user, host })
    const encodedPath = encodeProjectPath(workdir)
    const memPath = `~/.claude/projects/${encodedPath}/memory/MEMORY.md`

    debugLog(`[getSessionMemoryRemote] Looking for memory at ${memPath} on ${remoteHost}`)

    try {
      const content = await ssh.exec(`cat ${memPath}`)
      debugLog(`[getSessionMemoryRemote] Found memory file, ${content.length} bytes`)
      return content
    } catch (err) {
      debugLog(`[getSessionMemoryRemote] Failed to read memory: ${err}`)
      // Try CLAUDE.md in workdir
      try {
        const content = await ssh.exec(`cat ${workdir}/CLAUDE.md`)
        debugLog(`[getSessionMemoryRemote] Found CLAUDE.md, ${content.length} bytes`)
        return content
      } catch {
        debugLog(`[getSessionMemoryRemote] No memory files found`)
        return null
      }
    }
  } catch (err) {
    debugLog(`[getSessionMemoryRemote] Error: ${err}`)
    return null
  }
}

let btopPty: pty.IPty | null = null

export function registerIpcHandlers(agentManager: AgentManager): void {
  ipcMain.handle('agent:create', async (_event, params) => {
    return agentManager.createAgent(params)
  })

  ipcMain.handle('agent:import', async (_event, params) => {
    return agentManager.importAgent(params)
  })

  ipcMain.handle('agent:createRemote', async (_event, params) => {
    return agentManager.createRemoteAgent(params)
  })

  ipcMain.handle('agent:discoverRemote', async (_event, { user, host, keyPath }) => {
    return discoverRemoteSessions(user, host, keyPath)
  })

  ipcMain.handle('agent:sendMessage', async (_event, { agentId, message }) => {
    agentManager.sendMessage(agentId, message)
  })

  ipcMain.handle(
    'agent:sendScreenshot',
    async (_event, { agentId, imageBase64, message }) => {
      const buffer = Buffer.from(imageBase64, 'base64')
      agentManager.sendScreenshot(agentId, buffer, message)
    }
  )

  ipcMain.handle('agent:writePty', async (_event, { agentId, data }) => {
    agentManager.writeToPty(agentId, data)
  })

  ipcMain.handle('agent:resizePty', async (_event, { agentId, cols, rows }) => {
    agentManager.resizePty(agentId, cols, rows)
  })

  ipcMain.handle('agent:resizePtyForRedraw', async (_event, { agentId, cols, rows }) => {
    agentManager.resizePtyForRedraw(agentId, cols, rows)
  })

  ipcMain.handle('agent:enableRemoteControl', async (_event, { agentId }) => {
    agentManager.enableRemoteControl(agentId)
  })

  ipcMain.handle('agent:kill', async (_event, { agentId }) => {
    agentManager.killAgent(agentId)
  })

  ipcMain.handle('agent:remove', async (_event, { agentId }) => {
    agentManager.removeAgent(agentId)
  })

  ipcMain.handle('agent:retryRemoteConnection', async (_event, { agentId }) => {
    agentManager.retryRemoteConnection(agentId)
  })

  ipcMain.handle('agent:markRead', async (_event, { agentId }) => {
    agentManager.markRead(agentId)
  })

  ipcMain.handle('agent:rename', async (_event, { agentId, name }) => {
    agentManager.renameAgent(agentId, name)
  })

  ipcMain.handle('agent:table', async (_event, { agentId, tabled }) => {
    agentManager.tableAgent(agentId, tabled)
  })

  ipcMain.on('agent:setTerminalTabActive', (_event, { agentId, active }) => {
    agentManager.setTerminalTabActive(agentId, active)
  })

  ipcMain.handle('agent:getAll', async () => {
    return agentManager.getAllAgents()
  })

  ipcMain.handle('agent:get', async (_event, { agentId }) => {
    return agentManager.getAgent(agentId)
  })

  ipcMain.handle('agent:getOutputBuffer', async (_event, { agentId, offset, length }) => {
    return agentManager.getOutputBuffer(agentId, offset, length)
  })

  ipcMain.handle('agent:capturePane', async (_event, { agentId }) => {
    return agentManager.capturePane(agentId)
  })

  ipcMain.handle('sessions:list', async () => {
    return listClaudeSessions()
  })

  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // btop management
  ipcMain.handle('btop:start', async (_event, { cols, rows }) => {
    if (btopPty) return

    const shell = process.env.SHELL || '/bin/zsh'
    btopPty = pty.spawn(shell, ['-l', '-c', 'btop'], {
      name: 'xterm-256color',
      cols,
      rows,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      } as Record<string, string>
    })

    const win = BrowserWindow.getFocusedWindow()
    btopPty.onData((data: string) => {
      win?.webContents.send('btop:data', data)
    })

    btopPty.onExit(() => {
      btopPty = null
    })
  })

  ipcMain.handle('btop:write', async (_event, { data }) => {
    btopPty?.write(data)
  })

  ipcMain.handle('btop:resize', async (_event, { cols, rows }) => {
    btopPty?.resize(cols, rows)
  })

  ipcMain.handle('btop:stop', async () => {
    if (btopPty) {
      btopPty.kill()
      btopPty = null
    }
  })

  ipcMain.handle('web:getInfo', async () => {
    return getWebInfo()
  })

  ipcMain.handle('session:getTranscript', async (_e, { sessionId, workdir, isRemote, remoteHost }) => {
    debugLog(`[IPC] session:getTranscript called: sessionId=${sessionId}, workdir=${workdir}, isRemote=${isRemote}, remoteHost=${remoteHost}`)
    if (isRemote && remoteHost) {
      return parseSessionTranscriptRemote(sessionId, workdir, remoteHost)
    }
    return parseSessionTranscript(sessionId, workdir)
  })

  ipcMain.handle('session:getStats', async (_e, { sessionId, workdir, isRemote, remoteHost }) => {
    if (isRemote && remoteHost) {
      return parseSessionStatsRemote(sessionId, workdir, remoteHost)
    }
    return parseSessionStats(sessionId, workdir)
  })

  ipcMain.handle('session:getMemory', async (_e, { workdir, isRemote, remoteHost }) => {
    debugLog(`[IPC] session:getMemory called: workdir=${workdir}, isRemote=${isRemote}, remoteHost=${remoteHost}`)
    if (isRemote && remoteHost) {
      return getSessionMemoryRemote(workdir, remoteHost)
    }
    return getSessionMemory(workdir)
  })

  ipcMain.handle('stats:getGlobal', async () => {
    return getGlobalStats()
  })

  // File reading and browsing
  const BINARY_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg',
    'pdf', 'zip', 'tar', 'gz', 'bz2', '7z', 'rar',
    'mp4', 'mp3', 'wav', 'flac', 'aac', 'ogg',
    'so', 'o', 'a', 'dylib', 'dll', 'exe', 'app',
    'pyc', 'pyo', 'class', 'jar'
  ])

  const IGNORE_DIRS = new Set([
    '.git', 'node_modules', '.next', 'dist', 'build', '.venv',
    '__pycache__', '.pytest_cache', '.tox', 'venv', 'env',
    '.idea', '.vscode', 'coverage', '.nyc_output'
  ])

  const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

  function isBinaryFile(filePath: string): boolean {
    const ext = path.extname(filePath).slice(1).toLowerCase()
    return BINARY_EXTENSIONS.has(ext)
  }

  function isSafeFile(filePath: string): boolean {
    // Prevent path traversal attacks by rejecting paths with .. or symlink escapes
    // Allow any absolute or relative path that doesn't try to escape
    const normalized = path.normalize(path.resolve(filePath))
    // Reject if it contains .. after normalization (would indicate traversal attempt)
    return !normalized.includes('/..')
  }

  ipcMain.handle('file:read', async (_e, { filePath, workdir, isRemote, remoteHost }) => {
    try {
      if (!isSafeFile(filePath)) {
        throw new Error('Invalid file path')
      }

      if (isRemote && remoteHost) {
        // Read file from remote machine via SSH
        const [user, host] = remoteHost.split('@')
        const ssh = await sshPool.getConnection({ user, host })

        // Use cat to read the file
        let content = ''
        try {
          content = await ssh.exec(`cat ${filePath} 2>/dev/null || echo ""`)
        } catch (err) {
          throw new Error(`Failed to read remote file: ${err}`)
        }

        // Check if binary (simple heuristic: null bytes)
        const isBinary = content.includes('\0')
        if (isBinary) {
          return { content: '[Binary file]', size: content.length, isBinary: true }
        }

        if (content.length > MAX_FILE_SIZE) {
          throw new Error(`File too large (${(content.length / 1024 / 1024).toFixed(1)}MB > 5MB limit)`)
        }

        return { content, size: content.length, isBinary: false }
      } else {
        // Read file from local machine
        const resolved = path.isAbsolute(filePath) ? filePath : path.join(workdir, filePath)
        const stat = fs.statSync(resolved)

        if (stat.isDirectory()) {
          throw new Error('Path is a directory, not a file')
        }

        if (stat.size > MAX_FILE_SIZE) {
          throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB > 5MB limit)`)
        }

        if (isBinaryFile(resolved)) {
          return { content: '[Binary file]', size: stat.size, isBinary: true }
        }

        const content = fs.readFileSync(resolved, 'utf-8')
        return { content, size: stat.size, isBinary: false }
      }
    } catch (err) {
      throw new Error(`Failed to read file: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  ipcMain.handle('file:listDir', async (_e, { dirPath, workdir, isRemote, remoteHost }) => {
    try {
      if (!isSafeFile(dirPath)) {
        throw new Error('Invalid directory path')
      }

      if (isRemote && remoteHost) {
        // List files from remote machine via SSH
        const [user, host] = remoteHost.split('@')
        const ssh = await sshPool.getConnection({ user, host })

        debugLog(`[file:listDir] Listing remote files: ${dirPath} on ${remoteHost}`)

        // Use find to list files: find /dir -type f | head -1000
        const ignorePatterns = Array.from(IGNORE_DIRS)
          .map((d) => `'! -path "*/${d}/*"'`)
          .join(' ')

        const findCmd = `find "${dirPath}" -type f ${ignorePatterns} 2>/dev/null | head -1000`
        let output = ''
        try {
          output = await ssh.exec(findCmd)
          debugLog(`[file:listDir] Found ${output.split('\n').filter(l => l.trim()).length} files`)
        } catch (err) {
          // Directory might not exist or be inaccessible
          debugLog(`[file:listDir] Failed to list directory: ${err}`)
          return { files: [] }
        }

        const files: Array<{ path: string; size: number; isDir: boolean }> = output
          .split('\n')
          .filter((line) => line.trim())
          .map((filePath) => ({
            path: filePath,
            isDir: false,
            size: 0 // We can't easily get sizes via find + SSH without extra overhead
          }))
          .sort((a, b) => a.path.localeCompare(b.path))

        if (files.length >= 1000) {
          files.push({
            path: '(directory contains >1000 files, truncated)',
            isDir: false,
            size: 0
          })
        }

        return { files }
      } else {
        // List files from local machine
        const resolved = path.isAbsolute(dirPath) ? dirPath : path.join(workdir, dirPath)
        const files: Array<{ path: string; size: number; isDir: boolean }> = []

        const walk = (dir: string, depth: number) => {
          if (depth > 5) return // Limit recursion
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true })
            for (const entry of entries) {
              if (IGNORE_DIRS.has(entry.name)) continue

              const fullPath = path.join(dir, entry.name)
              const relPath = path.relative(workdir, fullPath)

              if (entry.isDirectory()) {
                files.push({ path: relPath, size: 0, isDir: true })
                walk(fullPath, depth + 1)
              } else if (entry.isFile()) {
                try {
                  const size = fs.statSync(fullPath).size
                  files.push({ path: relPath, size, isDir: false })
                } catch {
                  // Skip files we can't stat
                }
              }
            }
          } catch {
            // Skip directories we can't read
          }
        }

        walk(resolved, 0)
        // Sort: dirs first, then alphabetically
        files.sort((a, b) => {
          if (a.isDir !== b.isDir) return b.isDir ? 1 : -1
          return a.path.localeCompare(b.path)
        })

        return { files }
      }
    } catch (err) {
      throw new Error(`Failed to list directory: ${err instanceof Error ? err.message : String(err)}`)
    }
  })
}
