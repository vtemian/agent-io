# Codex Provider Design

## Goal

Add a Codex transcript provider that discovers and parses OpenAI Codex CLI/Desktop session files, producing `CanonicalAgentSnapshot` output consistent with the claude-code and cursor providers.

## Architecture

The Codex provider follows the same module structure as existing providers: `discovery.ts`, `transcripts.ts`, `provider.ts`, `schemas.ts`, `constants.ts`, `watch.ts`, and `index.ts` under `src/providers/codex/`.

Key difference from claude-code: Codex stores all sessions globally at `~/.codex/sessions/YYYY/MM/DD/*.jsonl` (date-based tree, not workspace-scoped). Discovery reads line 1 of each file to extract `session_meta.payload.cwd` and match against requested workspace paths.

## Discovery

Scans `~/.codex/sessions/` recursively for `.jsonl` files. For each file, reads line 1 synchronously, parses the `session_meta` record, extracts `payload.cwd`. Files whose `cwd` matches any requested workspace path become discovery inputs.

Header cache: `Map<string, { mtimeMs, cwd, sessionId }>` persists across discovery calls. Only new or modified files (by mtime) get their first line re-read. Old-format files (2025, no `type: "session_meta"`) are skipped.

Discovery returns matching file paths as `DiscoveryInput[]` and `~/.codex/sessions/` as the single watch path. Caches results by workspace paths + file list (same pattern as claude-code/cursor).

## Transcript Parsing

Incremental parsing with file cache (mtimeMs + sizeBytes + lineCount). Only re-parses appended lines.

### Record types parsed

| Record type | Extraction |
|---|---|
| `session_meta` | sessionId, cwd, gitBranch, cliVersion, source, model_provider |
| `response_item` (message, role=user) | latestUserContent, messageCount++ |
| `response_item` (message, role=assistant) | messageCount++ |
| `response_item` (function_call) | toolCallCount++ |
| `turn_context` | model name |

### Records skipped

`reasoning`, `function_call_output`, `custom_tool_call_output`, all `event_msg` subtypes (token_count, agent_reasoning, agent_message, user_message).

### Schema validation

Zod schemas for `session_meta`, `response_item` (discriminated by payload.type + payload.role), `turn_context`. Old-format records fail safeParse and are skipped. Consistent with claude-code's approach.

### Status derivation

Same time-window approach as claude-code: running <= 3s, idle <= 60s, else completed. No subagent tracking (Codex sessions don't have subagent progress records).

## Provider API

```typescript
codex(options?: CodexOptions): TranscriptProvider
```

Options: `codexHomePath` (default `~/.codex`), `sourceLabel`, `watch` (false to disable), `maxFiles`.

Lifecycle: discover -> connect -> read -> normalize. Uses `normalizeFromPayload` from shared. Watch uses `fs.watch` on `~/.codex/sessions/` recursively, debounced.

Integrated into `src/index.ts` default providers list.

## Shared utilities reused

From `providers/shared/providers.ts`: arraysEqual, mergeAgents, pruneStaleCache, statSourceFile, readSourceFile, normalizeFromPayload.
From `providers/shared/discovery.ts`: collectJsonlFiles, directoryExists.

## Testing

- `codex-discovery.test.ts`: temp dir structure, cwd matching, old-format skip, header cache, maxFiles cap
- `codex-transcripts.test.ts`: record parsing, counts, status derivation, incremental parsing, cache invalidation
- `codex-provider.test.ts`: full pipeline integration (discover -> connect -> read -> normalize)
- `codex-watch.test.ts`: fs.watch subscription, debounce, close cleanup

All tests use real file I/O with temp directories, no fs mocks.
