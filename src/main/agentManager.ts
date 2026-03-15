import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { execSync } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import type {
  Agent,
  AgentStatus,
  ConversationEvent,
  CreateAgentParams,
  ImportAgentParams,
  PermissionMode,
  CreateRemoteAgentParams
} from '../renderer/src/types/agent'
import type { SSHConnection } from './sshConnection'
import { sshPool } from './sshConnection'

const SCREENSHOT_DIR = path.join(os.tmpdir(), 'agent-manager-screenshots')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function encodeProjectPath(absPath: string): string {
  return '-' + absPath.replace(/^\//, '').replace(/[/_]/g, '-')
}

const MAX_BUFFER = 5 * 1024 * 1024 // 5MB max per agent

// Resolved full path to tmux binary — set by checkTmuxAvailable()
let tmuxBin = 'tmux'

// Resolved full path to claude binary — set by resolveClaude()
let claudeBin = 'claude'

interface ManagedAgent {
  agent: Agent
  pty: pty.IPty | null
  outputBuffer: string
  tmuxSession: string
  idleTimer: ReturnType<typeof setTimeout> | null
  suppressDetectionUntil: number  // epoch ms; skip detectStatus while < Date.now()
  firstActivityAt: number          // epoch ms of first ✻ in current period; 0 = not started
  terminalTabActive: boolean       // false when renderer is on a non-terminal tab
  sshConnection?: SSHConnection    // For remote agents
  reconnectAttempts?: number       // For remote agents: number of reconnection attempts
  lastReconnectTime?: number       // For remote agents: timestamp of last reconnect attempt
}

export class AgentManager {
  private agents: Map<string, ManagedAgent> = new Map()
  private window: BrowserWindow | null = null
  onChanged: (() => void) | null = null
  onEvent: ((channel: string, data: unknown) => void) | null = null

  setWindow(win: BrowserWindow): void {
    this.window = win
  }

  private send(channel: string, data: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, data)
    }
    this.onEvent?.(channel, data)
  }

  // --- tmux helpers ---

  private tmuxSessionName(agentId: string): string {
    // tmux session names: use = prefix for exact match to avoid substring issues
    return `am_${agentId.replace(/-/g, '')}`
  }

  private tmuxSessionExists(name: string): boolean {
    try {
      execSync(`${tmuxBin} has-session -t '=${name}' 2>/dev/null`)
      return true
    } catch {
      return false
    }
  }

  private killTmuxSession(name: string): void {
    try {
      execSync(`${tmuxBin} kill-session -t '=${name}' 2>/dev/null`)
    } catch {
      // session may already be gone
    }
  }

  static checkTmuxAvailable(): boolean {
    // Check well-known paths first (packaged apps lack homebrew in PATH)
    const candidates = [
      '/opt/homebrew/bin/tmux',  // macOS ARM homebrew
      '/usr/local/bin/tmux',     // macOS Intel homebrew / manual
      '/usr/bin/tmux'            // system
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        tmuxBin = p
        break
      }
    }
    if (tmuxBin === 'tmux') {
      // Fall back to PATH lookup (works in dev)
      try {
        const resolved = execSync('which tmux', { encoding: 'utf-8' }).trim()
        if (resolved) {
          tmuxBin = resolved
        }
      } catch {
        // not found
      }
    }
    if (tmuxBin === 'tmux') return false

    // Also resolve claude binary while we're at it
    AgentManager.resolveClaude()
    return true
  }

  private static resolveClaude(): void {
    const home = os.homedir()
    const candidates = [
      path.join(home, '.local', 'bin', 'claude'),    // standard install location
      path.join(home, '.claude', 'local', 'bin', 'claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
      '/usr/bin/claude'
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        claudeBin = p
        return
      }
    }
    // Fall back to PATH lookup (works in dev)
    try {
      const resolved = execSync('which claude', { encoding: 'utf-8' }).trim()
      if (resolved) {
        claudeBin = resolved
      }
    } catch {
      // leave as 'claude' and hope the login shell finds it
    }
  }

  private generateName(task: string): string {
    return task
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .slice(0, 4)
      .join('-')
      .substring(0, 30)
  }

  private buildClaudeArgs(agent: Agent): string[] {
    const args: string[] = []

    args.push('--dangerously-skip-permissions')

    switch (agent.permissionMode) {
      case 'readonly':
        args.push(
          '--allowedTools',
          'Read',
          'Glob',
          'Grep',
          'Bash(git log*)',
          'Bash(git diff*)',
          'Bash(git status)',
          'Bash(ls*)',
          'Task',
          'WebSearch',
          'WebFetch'
        )
        break
      case 'plan':
        args.push('--permission-mode', 'plan')
        break
    }

    if (agent.model) {
      args.push('--model', agent.model)
    }

    return args
  }

  createAgent(params: CreateAgentParams): Agent {
    const id = uuidv4()
    const now = Date.now()
    const name = params.name || this.generateName(params.task)

    const agent: Agent = {
      id,
      name,
      task: params.task,
      workdir: params.workdir,
      status: 'starting',
      model: params.model || 'claude-sonnet-4-6',
      permissionMode: params.permissionMode || 'autonomous',
      sessionId: null,
      remoteControlUrl: null,
      createdAt: now,
      updatedAt: now,
      statusChangedAt: now,
      runningTimeMs: 0,
      totalCostUsd: 0,
      tokenContext: 0,

      isUnread: false,
      isTabled: false,
      events: []
    }

    const managed: ManagedAgent = { agent, pty: null, outputBuffer: '', tmuxSession: this.tmuxSessionName(id), idleTimer: null, suppressDetectionUntil: 0, firstActivityAt: 0, terminalTabActive: true }
    this.agents.set(id, managed)
    this.send('agent:created', agent)
    this.onChanged?.()

    console.log(`[AgentManager] Creating agent "${name}" in ${params.workdir}`)
    this.spawnPty(managed)
    this.watchForSessionId(managed)
    return agent
  }

  importAgent(params: ImportAgentParams): Agent {
    const id = uuidv4()
    const now = Date.now()
    const name =
      params.name ||
      (params.sessionId
        ? `resumed-${params.sessionId.substring(0, 8)}`
        : 'continued-session')

    const agent: Agent = {
      id,
      name,
      task: params.sessionId
        ? `Resumed session ${params.sessionId}`
        : 'Continued most recent session',
      workdir: params.workdir,
      status: 'starting',
      model: params.model || 'claude-sonnet-4-6',
      permissionMode: params.permissionMode || 'autonomous',
      sessionId: params.sessionId || null,
      remoteControlUrl: null,
      createdAt: now,
      updatedAt: now,
      statusChangedAt: now,
      runningTimeMs: 0,
      totalCostUsd: 0,
      tokenContext: 0,

      isUnread: false,
      isTabled: false,
      events: []
    }

    const managed: ManagedAgent = { agent, pty: null, outputBuffer: '', tmuxSession: this.tmuxSessionName(id), idleTimer: null, suppressDetectionUntil: 0, firstActivityAt: 0, terminalTabActive: true }
    this.agents.set(id, managed)
    this.send('agent:created', agent)
    this.onChanged?.()

    console.log(`[AgentManager] Importing session for "${name}" in ${params.workdir}`)
    this.spawnPtyForImport(managed, params)
    if (!agent.sessionId) this.watchForSessionId(managed)
    return agent
  }

  async createRemoteAgent(params: CreateRemoteAgentParams): Promise<Agent> {
    const id = uuidv4()
    const now = Date.now()
    const remoteHost = `${params.user}@${params.host}`

    let remoteSessionName = params.sessionName
    let workdir = params.workdir

    // If creating new session, spawn Claude remotely
    if (!remoteSessionName) {
      remoteSessionName = `am_${id.replace(/-/g, '')}`

      try {
        const ssh = await sshPool.getConnection({ user: params.user, host: params.host })
        const claudeArgs = this.buildClaudeArgs({
          id,
          name: params.name || this.generateName(params.task),
          task: params.task,
          workdir: params.workdir,
          status: 'starting',
          model: params.model || 'claude-sonnet-4-6',
          permissionMode: params.permissionMode || 'autonomous',
          sessionId: null,
          remoteControlUrl: null,
          createdAt: now,
          updatedAt: now,
          statusChangedAt: now,
          runningTimeMs: 0,
          totalCostUsd: 0,
          tokenContext: 0,
          isUnread: false,
          isTabled: false,
          events: []
        } as Agent)

        const claudeCmd = claudeArgs.join(' ')
        const tmuxCmd = `mkdir -p "${workdir}" && cd "${workdir}" && tmux new-session -d -s ${remoteSessionName} 'claude ${claudeCmd}'`

        await ssh.exec(tmuxCmd)
        console.log(`[AgentManager] Created remote tmux session ${remoteSessionName} on ${remoteHost}:${workdir}`)
      } catch (err) {
        throw new Error(`Failed to create remote session: ${err}`)
      }
    }

    const name = params.name || this.generateName(params.task)
    const agent: Agent = {
      id,
      name,
      task: params.task,
      workdir,
      status: 'starting',
      model: params.model || 'claude-sonnet-4-6',
      permissionMode: params.permissionMode || 'autonomous',
      sessionId: null,
      remoteControlUrl: null,
      createdAt: now,
      updatedAt: now,
      statusChangedAt: now,
      runningTimeMs: 0,
      totalCostUsd: 0,
      tokenContext: 0,
      isUnread: false,
      isTabled: false,
      events: [],
      isRemote: true,
      remoteHost,
      remoteSessionName
    }

    const managed: ManagedAgent = {
      agent,
      pty: null,
      outputBuffer: '',
      tmuxSession: '',
      idleTimer: null,
      suppressDetectionUntil: 0,
      firstActivityAt: 0,
      terminalTabActive: true,
      reconnectAttempts: 0
    }

    this.agents.set(id, managed)
    this.send('agent:created', agent)
    this.onChanged?.()

    console.log(`[AgentManager] Creating remote agent "${name}" on ${remoteHost}:${workdir}`)
    this.spawnRemotePty(managed)

    return agent
  }

  private spawnPtyForImport(managed: ManagedAgent, params: ImportAgentParams): void {
    const { agent } = managed
    const shell = process.env.SHELL || '/bin/zsh'

    // Build the claude command for resuming
    let claudeCmd = claudeBin
    if (params.sessionId) {
      claudeCmd += ` --resume ${params.sessionId}`
    } else if (params.continueRecent) {
      claudeCmd += ' -c'
    }

    // Add permission flags
    claudeCmd += ' --dangerously-skip-permissions'
    if (agent.permissionMode === 'plan') {
      claudeCmd += ' --permission-mode plan'
    }

    if (agent.model) {
      claudeCmd += ` --model ${agent.model}`
    }

    const cols = 120
    const rows = 40
    const sess = managed.tmuxSession

    // Create tmux session for imported/resumed agent
    const tmuxCmd = `${tmuxBin} new-session -d -s ${sess} -x ${cols} -y ${rows} '${shell} -l -c "${claudeCmd.replace(/'/g, "'\\''")}"' \\; set-option -t ${sess} history-limit 200000 \\; set-option -t ${sess} status off \\; set-option -t ${sess} mouse on && ${tmuxBin} attach-session -t ${sess}`

    try {
      const ptyProcess = pty.spawn(shell, ['-l', '-c', tmuxCmd], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: agent.workdir,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        } as Record<string, string>
      })

      managed.pty = ptyProcess

      let buffer = ''

      console.log(`[AgentManager] Import PTY spawned via tmux (${sess}): ${claudeCmd} (cwd: ${agent.workdir})`)

      ptyProcess.onData((data: string) => {
        buffer += data
        managed.outputBuffer += data
        if (managed.outputBuffer.length > MAX_BUFFER) {
          managed.outputBuffer = managed.outputBuffer.slice(-MAX_BUFFER / 2)
        }
        this.send('agent:ptyData', { agentId: agent.id, data })
        this.detectRemoteControlUrl(agent, data)
        this.detectModelChange(agent, data)
        this.detectStatus(managed, data)
        agent.updatedAt = Date.now()
      })

      ptyProcess.onExit(({ exitCode }) => {
        this.handleTmuxClientExit(managed, exitCode)
      })

      this.updateStatus(managed, 'running')
    } catch (err) {
      console.error(`[AgentManager] Failed to spawn import PTY:`, err)
      this.updateStatus(managed, 'error')
      this.addEvent(agent, {
        type: 'error',
        content: `Failed to resume claude session: ${err}`,
        isError: true
      })
    }
  }

  private spawnPty(managed: ManagedAgent): void {
    const { agent } = managed
    const claudeArgs = this.buildClaudeArgs(agent)
    const claudeCmd = `${claudeBin} ${claudeArgs.join(' ')}`

    const shell = process.env.SHELL || '/bin/zsh'
    const cols = 120
    const rows = 40
    const sess = managed.tmuxSession

    // Create a tmux session running claude, then attach to it
    // The tmux session name is deterministic from the agent ID
    const tmuxCmd = `${tmuxBin} new-session -d -s ${sess} -x ${cols} -y ${rows} '${shell} -l -c "${claudeCmd.replace(/'/g, "'\\''")}"' \\; set-option -t ${sess} history-limit 200000 \\; set-option -t ${sess} status off \\; set-option -t ${sess} mouse on && ${tmuxBin} attach-session -t ${sess}`

    try {
      const ptyProcess = pty.spawn(shell, ['-l', '-c', tmuxCmd], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: agent.workdir,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        } as Record<string, string>
      })

      managed.pty = ptyProcess
      console.log(`[AgentManager] PTY spawned via tmux (${sess}): ${claudeCmd} (cwd: ${agent.workdir})`)

      let buffer = ''

      ptyProcess.onData((data: string) => {
        buffer += data
        managed.outputBuffer += data
        if (managed.outputBuffer.length > MAX_BUFFER) {
          managed.outputBuffer = managed.outputBuffer.slice(-MAX_BUFFER / 2)
        }
        this.send('agent:ptyData', { agentId: agent.id, data })
        this.detectRemoteControlUrl(agent, data)
        this.detectModelChange(agent, data)
        this.detectStatus(managed, data)
        agent.updatedAt = Date.now()
      })

      ptyProcess.onExit(({ exitCode }) => {
        this.handleTmuxClientExit(managed, exitCode)
      })

      this.updateStatus(managed, 'running')

      // Send the initial task after a short delay for the shell to initialize
      setTimeout(() => {
        if (managed.pty) {
          ptyProcess.write(agent.task + '\r')
          this.addEvent(agent, {
            type: 'user_message',
            content: agent.task
          })
        }
      }, 2000)
    } catch (err) {
      console.error(`[AgentManager] Failed to spawn PTY:`, err)
      this.updateStatus(managed, 'error')
      this.addEvent(agent, {
        type: 'error',
        content: `Failed to spawn claude: ${err}`,
        isError: true
      })
    }
  }

  private spawnRemotePty(managed: ManagedAgent): void {
    const agent = managed.agent
    const { remoteHost, remoteSessionName } = agent

    if (!remoteHost || !remoteSessionName) {
      console.error(`[AgentManager] Remote agent missing remoteHost or remoteSessionName`)
      this.updateStatus(managed, 'error')
      return
    }

    try {
      // Spawn PTY that runs: ssh user@host tmux attach-session -t session-name
      const ptyProcess = pty.spawn('ssh', ['-t', remoteHost, 'tmux', 'attach-session', '-t', remoteSessionName], {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        } as Record<string, string>
      })

      managed.pty = ptyProcess
      console.log(`[AgentManager] Remote PTY spawned: ssh ${remoteHost} tmux attach-session -t ${remoteSessionName}`)

      ptyProcess.onData((data: string) => {
        managed.outputBuffer += data
        if (managed.outputBuffer.length > MAX_BUFFER) {
          managed.outputBuffer = managed.outputBuffer.slice(-MAX_BUFFER / 2)
        }
        this.send('agent:ptyData', { agentId: agent.id, data })
        this.detectRemoteControlUrl(agent, data)
        this.detectStatus(managed, data)
        agent.updatedAt = Date.now()
      })

      ptyProcess.onExit(({ exitCode }) => {
        this.handleRemoteExit(managed)
      })

      this.updateStatus(managed, 'running')
    } catch (err) {
      console.error(`[AgentManager] Failed to spawn remote PTY:`, err)
      this.updateStatus(managed, 'error')
      this.addEvent(agent, {
        type: 'error',
        content: `Failed to attach to remote session: ${err}`,
        isError: true
      })
    }
  }

  private handleRemoteExit(managed: ManagedAgent): void {
    const agent = managed.agent
    const maxRetries = 5

    if (!managed.reconnectAttempts) managed.reconnectAttempts = 0
    managed.reconnectAttempts++

    if (managed.reconnectAttempts > maxRetries) {
      console.log(`[AgentManager] Remote session disconnected after ${maxRetries} reconnect attempts`)
      this.updateStatus(managed, 'disconnected')
      this.addEvent(agent, {
        type: 'error',
        content: `SSH connection lost after ${maxRetries} reconnect attempts. Click to retry.`,
        isError: true
      })
      return
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
    const backoff = Math.min(30000, Math.pow(2, managed.reconnectAttempts - 1) * 1000)

    console.log(
      `[AgentManager] Remote session disconnected, reconnecting in ${backoff}ms ` +
        `(attempt ${managed.reconnectAttempts}/${maxRetries})`
    )

    this.updateStatus(managed, 'reconnecting')

    setTimeout(() => {
      if (!managed.pty || !managed.pty.isAlive) {
        this.spawnRemotePty(managed)
      }
    }, backoff)
  }

  private watchForSessionId(managed: ManagedAgent): void {
    const { agent } = managed
    if (agent.sessionId) return

    const base = path.join(os.homedir(), '.claude', 'projects', encodeProjectPath(agent.workdir))

    const setSession = (sessionId: string) => {
      if (agent.sessionId) return
      agent.sessionId = sessionId
      this.send('agent:updated', agent)
    }

    // For already-running agents: pick the most recently modified JSONL file
    const inferFromExisting = (): boolean => {
      if (!fs.existsSync(base)) return false
      let best: { id: string; mtime: number } | null = null
      for (const f of fs.readdirSync(base)) {
        if (!f.endsWith('.jsonl')) continue
        const id = f.slice(0, -6)
        if (!UUID_RE.test(id)) continue
        try {
          const mtime = fs.statSync(path.join(base, f)).mtimeMs
          if (!best || mtime > best.mtime) best = { id, mtime }
        } catch { /* ignore */ }
      }
      if (best) { setSession(best.id); return true }
      return false
    }

    const startWatcher = () => {
      if (!fs.existsSync(base)) {
        setTimeout(startWatcher, 2000)
        return
      }

      // Watch indefinitely for new JSONL files (handles post-compaction new sessions)
      const watcher = fs.watch(base, (_event, filename) => {
        if (!filename?.endsWith('.jsonl')) return
        const sessionId = filename.slice(0, -6)
        if (!UUID_RE.test(sessionId)) return
        // Only update if this file is newer than the current session's file
        const newPath = path.join(base, filename)
        if (agent.sessionId) {
          const curPath = path.join(base, `${agent.sessionId}.jsonl`)
          try {
            if (fs.statSync(newPath).mtimeMs <= fs.statSync(curPath).mtimeMs) return
          } catch { /* new file wins if current is missing */ }
        }
        setSession(sessionId)
      })

      // Clean up watcher when agent is removed (best-effort)
      const origStatus = agent.status
      void origStatus // referenced to avoid lint warning
      const checkDead = setInterval(() => {
        if (!this.agents.has(agent.id)) {
          clearInterval(checkDead)
          watcher.close()
        }
      }, 30_000)
    }

    // If the directory already has JSONL files, use the newest one immediately
    inferFromExisting()
    // Then watch for newer ones (compaction creates new JSONL files)
    startWatcher()
  }

  private detectModelChange(agent: Agent, data: string): void {
    const match = data.match(/claude-(?:opus|sonnet|haiku)-[\w.-]+/)
    if (match && match[0] !== agent.model) {
      agent.model = match[0]
      this.send('agent:updated', agent)
    }
  }

  private detectRemoteControlUrl(agent: Agent, data: string): void {
    const urlMatch = data.match(/(https:\/\/claude\.ai\/code\/[^\s\x1b]+)/)
    if (urlMatch) {
      agent.remoteControlUrl = urlMatch[1]
      this.send('agent:updated', agent)
    }
  }

  private detectStatus(managed: ManagedAgent, data: string): void {
    if (managed.suppressDetectionUntil > Date.now()) return
    const stripped = data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')

    // The ✻ activity line (e.g. "✻ Thinking… (5s · ↑ 1.2k tokens)")
    // is the definitive signal that Claude is actively working.
    // Require 5s of continuous ✻ activity before switching to running,
    // so transient redraws (e.g. resizePtyForRedraw) don't flip the status.
    if (/✻/.test(stripped)) {
      if (managed.agent.status !== 'running') {
        if (!managed.firstActivityAt) {
          managed.firstActivityAt = Date.now()
        } else if (Date.now() - managed.firstActivityAt >= 5000) {
          this.updateStatus(managed, 'running')
        }
      }

      // Parse context token count from spinner line
      const tokenMatch = stripped.match(/([\d.]+)(k?)\s*tokens/)
      if (tokenMatch) {
        const count = Math.round(parseFloat(tokenMatch[1]) * (tokenMatch[2] === 'k' ? 1000 : 1))
        if (count !== managed.agent.tokenContext) {
          managed.agent.tokenContext = count
          this.send('agent:updated', managed.agent)
        }
      }
    }

    // Reset idle timer — when data stops flowing, check if still working
    if (managed.idleTimer) clearTimeout(managed.idleTimer)
    managed.idleTimer = setTimeout(() => {
      this.checkIfWaiting(managed)
    }, 3000)
  }

  private checkIfWaiting(managed: ManagedAgent): void {
    managed.firstActivityAt = 0  // activity stopped, reset debounce
    managed.idleTimer = null     // mark timer as fired (so PTY data can distinguish)
    if (managed.agent.status !== 'running') return

    // Defer to the check phase (setImmediate runs after the poll/I/O phase).
    // This gives any queued PTY data events a chance to run first — if Claude
    // is still active, those events will call detectStatus → set a new idleTimer.
    // If idleTimer is non-null here, PTY data arrived and we abort (false positive).
    setImmediate(() => {
      if (managed.agent.status !== 'running') return
      if (managed.idleTimer !== null) return  // PTY data reset the timer; still active
      this.updateStatus(managed, 'waiting')
    })
  }

  private handleTmuxClientExit(managed: ManagedAgent, exitCode: number): void {
    const { agent } = managed
    managed.pty = null
    if (managed.idleTimer) { clearTimeout(managed.idleTimer); managed.idleTimer = null }

    // Check if the tmux session is still alive (claude still running)
    if (this.tmuxSessionExists(managed.tmuxSession)) {
      // tmux client detached but session lives on — just a detach, not a real exit
      console.log(`[AgentManager] tmux client detached for "${agent.name}" (session ${managed.tmuxSession} still alive)`)
      // Don't change status — agent is still running in tmux
      return
    }

    // tmux session is gone — claude actually exited
    console.log(`[AgentManager] PTY exited: code=${exitCode}, agent="${agent.name}" (tmux session gone)`)
    const newStatus: AgentStatus = exitCode === 0 ? 'done' : 'error'
    if (exitCode !== 0) {
      const lastOutput = managed.outputBuffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim()
      console.log(`[AgentManager] Last output for "${agent.name}":\n${lastOutput.slice(-2000)}`)
      this.addEvent(agent, {
        type: 'error',
        content: `Process exited with code ${exitCode}. Last output:\n${lastOutput.slice(-500)}`,
        isError: true
      })
    }
    this.updateStatus(managed, newStatus)
  }

  private reattachToTmux(managed: ManagedAgent): void {
    const { agent } = managed
    const shell = process.env.SHELL || '/bin/zsh'
    const sess = managed.tmuxSession
    const cols = 120
    const rows = 40

    try { execSync(`${tmuxBin} set-option -t '=${sess}' status off 2>/dev/null`) } catch { /* ignore */ }

    try {
      const ptyProcess = pty.spawn(shell, ['-l', '-c', `${tmuxBin} attach-session -t ${sess}`], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: agent.workdir,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        } as Record<string, string>
      })

      managed.pty = ptyProcess

      let buffer = ''

      console.log(`[AgentManager] Reattached to tmux session ${sess} for "${agent.name}"`)

      ptyProcess.onData((data: string) => {
        buffer += data
        managed.outputBuffer += data
        if (managed.outputBuffer.length > MAX_BUFFER) {
          managed.outputBuffer = managed.outputBuffer.slice(-MAX_BUFFER / 2)
        }
        this.send('agent:ptyData', { agentId: agent.id, data })
        this.detectRemoteControlUrl(agent, data)
        this.detectModelChange(agent, data)
        this.detectStatus(managed, data)
        agent.updatedAt = Date.now()
      })

      ptyProcess.onExit(({ exitCode }) => {
        this.handleTmuxClientExit(managed, exitCode)
      })

      this.updateStatus(managed, 'running')
    } catch (err) {
      console.error(`[AgentManager] Failed to reattach to tmux session ${sess}:`, err)
      this.updateStatus(managed, 'error')
    }
  }

  private updateStatus(managed: ManagedAgent, status: AgentStatus): void {
    const now = Date.now()
    const prev = managed.agent.status

    // Accumulate running time when leaving running/starting state
    if ((prev === 'running' || prev === 'starting') && status !== prev) {
      managed.agent.runningTimeMs += now - (managed.agent.statusChangedAt || now)
    }

    managed.agent.status = status
    managed.agent.updatedAt = now
    managed.agent.statusChangedAt = now
    managed.firstActivityAt = 0  // clear debounce on any explicit status change
    if (status === 'waiting' || status === 'done' || status === 'error') {
      managed.agent.isUnread = true
    }
    this.send('agent:statusChanged', {
      agentId: managed.agent.id,
      status
    })
    this.onChanged?.()
  }

  private addEvent(
    agent: Agent,
    event: Omit<ConversationEvent, 'id' | 'timestamp'>
  ): void {
    const full: ConversationEvent = {
      id: uuidv4(),
      timestamp: Date.now(),
      ...event
    }
    agent.events.push(full)
    this.send('agent:event', { agentId: agent.id, event: full })
  }

  writeToPty(agentId: string, data: string): void {
    const managed = this.agents.get(agentId)
    if (managed?.pty) {
      managed.pty.write(data)
    }
  }

  sendMessage(agentId: string, message: string): void {
    const managed = this.agents.get(agentId)
    if (!managed?.pty) return

    managed.pty.write(message + '\r')
    this.addEvent(managed.agent, {
      type: 'user_message',
      content: message
    })
    this.updateStatus(managed, 'running')
  }

  sendScreenshot(agentId: string, imageBuffer: Buffer, message: string): void {
    const managed = this.agents.get(agentId)
    if (!managed?.pty) return

    // Ensure screenshot directory exists
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
    }

    const filename = `${agentId}-${Date.now()}.png`
    const filepath = path.join(SCREENSHOT_DIR, filename)
    fs.writeFileSync(filepath, imageBuffer)

    const fullMessage = message
      ? `${message} [see screenshot at ${filepath}]`
      : `Please look at this screenshot: ${filepath}`

    managed.pty.write(fullMessage + '\r')
    this.addEvent(managed.agent, {
      type: 'user_message',
      content: `[Screenshot attached] ${message || ''}`
    })
    this.updateStatus(managed, 'running')
  }

  enableRemoteControl(agentId: string): void {
    const managed = this.agents.get(agentId)
    if (!managed?.pty) return

    managed.pty.write('/rc\r')
  }

  resizePty(agentId: string, cols: number, rows: number): void {
    const managed = this.agents.get(agentId)
    if (managed?.pty) {
      managed.pty.resize(cols, rows)
    }
  }

  // Resize ±1 to force a full tmux screen redraw, suppressing status detection
  // so the redraw data doesn't incorrectly flip agent status.
  resizePtyForRedraw(agentId: string, cols: number, rows: number): void {
    const managed = this.agents.get(agentId)
    if (!managed?.pty) return
    managed.suppressDetectionUntil = Date.now() + 600
    managed.pty.resize(cols + 1, rows)
    setTimeout(() => {
      try { managed.pty?.resize(cols, rows) } catch { /* session may have ended */ }
    }, 50)
  }

  killAgent(agentId: string): void {
    const managed = this.agents.get(agentId)
    if (!managed) return

    if (managed.pty) {
      managed.pty.kill()
      managed.pty = null
    }
    // Kill the tmux session too so claude actually stops
    this.killTmuxSession(managed.tmuxSession)
    this.updateStatus(managed, 'killed')
  }

  setTerminalTabActive(agentId: string, active: boolean): void {
    const managed = this.agents.get(agentId)
    if (!managed) return
    managed.terminalTabActive = active
    // Switching away from the terminal tab can briefly delay PTY data events
    // due to IPC reads (e.g. parsing JSONL). Reset the idle timer so the
    // countdown starts fresh from the moment of the switch, not from when
    // data last arrived, preventing a false "waiting" trigger.
    if (!active && managed.idleTimer) {
      clearTimeout(managed.idleTimer)
      managed.idleTimer = setTimeout(() => this.checkIfWaiting(managed), 3000)
    }
  }

  tableAgent(agentId: string, tabled: boolean): void {
    const managed = this.agents.get(agentId)
    if (!managed) return

    managed.agent.isTabled = tabled
    managed.agent.updatedAt = Date.now()
    this.send('agent:updated', managed.agent)
    this.onChanged?.()
  }

  renameAgent(agentId: string, newName: string): void {
    const managed = this.agents.get(agentId)
    if (!managed) return

    managed.agent.name = newName
    managed.agent.updatedAt = Date.now()
    this.send('agent:updated', managed.agent)
    this.onChanged?.()
  }

  markRead(agentId: string): void {
    const managed = this.agents.get(agentId)
    if (managed) {
      managed.agent.isUnread = false
      this.send('agent:updated', managed.agent)
    }
  }

  getOutputBuffer(agentId: string, offset?: number, length?: number): { data: string; totalLength: number } {
    const managed = this.agents.get(agentId)
    if (!managed) return { data: '', totalLength: 0 }

    const buf = managed.outputBuffer
    const total = buf.length
    const chunkSize = length || 50000 // default ~50KB
    const start = offset !== undefined ? offset : Math.max(0, total - chunkSize)
    const end = Math.min(start + chunkSize, total)

    return { data: buf.slice(start, end), totalLength: total }
  }

  capturePane(agentId: string): string {
    const managed = this.agents.get(agentId)
    if (!managed) return ''
    const sess = managed.tmuxSession
    if (!this.tmuxSessionExists(sess)) {
      // No live tmux session — fall back to accumulated output buffer
      return managed.outputBuffer
    }
    try {
      // Capture entire tmux history (-S - means from the beginning)
      const raw = execSync(
        `${tmuxBin} capture-pane -p -S - -t '${sess}' 2>/dev/null`,
        { encoding: 'utf8', maxBuffer: MAX_BUFFER }
      )
      // trimEnd removes tmux's fixed-width space-padding (capture-pane pads each line
      // to the pane width). Join with \r\n so xterm.js renders LF+CR correctly.
      return raw.split('\n').map(line => line.trimEnd()).join('\r\n')
    } catch {
      return managed.outputBuffer
    }
  }

  getAgent(agentId: string): Agent | null {
    return this.agents.get(agentId)?.agent || null
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values()).map((m) => m.agent)
  }

  removeAgent(agentId: string): void {
    const managed = this.agents.get(agentId)
    if (managed) {
      if (managed.pty) {
        managed.pty.kill()
        managed.pty = null
      }
      this.killTmuxSession(managed.tmuxSession)
    }
    this.agents.delete(agentId)
    this.send('agent:removed', { agentId })
    this.onChanged?.()
  }

  // Serialize agents for persistence (without PTY)
  serialize(): Agent[] {
    return this.getAllAgents()
  }

  // Restore agents from persistence. Check for live tmux sessions first.
  restore(agents: Agent[]): void {
    for (const agent of agents) {
      // Backfill new fields for agents persisted before these existed
      if (!agent.statusChangedAt) agent.statusChangedAt = agent.updatedAt || agent.createdAt
      if (!agent.runningTimeMs) agent.runningTimeMs = 0
      if (agent.isTabled === undefined) agent.isTabled = false
      if (!agent.tokenContext) agent.tokenContext = 0

      const wasActive = ['running', 'starting', 'waiting'].includes(agent.status)
      const tmuxSession = this.tmuxSessionName(agent.id)
      const managed: ManagedAgent = { agent, pty: null, outputBuffer: '', tmuxSession, idleTimer: null, suppressDetectionUntil: 0, firstActivityAt: 0, terminalTabActive: true }
      this.agents.set(agent.id, managed)

      if (this.tmuxSessionExists(tmuxSession)) {
        // tmux session still alive — just reattach (full scrollback comes from tmux)
        console.log(`[AgentManager] Reattaching to live tmux session "${tmuxSession}" for "${agent.name}"`)
        agent.status = 'starting'
        this.reattachToTmux(managed)
        if (!agent.sessionId) this.watchForSessionId(managed)
      } else if (wasActive && agent.sessionId) {
        // tmux session dead but has sessionId — resume via --resume in a new tmux session
        agent.status = 'starting'
        console.log(`[AgentManager] Resuming session "${agent.sessionId}" for "${agent.name}" (tmux session gone)`)
        this.spawnPtyForImport(managed, {
          workdir: agent.workdir,
          sessionId: agent.sessionId,
          model: agent.model,
          permissionMode: agent.permissionMode
        })
      } else if (wasActive) {
        agent.status = 'killed'
      }
      // done/error/killed agents stay as-is
    }
  }

  cleanup(): void {
    // Only kill PTY handles (tmux clients). The tmux sessions survive
    // so agents keep running in the background.
    for (const [, managed] of this.agents) {
      if (managed.idleTimer) { clearTimeout(managed.idleTimer); managed.idleTimer = null }
      if (managed.pty) {
        managed.pty.kill()
        managed.pty = null
      }
    }
  }
}
