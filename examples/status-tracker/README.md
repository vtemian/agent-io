# Status Tracker

Tracks active coding agents and prints a live status summary to stdout. Shows running/idle counts, agent IDs, and task summaries.

## Prerequisites

- Node.js 20+
- `@agentprobe/core` built locally (`npm run build` from the repo root)

## Run

```bash
npx tsx examples/status-tracker/status-tracker.ts [workspace-path]
```

If no workspace path is provided, it defaults to the current working directory.

## What it does

Maintains a map of active agents and prints a summary on every lifecycle event:

- Running and idle agents are tracked with status icons (`▶` running, `◦` idle)
- Completed and errored agents are removed from the active set
- Each update shows status counts and per-agent task summaries

## Demo

<!-- TODO: Add demo video -->
