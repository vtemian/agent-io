# Terminal Dashboard

A full-screen terminal dashboard that displays active AI coding agents in real time. Built with [blessed](https://github.com/chjj/blessed), [blessed-contrib](https://github.com/yaronn/blessed-contrib), and `@agentprobe/core`.

## Prerequisites

- Node.js 20+
- `@agentprobe/core` built locally (`npm run build` from the repo root)

## Setup

```bash
cd examples/dashboard
npm install
```

## Run

```bash
npx tsx dashboard.ts [workspace-path]
```

If no workspace path is provided, it defaults to the current working directory.

## What it does

Opens a full-screen terminal UI with three panels:

- **Header bar** -- shows the total agent count and dashboard uptime.
- **Agent table** (top half) -- lists every detected agent (Cursor, Claude Code, Codex, OpenCode) with its source, color-coded status, task summary, and session duration.
- **Event log** (bottom half) -- scrollable feed of agent lifecycle events (joined, left, status changes) with timestamps.

Status colors:

| Color  | Meaning   |
|--------|-----------|
| Green  | Running   |
| Yellow | Idle      |
| Gray   | Completed |
| Red    | Error     |

Key bindings:

- `q` or `Ctrl-C` -- graceful shutdown (stops the observer, destroys the screen, exits).

The dashboard auto-refreshes every second so durations and uptime stay current between observer events.

## Demo

<!-- TODO: Add demo video -->
