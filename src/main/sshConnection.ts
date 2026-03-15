import { spawn, ChildProcess, execSync } from 'child_process'
import path from 'path'
import os from 'os'

export interface SSHConnectionConfig {
  host: string
  user: string
  port?: number
  keyPath?: string
}

/**
 * Manages a single SSH connection with command execution capabilities
 */
export class SSHConnection {
  private config: SSHConnectionConfig
  private controlPath: string
  private connected: boolean = false
  private keepAliveInterval?: NodeJS.Timeout

  constructor(config: SSHConnectionConfig) {
    this.config = config
    // Use SSH control master for connection reuse
    // Control path: ~/.ssh/control-<user>@<host>:<port>
    const port = config.port || 22
    const controlDir = path.join(os.homedir(), '.ssh', 'control-sockets')
    this.controlPath = path.join(controlDir, `${config.user}@${config.host}:${port}`)

    this.setupControlMaster()
    this.setupKeepAlive()
  }

  /**
   * Setup SSH ControlMaster for connection reuse
   */
  private setupControlMaster(): void {
    // This is handled by SSH config, but we'll ensure the socket directory exists
    try {
      const controlDir = path.dirname(this.controlPath)
      if (!require('fs').existsSync(controlDir)) {
        require('fs').mkdirSync(controlDir, { recursive: true, mode: 0o700 })
      }
    } catch (err) {
      console.warn('[SSHConnection] Failed to create control socket directory:', err)
    }
  }

  /**
   * Setup keep-alive to prevent idle timeout
   */
  private setupKeepAlive(): void {
    this.keepAliveInterval = setInterval(() => {
      this.ping().catch((err) => {
        console.warn('[SSHConnection] Keep-alive ping failed:', err)
      })
    }, 60000) // Every 60 seconds
  }

  /**
   * Execute a command over SSH, return stdout
   */
  async exec(command: string): Promise<string> {
    const sshCmd = this.buildSSHCommand(command)

    try {
      const result = execSync(sshCmd, {
        encoding: 'utf-8',
        timeout: 30000, // 30 second timeout
        stdio: ['pipe', 'pipe', 'pipe']
      })

      this.connected = true
      return result
    } catch (err) {
      this.connected = false

      if (err instanceof Error) {
        // SSH specific errors
        if (err.message.includes('Permission denied')) {
          throw new Error(
            `SSH authentication failed for ${this.config.user}@${this.config.host}. ` +
            `Ensure your SSH key is configured and added to ssh-agent.`
          )
        }
        if (err.message.includes('Connection refused') || err.message.includes('Connection timed out')) {
          throw new Error(
            `Cannot connect to ${this.config.user}@${this.config.host}:${this.config.port || 22}. ` +
            `Check that the host is reachable and SSH is running.`
          )
        }
        throw new Error(`SSH command failed: ${err.message}`)
      }

      throw err
    }
  }

  /**
   * Test if the SSH connection is alive
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.exec('echo "alive"')
      this.connected = result.includes('alive')
      return this.connected
    } catch {
      this.connected = false
      return false
    }
  }

  /**
   * Close the SSH connection
   */
  async close(): Promise<void> {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval)
    }

    try {
      // Close the control master connection
      const closeCmd = `ssh -O exit -S "${this.controlPath}" ${this.config.user}@${this.config.host} 2>/dev/null || true`
      execSync(closeCmd, { stdio: 'ignore' })
    } catch (err) {
      console.warn('[SSHConnection] Failed to close SSH connection:', err)
    }

    this.connected = false
  }

  /**
   * Build SSH command with proper quoting and control master
   */
  private buildSSHCommand(command: string): string {
    const host = this.config.host
    const user = this.config.user
    const port = this.config.port ? `-p ${this.config.port}` : ''
    const controlMaster = `-o ControlMaster=auto -o ControlPath="${this.controlPath}" -o ControlPersist=300`

    // Quote the remote command properly
    const quotedCmd = `'${command.replace(/'/g, "'\\''")}'`

    return `ssh ${port} ${controlMaster} ${user}@${host} ${quotedCmd}`
  }

  isConnected(): boolean {
    return this.connected
  }
}

/**
 * Connection pool for managing SSH connections
 * Maps user@host:port -> SSHConnection
 */
export class SSHConnectionPool {
  private connections: Map<string, SSHConnection> = new Map()
  private connectionTimestamps: Map<string, number> = new Map()
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000 // 5 minutes
  private readonly MAX_CONNECTIONS = 10
  private cleanupInterval?: NodeJS.Timeout

  constructor() {
    // Cleanup idle connections every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections()
    }, 60000)
  }

  /**
   * Get or create an SSH connection
   */
  async getConnection(config: SSHConnectionConfig): Promise<SSHConnection> {
    const key = this.getKey(config)

    // Check if we already have this connection
    if (this.connections.has(key)) {
      const conn = this.connections.get(key)!
      this.connectionTimestamps.set(key, Date.now())

      // Verify connection is still alive
      if (await conn.ping()) {
        return conn
      }

      // Connection died, remove it
      this.connections.delete(key)
      this.connectionTimestamps.delete(key)
    }

    // Check connection limit
    if (this.connections.size >= this.MAX_CONNECTIONS) {
      throw new Error(
        `SSH connection limit (${this.MAX_CONNECTIONS}) reached. ` +
        `Close some agents or wait for idle connections to timeout.`
      )
    }

    // Create new connection
    const conn = new SSHConnection(config)

    // Test the connection
    const alive = await conn.ping()
    if (!alive) {
      throw new Error(`Failed to establish SSH connection to ${config.user}@${config.host}`)
    }

    this.connections.set(key, conn)
    this.connectionTimestamps.set(key, Date.now())

    return conn
  }

  /**
   * Close a specific connection
   */
  async closeConnection(key: string): Promise<void> {
    const conn = this.connections.get(key)
    if (conn) {
      await conn.close()
      this.connections.delete(key)
      this.connectionTimestamps.delete(key)
    }
  }

  /**
   * Clean up idle connections
   */
  private cleanupIdleConnections(): void {
    const now = Date.now()

    for (const [key, timestamp] of this.connectionTimestamps.entries()) {
      if (now - timestamp > this.IDLE_TIMEOUT) {
        const conn = this.connections.get(key)
        if (conn) {
          conn.close()
        }
        this.connections.delete(key)
        this.connectionTimestamps.delete(key)
        console.log(`[SSHConnectionPool] Closed idle connection: ${key}`)
      }
    }
  }

  /**
   * Close all connections and shutdown pool
   */
  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }

    for (const [key, conn] of this.connections.entries()) {
      await conn.close()
    }

    this.connections.clear()
    this.connectionTimestamps.clear()
  }

  /**
   * Generate key for connection map
   */
  private getKey(config: SSHConnectionConfig): string {
    const port = config.port || 22
    return `${config.user}@${config.host}:${port}`
  }

  /**
   * Get connection count (for monitoring)
   */
  getConnectionCount(): number {
    return this.connections.size
  }
}

// Export singleton pool
export const sshPool = new SSHConnectionPool()
