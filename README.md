# Agent Manager

A macOS desktop app for monitoring and managing multiple Claude CLI agents. Built with Electron, React, and xterm.js.

## Features

- Spawn and monitor multiple Claude CLI agents simultaneously
- Persistent sessions via tmux — agents keep running when the app is closed
- Real-time terminal output with full scrollback
- Status detection (Running / Wants Input / Finished)
- Table agents you want to set aside without killing them
- Search and filter agents by name, workdir, task, or model
- Import/resume existing Claude sessions
- Remote control support

## Prerequisites

- **Node.js** (v18+)
- **tmux** — required for persistent sessions

```sh
brew install tmux
```

## Development

```sh
npm install
npm run dev
```

## Building

### Local .app (for personal use)

```sh
npm run pack
```

This builds the app to `dist/mac-arm64/Agent Manager.app`. You can copy it to `/Applications`:

```sh
cp -R 'dist/mac-arm64/Agent Manager.app' /Applications/
```

### DMG (for distribution)

```sh
npm run dist
```

Produces a DMG in `dist/`.

## Installing without an Apple Developer certificate

The app is ad-hoc signed, so recipients will see a Gatekeeper warning. To install:

1. Right-click the app and choose **Open**, then confirm the dialog. Or:
2. Run this in Terminal after copying to Applications:

```sh
xattr -cr '/Applications/Agent Manager.app'
```

This strips the quarantine attribute and allows the app to launch.
