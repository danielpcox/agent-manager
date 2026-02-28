import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { AgentManager } from './agentManager'

let btopPty: pty.IPty | null = null

export function registerIpcHandlers(agentManager: AgentManager): void {
  ipcMain.handle('agent:create', async (_event, params) => {
    return agentManager.createAgent(params)
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

  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
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
