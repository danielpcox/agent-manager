import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { AgentManager } from './agentManager'
import { getWebInfo } from './webServer'

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

let btopPty: pty.IPty | null = null

export function registerIpcHandlers(agentManager: AgentManager): void {
  ipcMain.handle('agent:create', async (_event, params) => {
    return agentManager.createAgent(params)
  })

  ipcMain.handle('agent:import', async (_event, params) => {
    return agentManager.importAgent(params)
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

  ipcMain.handle('agent:markRead', async (_event, { agentId }) => {
    agentManager.markRead(agentId)
  })

  ipcMain.handle('agent:rename', async (_event, { agentId, name }) => {
    agentManager.renameAgent(agentId, name)
  })

  ipcMain.handle('agent:table', async (_event, { agentId, tabled }) => {
    agentManager.tableAgent(agentId, tabled)
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
}
