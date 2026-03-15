# Changelog

## v1.3.0 (2026-03-15)

### Features
- **Remote SSH sessions** — Create and attach to Claude agents running on remote machines over SSH
  - Discover existing Claude sessions on remote hosts
  - Create new remote sessions with specified working directory
  - Auto-reconnect with exponential backoff on disconnect
  - All detail tabs (transcript, stats, memory, browse) work over SSH
- **Smarter agent creation** — Working directory is the only required field; task is optional, name defaults to folder name
- **Trust dialog awareness** — Task injection detects Claude's trust prompt and waits for user response before injecting
- **Git auto-init** — New agent sessions in fresh folders auto-initialize a git repo

### Fixes
- Fix app crash on quit (PTY event handlers firing during shutdown)
- Fix EADDRINUSE error on restart (web server port not released)
- Fix model display not updating when switching models via `/model`
- Fix Cloudflare bot check blocking Usage webview
- Fix SSH command quoting for remote file operations

## v1.2.0 (2026-03-15)

### Features
- **File viewer** — Click files in Session and Browse tabs to view contents

## v1.1.0 (2026-03-09)

### Features
- README and Apache 2.0 license for public release
- Scrollback history increased from 50k to 200k lines

### Fixes
- Fix false idle detection when switching between agents
- Fix false 'waiting' status when on non-terminal tabs
- Keep Usage webview persistent across tab switches
- Fix New Agent modal closing when drag-selecting text across backdrop
- Fix scrollback continuity when switching between agents

## v1.0.2 (2026-03-02)

### Features
- Mobile web companion for remote agent monitoring
- Session intelligence: stats, memory & global activity dashboard
- Transcript tab with thinking block support
- Bell notification when agent transitions to waiting
- Scrollback history via capture-pane
- Tmux persistence for surviving app restarts
- Session import from existing Claude sessions
- Hotkeys (Cmd+N, Cmd+1-4, Cmd+[/], Cmd+W, Cmd+E)
- Agent tabling system
- Live model detection from PTY output
- Debounced running status detection

### Fixes
- Fix DMG code signing with afterPack hook
- Resolve claude/tmux binary paths for packaged app
- Fix mobile terminal scrolling
- Fix text selection in agent cards
