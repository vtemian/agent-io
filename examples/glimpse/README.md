# Glimpse Agent Monitor

A floating, always-on-top overlay that shows active coding agents in real time. Built with [GlimpseUI](https://github.com/nicktrav/glimpseui) and `@agentprobe/core`.

## Prerequisites

- macOS (GlimpseUI uses a native Swift backend)
- Node.js 20+
- `@agentprobe/core` built locally (`npm run build` from the repo root)

## Setup

```bash
cd examples/glimpse
npm install
```

## Run

```bash
npx tsx agent-monitor.ts [workspace-path]
```

If no workspace path is provided, it defaults to the current working directory.

## What it does

Opens a small transparent window pinned to the top-left corner of your screen. It displays every active coding agent (Cursor, Claude Code, Codex, OpenCode) detected in the given workspace, with:

- A colored status dot (green = running, yellow = idle, gray = completed, red = error)
- The agent's source label
- The current task summary
- A relative timestamp ("3s ago", "2m ago")

The window auto-updates every second and fades agents in/out as they join or leave.
