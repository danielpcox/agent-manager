import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { v4 as uuidv4 } from 'uuid'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import type {
  Agent,
  AgentStatus,
  ConversationEvent,
  CreateAgentParams,
  PermissionMode
} from '../renderer/src/types/agent'

const SCREENSHOT_DIR = path.join(os.tmpdir(), 'agent-manager-screenshots')

interface ManagedAgent {
  agent: Agent
  pty: pty.IPty | null
}

export class AgentManager {
  private agents: Map<string, ManagedAgent> = new Map()
  private window: BrowserWindow | null = null

  setWindow(win: BrowserWindow): void {
    this.window = win
  }

  private send(channel: string, data: unknown): void {
    this.window?.webContents.send(channel, data)
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

    switch (agent.permissionMode) {
      case 'autonomous':
        args.push('--dangerously-skip-permissions')
        break
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
      totalCostUsd: 0,
      turns: 0,
      isUnread: false,
      events: []
    }

    const managed: ManagedAgent = { agent, pty: null }
    this.agents.set(id, managed)
    this.send('agent:created', agent)

    this.spawnPty(managed)
    return agent
  }

  private spawnPty(managed: ManagedAgent): void {
    const { agent } = managed
    const claudePath = 'claude'
    const args = this.buildClaudeArgs(agent)

    // Determine shell for proper env inheritance
    const shell = process.env.SHELL || '/bin/zsh'
    const cols = 120
    const rows = 40

    try {
      const ptyProcess = pty.spawn(shell, ['-l', '-c', `${claudePath} ${args.join(' ')}`], {
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

      ptyProcess.onData((data: string) => {
        buffer += data
        this.send('agent:ptyData', { agentId: agent.id, data })

        // Detect session ID from output (look for common patterns)
        this.detectSessionInfo(agent, buffer)

        // Detect remote control URL
        this.detectRemoteControlUrl(agent, data)

        // Update status based on output patterns
        this.detectStatus(managed, data)

        agent.updatedAt = Date.now()
      })

      ptyProcess.onExit(({ exitCode }) => {
        const newStatus: AgentStatus = exitCode === 0 ? 'done' : 'error'
        this.updateStatus(managed, newStatus)
        managed.pty = null
      })

      this.updateStatus(managed, 'running')

      // Send the initial task after a short delay for the shell to initialize
      setTimeout(() => {
        if (managed.pty) {
          // Type the task as the first message
          ptyProcess.write(agent.task + '\r')
          this.addEvent(agent, {
            type: 'user_message',
            content: agent.task
          })
        }
      }, 2000)
    } catch (err) {
      this.updateStatus(managed, 'error')
      this.addEvent(agent, {
        type: 'error',
        content: `Failed to spawn claude: ${err}`,
        isError: true
      })
    }
  }

  private detectSessionInfo(agent: Agent, buffer: string): void {
    // Look for session ID patterns in output
    const sessionMatch = buffer.match(/session[:\s]+([0-9a-f-]{36})/i)
    if (sessionMatch && !agent.sessionId) {
      agent.sessionId = sessionMatch[1]
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
    const stripped = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim()

    // Detect when Claude is waiting for user input (the prompt character)
    if (stripped.match(/^[❯>]\s*$/m)) {
      // Only mark waiting if we were previously running
      if (managed.agent.status === 'running') {
        managed.agent.isUnread = true
        this.updateStatus(managed, 'waiting')
      }
    }

    // Detect when Claude is actively working again
    if (stripped.includes('Thinking') || stripped.includes('⠋') || stripped.includes('⠙')) {
      if (managed.agent.status === 'waiting') {
        this.updateStatus(managed, 'running')
      }
    }
  }

  private updateStatus(managed: ManagedAgent, status: AgentStatus): void {
    managed.agent.status = status
    managed.agent.updatedAt = Date.now()
    if (status === 'waiting' || status === 'done' || status === 'error') {
      managed.agent.isUnread = true
    }
    this.send('agent:statusChanged', {
      agentId: managed.agent.id,
      status
    })
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

  killAgent(agentId: string): void {
    const managed = this.agents.get(agentId)
    if (!managed) return

    if (managed.pty) {
      managed.pty.kill()
      managed.pty = null
    }
    this.updateStatus(managed, 'killed')
  }

  markRead(agentId: string): void {
    const managed = this.agents.get(agentId)
    if (managed) {
      managed.agent.isUnread = false
      this.send('agent:updated', managed.agent)
    }
  }

  getAgent(agentId: string): Agent | null {
    return this.agents.get(agentId)?.agent || null
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values()).map((m) => m.agent)
  }

  removeAgent(agentId: string): void {
    this.killAgent(agentId)
    this.agents.delete(agentId)
    this.send('agent:removed', { agentId })
  }

  // Serialize agents for persistence (without PTY)
  serialize(): Agent[] {
    return this.getAllAgents()
  }

  // Restore agents from persistence (they won't have active PTYs)
  restore(agents: Agent[]): void {
    for (const agent of agents) {
      // Mark previously-running agents as killed on restore
      if (agent.status === 'running' || agent.status === 'starting') {
        agent.status = 'killed'
      }
      this.agents.set(agent.id, { agent, pty: null })
    }
  }

  cleanup(): void {
    for (const [, managed] of this.agents) {
      if (managed.pty) {
        managed.pty.kill()
      }
    }
  }
}
