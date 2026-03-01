# Agent Manager

A macOS desktop app for running, monitoring, and inspecting multiple Claude CLI agents simultaneously. Agents live in persistent tmux sessions — they keep working when the app is closed, and you can dip into any terminal at any time.

---

## Features

### Multi-Agent Inbox
- Run any number of Claude CLI agents in parallel, each in its own tmux session
- Inbox with **Needs Attention** filter (default) highlights agents waiting for input
- Filter tabs: All · Running · Needs Attention · Tabled
- Search agents by name, working directory, task, or model
- Unread indicators and attention badge count in the sidebar
- **Bell notification** — plays a soft ding when an agent finishes a long-running task (>30s) and wants input; toggle on/off per session

### Persistent Sessions via tmux
- Agents keep running in the background when you close Agent Manager
- On relaunch, all live sessions are automatically reattached
- If a tmux session dies unexpectedly but the Claude session ID is known, the agent auto-resumes via `--resume`

### Terminal Tab
- Full xterm.js terminal with 50,000-line scrollback
- Captures tmux pane history on attach so you can scroll back through the full conversation
- Keyboard input passes directly to the Claude PTY — use it like any terminal
- Escape (when not in an input field) focuses the terminal

### Session Tab
Per-session stats parsed directly from `~/.claude/projects/` JSONL files:
- **Token usage** — input, output, cache read, cache creation totals
- **Activity** — user message count, tool call count
- **Files touched** — unique file paths accessed via tool calls, shown relative to workdir
- **Identity** — session slug and git branch
- **Timeline** — first and last activity timestamps

Session ID is detected automatically via filesystem watch and updates live after conversation compaction.

### Transcript Tab
Full conversation history read directly from the JSONL — not the TUI, so it's unaffected by screen redraws:
- **User messages**
- **Thinking blocks** — expanded by default with character count, collapsible
- **Assistant text responses**
- **Tool calls** — collapsed by default, expand to see full input JSON

Always shows the most recently active session file, so it stays current after Claude compacts the conversation.

### Memory Tab
Renders the project's `MEMORY.md` from `~/.claude/projects/{encoded-path}/memory/MEMORY.md` — the persistent cross-session context Claude builds up over time.

### Stats View (`Cmd+4`)
Global Claude CLI activity pulled from `~/.claude/stats-cache.json`:
- Daily table: date · sessions · messages · tool calls (last 30 days)
- Token totals aggregated by model across the shown period

### Usage View (`Cmd+2`)
Embeds `claude.ai/settings/usage` directly in the app so you can track API spend without leaving.

### System Monitor (`Cmd+3`)
Embeds `btop` as a live terminal panel for CPU, memory, and process monitoring.

### Mobile Web Companion
A lightweight web server runs alongside the app. The sidebar shows the local URL and PIN — open it on any device on the same network to monitor your agents remotely.

---

## Creating & Importing Agents

**New Agent** (`Cmd+N`)
- Describe the task, select a working directory, optionally set a name
- Choose model: Sonnet 4.6 · Opus 4.6 · Haiku 4.5
- Choose permission mode:
  - **Autonomous** — full read/write/execute, no interruptions
  - **Plan First** — drafts a plan and pauses for approval before writing
  - **Read Only** — can read and search, cannot write or execute

**Import Session** (`Cmd+N` → Import tab)
- **Browse** — searchable list of recent Claude sessions across all projects
- **By ID** — enter a session UUID directly
- **Continue Recent** — resumes the most recent session in the selected directory (`claude -c`)

---

## Agent Actions

| Action | How |
|---|---|
| Rename | Double-click the agent name in the header |
| Kill | Stop the running process (agent stays in list) |
| Remove | Remove a finished/killed agent from the list |
| Table | Set aside without killing — moves to a "Tabled" section |
| Remote Control | Injects `/rc` into the PTY; click "RC Active" badge to copy the URL |

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+N` | New agent |
| `Cmd+1` | Agents view |
| `Cmd+2` | Usage view |
| `Cmd+3` | System monitor |
| `Cmd+4` | Stats view |
| `Cmd+[` / `Cmd+]` | Previous / next agent |
| `Cmd+W` | Deselect current agent |
| `Cmd+F` | Focus search |
| `Ctrl+E` | Focus terminal |

---

## Prerequisites

- **Node.js** v18+
- **tmux** — required for persistent sessions

```sh
brew install tmux
```

---

## Development

```sh
npm install
npm run dev
```

## Building

### Local .app (personal use)

```sh
npm run pack
```

Builds to `dist/mac-arm64/Agent Manager.app`. To install:

```sh
pkill -x "Agent Manager"
cp -R 'dist/mac-arm64/Agent Manager.app' /Applications/
open -a "Agent Manager"
```

### DMG (distribution)

```sh
npm run dist
```

Produces a signed DMG in `dist/`.

---

## Installing without an Apple Developer certificate

The app is ad-hoc signed. If macOS blocks it:

```sh
xattr -cr '/Applications/Agent Manager.app'
```

Or right-click → Open → confirm the Gatekeeper dialog.

---

## Tech Stack

- **Electron** + electron-vite + React + TypeScript
- **Tailwind v4** + Zustand
- **node-pty** — PTY-based Claude CLI spawning
- **xterm.js** — terminal rendering with full scrollback
- **tmux** — persistent background sessions
