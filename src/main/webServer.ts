import express from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import http from 'http'
import path from 'path'
import os from 'os'
import { AgentManager } from './agentManager'

interface WebClient {
  ws: WebSocket
  subscribedAgentIds: Set<string>
}

function getLocalIp(): string {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return 'localhost'
}

let webInfo: { url: string; pin: string } | null = null

export function getWebInfo(): { url: string; pin: string } | null {
  return webInfo
}

export function startWebServer(agentManager: AgentManager, pin: string): { url: string; pin: string } {
  const app = express()
  // In production: __dirname is out/main/, so out/web/ is at ../../web relative to out/main/
  // __dirname = out/main/ at runtime, so ../web = out/web/
  const webDir = path.join(__dirname, '../web')
  app.use(express.static(webDir))

  const server = http.createServer(app)
  const wss = new WebSocketServer({ noServer: true })

  const clients = new Set<WebClient>()

  agentManager.onEvent = (channel: string, data: unknown) => {
    for (const client of clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue
      if (channel === 'agent:ptyData') {
        const pd = data as { agentId: string; data: string }
        if (!client.subscribedAgentIds.has(pd.agentId)) continue
      }
      client.ws.send(JSON.stringify({ type: channel, ...(data as object) }))
    }
  }

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url!, `http://${req.headers.host}`)
    const clientPin = url.searchParams.get('pin')
    if (clientPin !== pin) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', (ws) => {
    const client: WebClient = { ws, subscribedAgentIds: new Set() }
    clients.add(client)
    ws.send(JSON.stringify({ type: 'init', agents: agentManager.getAllAgents() }))

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        switch (msg.type) {
          case 'subscribe':
            client.subscribedAgentIds.add(msg.agentId)
            break
          case 'unsubscribe':
            client.subscribedAgentIds.delete(msg.agentId)
            break
          case 'agent:sendMessage':
            agentManager.sendMessage(msg.agentId, msg.message)
            break
          case 'agent:create': {
            const agent = agentManager.createAgent(msg.params)
            ws.send(JSON.stringify({ type: 'agent:created:response', requestId: msg.requestId, agent }))
            break
          }
          case 'agent:markRead':
            agentManager.markRead(msg.agentId)
            break
          case 'agent:kill':
            agentManager.killAgent(msg.agentId)
            break
          case 'agent:remove':
            agentManager.removeAgent(msg.agentId)
            break
          case 'agent:rename':
            agentManager.renameAgent(msg.agentId, msg.name)
            break
          case 'agent:table':
            agentManager.tableAgent(msg.agentId, msg.tabled)
            break
          case 'agent:resizePtyForRedraw':
            agentManager.resizePtyForRedraw(msg.agentId, msg.cols, msg.rows)
            break
          case 'agent:writePty':
            agentManager.writeToPty(msg.agentId, msg.data)
            break
          case 'capturePane': {
            const data = agentManager.capturePane(msg.agentId)
            ws.send(JSON.stringify({ type: 'capturePane:response', requestId: msg.requestId, data }))
            break
          }
        }
      } catch (err) {
        console.error('[WebServer] Error handling WS message:', err)
      }
    })

    ws.on('close', () => {
      clients.delete(client)
    })
  })

  const PORT = 3847
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[WebServer] Listening on port ${PORT}`)
  })

  const ip = getLocalIp()
  const url = `http://${ip}:${PORT}`
  webInfo = { url, pin }
  return { url, pin }
}
