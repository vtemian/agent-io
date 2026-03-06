# Contributing to @agentprobe/core

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Development Setup

```bash
git clone git@github.com:vtemian/agentprobe.git
cd agentprobe
npm install
```

### Scripts

| Command | Description |
|---|---|
| `npm run check` | Run all quality gates (lint + typecheck + test) |
| `npm run test` | Run test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint with Biome |
| `npm run format` | Format with Biome |
| `npm run typecheck` | TypeScript type checking |
| `npm run build` | Build dist bundles with tsup |

### Code Style

This project uses [Biome](https://biomejs.dev/) for linting and formatting. Run `npm run format` before committing. The CI pipeline enforces this.

TypeScript strict mode is enabled. Avoid `any`, `as` casts, and `unknown` without proper narrowing.

## How to Contribute

### Reporting Bugs

Open an issue using the [bug report template](https://github.com/vtemian/agentprobe/issues/new?template=bug_report.md). Include:

- Steps to reproduce
- Expected vs actual behavior
- Node.js and package version
- Relevant error output

### Suggesting Features

Open an issue using the [feature request template](https://github.com/vtemian/agentprobe/issues/new?template=feature_request.md).

### Submitting Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add or update tests for your changes
4. Run `npm run check` and ensure everything passes
5. Write a clear commit message (see below)
6. Open a pull request

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `docs:` — documentation only
- `chore:` — build, CI, or tooling changes
- `test:` — adding or updating tests

### Pull Request Process

1. Fill in the PR template
2. Ensure CI passes
3. Keep PRs focused — one concern per PR
4. Update documentation if the public API changes

## Project Structure

```
src/
├── core/              # Provider-agnostic runtime and observer
│   ├── runtime/       # Watch runtime state machine
│   ├── observer.ts    # Observer API (createObserver)
│   ├── lifecycle.ts   # Lifecycle diffing (joined/left/changed)
│   ├── providers.ts   # TranscriptProvider interface
│   ├── model.ts       # Canonical agent model
│   ├── types.ts       # Core type definitions
│   └── errors.ts      # Error types and helpers
├── providers/
│   └── cursor/        # Cursor transcript provider
│       ├── provider.ts    # Provider implementation
│       ├── discovery.ts   # Transcript file discovery
│       └── transcripts.ts # JSONL parsing and normalization
├── domain.ts          # Provider-internal domain types
└── index.ts           # Root entry point (defaults to Cursor)
```

## Questions?

Open an issue or start a discussion. We're happy to help.
