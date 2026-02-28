import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as readline from 'readline'
import { AgentManager } from './agentManager'

interface SessionInfo {
  sessionId: string
  project: string
  summary: string
  timestamp: string
  mtime: number
}

function decodeClaudeProjectPath(encoded: string): string {
  // Claude encodes paths by replacing '/' with '-' and prepending '-'
  // e.g. /Users/danielpcox/projects/agent-manager -> -Users-danielpcox-projects-agent-manager
  // This is lossy (real hyphens are indistinguishable from separators).
  // We try the naive decode first, then walk the filesystem to find the real path.
  const stripped = encoded.replace(/^-/, '')
  const parts = stripped.split('-')

  // Greedily reconstruct the path by checking which segments exist
  let resolved = '/'
  let i = 0
  while (i < parts.length) {
    // Try increasingly longer hyphenated segments
    let found = false
    for (let j = parts.length; j > i; j--) {
      const candidate = parts.slice(i, j).join('-')
      const testPath = path.join(resolved, candidate)
      if (fs.existsSync(testPath)) {
        resolved = testPath
        i = j
        found = true
        break
      }
    }
    if (!found) {
      // Fallback: just use the single part
      resolved = path.join(resolved, parts[i])
      i++
    }
  }
  return resolved
}

async function listClaudeSessions(): Promise<SessionInfo[]> {
  const base = path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(base)) return []

  const sessions: SessionInfo[] = []
  const projDirs = fs.readdirSync(base, { withFileTypes: true })

  for (const projDir of projDirs) {
    if (!projDir.isDirectory()) continue

    const projPath = path.join(base, projDir.name)
    const realPath = decodeClaудеProjectPath(projDir.name)
    const files = fs.readdirSync(projPath).filter((f) => f.endsWith('.jsonl'))

    for (const file of files) {
      const sessionId = file.replace('.jsonl', '')
      const filePath = path.join(projPath, file)
      const stat = fs.statSync(filePath)

      let summary = ''
      let timestamp = ''

      try {
        const stream = fs.createReadStream(filePath, { encoding: 'utf-8' })
        const rl = readline.createInterface({ input: stream })

        for await (const line of rl) {
          try {
            const d = JSON.parse(line)
            if (d.type === 'user' && !d.isMeta) {
              const content = d.message?.content
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
              timestamp = d.timestamp || ''
              break
            }
          } catch {
            continue
          }
        }

        rl.close()
        stream.destroy()
      } catch {
        continue
      }

      if (summary) {
        sessions.push({
          sessionId,
          project: realPath,
          summary,
          timestamp,
          mtime: stat.mtimeMs
        })
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

  ipcMain.handle('agent:getAll', async () => {
    return agentManager.getAllAgents()
  })

  ipcMain.handle('agent:get', async (_event, { agentId }) => {
    return agentManager.getAgent(agentId)
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
}
