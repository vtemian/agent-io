# Sound Alerts

Plays different macOS system sounds when coding agents change status. Uses `@agentprobe/core` to watch for agent lifecycle events and `afplay` to trigger audio feedback.

## Prerequisites

- macOS (uses built-in system sounds and `afplay`)
- Node.js 20+
- `@agentprobe/core` built locally (`npm run build` from the repo root)

## Setup

```bash
cd examples/sounds
```

## Run

```bash
npx tsx sounds.ts [workspace-path]
```

If no workspace path is provided, it defaults to the current working directory.

## What it does

Monitors all detected coding agents (Cursor, Claude Code, Codex, OpenCode) in the given workspace and plays a distinct sound for each lifecycle event:

- **Joined** (`Pop.aiff`) -- an agent starts a new session
- **Completed** (`Glass.aiff`) -- an agent finishes its task
- **Error** (`Basso.aiff`) -- an agent encounters an error

Idle and heartbeat events are silently skipped. Each event is also logged to the console with a timestamp, source label, status, and task summary.

## Demo

<!-- TODO: Add demo video -->
