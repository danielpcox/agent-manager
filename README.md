# Agent Manager

A macOS desktop app for running, monitoring, and managing multiple [Claude Code](https://docs.anthropic.com/en/docs/claude-code) agents simultaneously. Agents persist in tmux sessions that survive app restarts, so your work keeps going even when the app is closed.

Built with Electron, React, and xterm.js. Designed for workflows where you run many Claude agents in parallel and need to keep track of which ones need attention, without juggling terminal tabs.

## Features

### Multi-Agent Inbox
- Run any number of Claude CLI agents in parallel, each in its own persistent tmux session
- Filter by status: **All**, **Running**, **Needs Attention**, **Tabled**
- Search agents by name, working directory, task, or model
- Unread indicators and attention badge count in the sidebar
- Audio bell notification when an agent finishes a long task (>30s) and enters waiting state

### Full Terminal Access
- Complete xterm.js terminal with 50,000-line scrollback
- Direct keyboard input to the Claude PTY -- dip in and interact just like a regular terminal
- Captures tmux pane history when selecting an agent so you can scroll back through everything
- Companion input bar below the terminal for structured messages and screenshot attachments

### Session Intelligence
Each agent has tabs for deeper inspection beyond the terminal:

- **Session** -- Token metrics (input, output, cache read/write), user message and tool call counts, files touched, git branch, session timeline
- **Transcript** -- Full conversation history parsed from Claude's JSONL files, with collapsible thinking blocks and tool calls. Unaffected by terminal redraws.
- **Memory** -- Renders the project's `MEMORY.md` (Claude's persistent cross-session context)

### Persistent Sessions
- Agents run in tmux and continue working when the app is closed
- On relaunch, the app reattaches to live tmux sessions automatically
- If a tmux session dies, the app resumes via `claude --resume` using the saved session ID
- Agent metadata persisted with electron-store

### Agent Creation & Importing
- **New Agent** (`Cmd+N`) -- describe a task, pick a working directory, choose a model and permission mode
- **Import Session** -- browse recent Claude sessions across all projects, enter a session ID directly, or continue the most recent session in a directory (`claude -c`)
- **Models**: Claude Sonnet 4.6, Claude Opus 4.6, Claude Haiku 4.5
- **Permission Modes**:
  - **Autonomous** -- full read/write/execute with `--dangerously-skip-permissions`
  - **Plan First** -- pauses after creating a plan for approval before writing
  - **Read Only** -- can read and search, cannot write or execute

### Agent Actions

| Action | How |
|---|---|
| Rename | Double-click the agent name in the header |
| Kill | Stop the running process (agent stays in list) |
| Remove | Delete a finished/killed agent from the list |
| Table | Set aside without killing -- moves to a "Tabled" section |
| Remote Control | Injects `/rc` into the PTY; click the "RC Active" badge to copy the URL |

### Additional Views
- **Usage** (`Cmd+2`) -- embedded claude.ai/settings/usage for tracking API spend
- **System Monitor** (`Cmd+3`) -- embedded btop terminal for CPU/memory monitoring
- **Global Stats** (`Cmd+4`) -- daily activity table and token totals from Claude CLI stats

### Mobile Web Companion
A built-in Express + WebSocket server lets you monitor agents from any device on your network. The sidebar shows the local URL and 6-digit PIN. Open it on your phone to see agent statuses, send messages, and create new agents remotely.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+N` | New agent |
| `Cmd+1` | Agents view |
| `Cmd+2` | Usage view |
| `Cmd+3` | System monitor (btop) |
| `Cmd+4` | Global stats |
| `Cmd+[` / `Cmd+]` | Previous / next agent |
| `Cmd+W` | Deselect current agent |
| `Cmd+F` | Focus search in inbox |
| `Cmd+E` | Focus terminal |

## Prerequisites

- **macOS** 11.0 or later (arm64 and x64)
- **tmux** -- required for persistent agent sessions
- **Claude CLI** -- installed and authenticated

Install tmux:
```bash
brew install tmux
```

Install Claude CLI: see [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code).

## Installation

### From GitHub Releases

Download the latest `.dmg` from the [Releases](../../releases) page and drag to Applications.

The app is ad-hoc signed (no Apple Developer certificate). If macOS Gatekeeper blocks it:
```bash
xattr -cr '/Applications/Agent Manager.app'
```
Or right-click the app and select **Open**.

### From Source

```bash
git clone https://github.com/danielpcox/agent-manager.git
cd agent-manager
npm install
```

**Development** (hot reload):
```bash
npm run dev
```

**Build .app** (fast, no DMG):
```bash
npm run pack
```

Produces `dist/mac-arm64/Agent Manager.app`. To install:
```bash
pkill -x "Agent Manager"   # if already running
cp -R 'dist/mac-arm64/Agent Manager.app' /Applications/
open -a "Agent Manager"
```

**Build DMG** (for distribution):
```bash
npm run dist
```

## How It Works

### Architecture

```
src/
├── main/                     # Electron main process
│   ├── index.ts              # App init, window creation, tmux check
│   ├── agentManager.ts       # Agent lifecycle, PTY management, tmux
│   ├── ipcHandlers.ts        # IPC handlers + session intelligence parsing
│   ├── webServer.ts          # Express + WebSocket for mobile companion
│   └── store.ts              # electron-store persistence
├── renderer/                 # Desktop UI (React)
│   └── src/
│       ├── App.tsx           # 3-column layout: sidebar + inbox + detail
│       ├── components/       # UI components
│       ├── store/            # Zustand state management
│       └── types/            # TypeScript types
├── web/                      # Mobile web companion (separate React app)
│   ├── components/
│   ├── store/
│   └── wsApi.ts              # WebSocket client
└── preload/                  # Electron context bridge
    └── index.ts
```

### Agent Lifecycle

1. User creates an agent with a task, working directory, model, and permission mode
2. Main process creates a tmux session and spawns Claude CLI inside it via node-pty
3. The initial task is sent to Claude's stdin after a brief startup delay
4. PTY data streams to the renderer in real-time via IPC and renders in xterm.js
5. The app monitors PTY output to detect status transitions (running / waiting / done)
6. Session ID is detected by watching `~/.claude/projects/` for JSONL files

### Status Detection

The app watches for Claude's `✻` activity spinner in PTY output. When output stops flowing for 3 seconds without the spinner, the agent is marked as "Needs Attention." A 5-second debounce on the running transition prevents transient redraws from triggering false status changes.

### Session Intelligence

Session stats, transcripts, and memory are parsed directly from Claude's JSONL conversation files in `~/.claude/projects/`. This gives accurate token counts, tool call history, and full conversation reconstructions independent of what's visible in the terminal.

## Tech Stack

- [Electron](https://www.electronjs.org/) 34 + [electron-vite](https://electron-vite.org/)
- [React](https://react.dev/) 19 + [TypeScript](https://www.typescriptlang.org/) 5.7
- [Tailwind CSS](https://tailwindcss.com/) 4
- [Zustand](https://zustand.docs.pmnd.rs/) 5
- [node-pty](https://github.com/nicktids/node-pty) -- PTY spawning
- [xterm.js](https://xtermjs.org/) 5.5 -- terminal rendering
- [Express](https://expressjs.com/) + [ws](https://github.com/websockets/ws) -- mobile web companion
- [electron-store](https://github.com/sindresorhus/electron-store) -- persistence
- [electron-builder](https://www.electron.build/) -- packaging and distribution

## Releases

A GitHub Actions workflow builds and publishes DMG artifacts when you push a version tag:

```bash
git tag v1.0.2
git push origin v1.0.2
```

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.
