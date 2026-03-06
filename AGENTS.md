# Agent Coding Rules

## Cursor Integration
- Cursor-native rules are defined in `.cursor/rules/*.mdc`.
- Keep this file aligned with those rules; `.mdc` files are the authoritative source for scoped guidance.

## Scope
- Apply these rules to all generated code in this repository.

## Architecture
- Keep `src/core` provider-agnostic; never import from `src/providers` into core modules.
- Implement integrations in `src/providers/*` by adapting data into core contracts.
- Use named exports only; do not add default exports in `src`.
- Re-export public APIs through barrel files (`index.ts`).

## TypeScript Style
- Use factory functions (`createX`) with closed-over state, not classes.
- Prefer `interface` for contracts and `type` for unions/aliases.
- Use `as const` constant maps for statuses/events and derive union types from them.
- Use `import type` for type-only imports.
- Use `unknown` at boundaries and normalize with `toError(...)` before handling.
- Prefer early returns and small helpers over deep nesting.

## Module Structure
- Order files as: imports -> exported types/constants -> internal constants/schemas -> main factory -> private helpers.
- Place shared tunables in `constants.ts`; keep file-local constants near the top of the module.
- Keep comments sparse and only for non-obvious behavior.

## Provider Pipeline
- Follow `discover -> read -> normalize` contract shape exactly.
- `discover` must return `{ inputs, watchPaths, warnings }`.
- `read` must return raw records + health, not canonicalized payloads.
- `normalize` must produce canonical `{ agents, health }`.
- Treat parse failures as non-fatal: accumulate warnings and continue.

## Event and Runtime Safety
- Never let listener exceptions break loops; wrap fan-out callbacks in `try/catch`.
- Make cleanup best-effort (`disconnect/close/unsubscribe` should not mask primary failures).
- Keep status names consistent: `running | idle | completed | error`.

## Imports and Paths
- Use `@/*` aliases for cross-folder project imports.
- Use `./` relative imports within the same folder.
- Avoid parent-relative imports (`../`) where `@/*` is appropriate.

## Tests
- Place tests in `tests/*.test.ts` with behavior-focused `it(...)` names.
- Use `/tmp` unique paths for filesystem tests and always cleanup in `afterEach`.
- Prefer condition polling helpers (`waitUntil` style) over fixed sleeps.
- Assert behavior/output first; assert internal call counts only when needed.

## Verification Before Completion
- Run `npm run check` after substantive changes.
- If build/runtime-sensitive code changed, also run `npm run build`.
