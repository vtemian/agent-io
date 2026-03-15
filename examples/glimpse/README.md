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

### agent-monitor (pinned overlay)

```bash
npx tsx agent-monitor.ts [workspace-path]
```

Opens a transparent window pinned to the top-left corner of your screen (position 20, 100).

### floating-monitor (click-through HUD)

```bash
npx tsx floating-monitor.ts [workspace-path]
```

A more compact, click-through variant. The window floats above all apps and passes clicks through to whatever is underneath, so it never interferes with your workflow. Slightly smaller dimensions and tighter spacing compared to the pinned monitor.

If no workspace path is provided, both monitors default to the current working directory.

## What it does

Both monitors display every active coding agent (Cursor, Claude Code, Codex, OpenCode) detected in the given workspace, with:

- A colored status dot (green = running, yellow = idle, gray = completed, red = error)
- The agent's source label
- The current task summary
- A relative timestamp ("3s ago", "2m ago")

The window auto-updates every second and fades agents in/out as they join or leave.

## Demo

<!-- TODO: Add demo video -->
