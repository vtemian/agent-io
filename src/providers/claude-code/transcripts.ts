import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  CANONICAL_AGENT_KIND,
  CANONICAL_AGENT_STATUS,
  type CanonicalAgentSnapshot,
  type CanonicalAgentStatus,
} from "@/core/model";
import { formatLineWarning } from "@/providers/shared/discovery-utils";
import { mergeAgents, pruneStaleCache } from "@/providers/shared/provider-utils";
import {
  parseSessionRecord,
  parseAgentProgressData,
  type ClaudeCodeSessionRecord,
} from "./schemas";
import {
  CLAUDE_CODE_SOURCE_KIND,
  CLAUDE_CODE_RUNNING_WINDOW_MS,
  CLAUDE_CODE_IDLE_WINDOW_MS,
} from "./constants";

// --- Types ---

export interface ClaudeCodeTranscriptSourceResult {
  agents: CanonicalAgentSnapshot[];
  connected: boolean;
  sourceLabel: string;
  warnings: string[];
}

export interface ClaudeCodeTranscriptSourceOptions {
  sourcePaths: string[];
  sourceLabel?: string;
}

export interface ClaudeCodeTranscriptSource {
  readonly sourceKind: typeof CLAUDE_CODE_SOURCE_KIND;
  connect(): void;
  disconnect(): void;
  readSnapshot(now?: number): Promise<ClaudeCodeTranscriptSourceResult>;
}

// --- Parse state ---

interface SubagentParseState {
  agentId: string;
  prompt: string | undefined;
  firstSeenAt: number;
  lastSeenAt: number;
  progressCount: number;
}

interface SessionParseState {
  sessionId: string | undefined;
  model: string | undefined;
  gitBranch: string | undefined;
  cwd: string | undefined;
  version: string | undefined;
  permissionMode: string | undefined;
  latestUserContent: string | undefined;
  latestTimestamp: number | undefined;
  firstTimestamp: number | undefined;
  latestRecordType: string | undefined;
  lastAssistantHadToolUse: boolean;
  messageCount: number;
  toolCallCount: number;
  subagents: Map<string, SubagentParseState>;
}

interface SessionFileCache {
  mtimeMs: number;
  sizeBytes: number;
  lineCount: number;
  state: SessionParseState;
  fileUpdatedAt: number;
}

// --- Factory ---

export function createClaudeCodeTranscriptSource(
  options: ClaudeCodeTranscriptSourceOptions,
): ClaudeCodeTranscriptSource {
  const sourcePaths = Array.isArray(options.sourcePaths) ? [...options.sourcePaths] : [];
  const sourceLabel = options.sourceLabel ?? CLAUDE_CODE_SOURCE_KIND;
  let connected = false;
  const fileCache = new Map<string, SessionFileCache>();

  function connect(): void {
    connected = true;
  }

  function disconnect(): void {
    connected = false;
    fileCache.clear();
  }

  async function readSnapshot(now: number = Date.now()): Promise<ClaudeCodeTranscriptSourceResult> {
    if (!connected) {
      return {
        agents: [],
        connected: false,
        sourceLabel,
        warnings: ["Claude Code transcript source is disconnected."],
      };
    }

    if (sourcePaths.length === 0) {
      return {
        agents: [],
        connected: false,
        sourceLabel,
        warnings: ["No session paths configured."],
      };
    }

    const warnings: string[] = [];
    const orderedIds: string[] = [];
    const latestById = new Map<string, CanonicalAgentSnapshot>();
    let hasReadError = false;
    let successfulReads = 0;

    for (const sourcePath of sourcePaths) {
      let fileUpdatedAt = now;
      let fileSizeBytes = 0;
      try {
        const stats = await stat(sourcePath);
        fileUpdatedAt = Math.round(stats.mtimeMs);
        fileSizeBytes = stats.size;
      } catch {
        // Keep default now timestamp when stat access fails.
      }

      const cached = fileCache.get(sourcePath);

      if (cached && cached.mtimeMs === fileUpdatedAt && cached.sizeBytes === fileSizeBytes) {
        successfulReads += 1;
        mergeAgents(
          resolveAgentsFromState(cached.state, cached.fileUpdatedAt, now),
          orderedIds,
          latestById,
        );
        continue;
      }

      const contentChanged = !cached || fileSizeBytes !== cached.sizeBytes;
      const effectiveUpdatedAt = contentChanged ? fileUpdatedAt : cached.fileUpdatedAt;

      if (cached && !contentChanged) {
        successfulReads += 1;
        fileCache.set(sourcePath, { ...cached, mtimeMs: fileUpdatedAt });
        mergeAgents(
          resolveAgentsFromState(cached.state, effectiveUpdatedAt, now),
          orderedIds,
          latestById,
        );
        continue;
      }

      let contents: string;
      try {
        contents = await readFile(sourcePath, "utf8");
        successfulReads += 1;
      } catch {
        hasReadError = true;
        warnings.push(`Failed to read session path: ${sourcePath}`);
        continue;
      }

      const lines = contents.split(/\r?\n/);
      let state: SessionParseState;
      let startLine: number;

      if (cached && fileSizeBytes >= cached.sizeBytes && lines.length >= cached.lineCount) {
        state = cloneParseState(cached.state);
        startLine = cached.lineCount;
      } else {
        state = createInitialParseState();
        startLine = 0;
      }

      accumulateLines(state, lines, startLine, sourcePath, warnings);

      fileCache.set(sourcePath, {
        mtimeMs: fileUpdatedAt,
        sizeBytes: fileSizeBytes,
        lineCount: lines.length,
        state: cloneParseState(state),
        fileUpdatedAt: effectiveUpdatedAt,
      });

      mergeAgents(resolveAgentsFromState(state, effectiveUpdatedAt, now), orderedIds, latestById);
    }

    pruneStaleCache(fileCache, sourcePaths);

    const agents = orderedIds
      .map((id) => latestById.get(id))
      .filter((agent): agent is CanonicalAgentSnapshot => agent !== undefined);

    return {
      agents,
      connected: successfulReads > 0 || !hasReadError,
      sourceLabel,
      warnings,
    };
  }

  return {
    sourceKind: CLAUDE_CODE_SOURCE_KIND,
    connect,
    disconnect,
    readSnapshot,
  };
}

// --- Parse state management ---

function createInitialParseState(): SessionParseState {
  return {
    sessionId: undefined,
    model: undefined,
    gitBranch: undefined,
    cwd: undefined,
    version: undefined,
    permissionMode: undefined,
    latestUserContent: undefined,
    latestTimestamp: undefined,
    firstTimestamp: undefined,
    latestRecordType: undefined,
    lastAssistantHadToolUse: false,
    messageCount: 0,
    toolCallCount: 0,
    subagents: new Map(),
  };
}

function cloneParseState(state: SessionParseState): SessionParseState {
  const clonedSubagents = new Map<string, SubagentParseState>();
  for (const [key, value] of state.subagents) {
    clonedSubagents.set(key, { ...value });
  }
  return { ...state, subagents: clonedSubagents };
}

// --- Line accumulator ---

function accumulateLines(
  state: SessionParseState,
  lines: string[],
  startIndex: number,
  sourcePath: string,
  warnings: string[],
): void {
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      warnings.push(formatLineWarning(sourcePath, i + 1, "Invalid JSON line."));
      continue;
    }

    const record = parseSessionRecord(parsed);
    if (record === null) {
      // Silently skip file-history-snapshot, queue-operation, and unknown records
      continue;
    }

    accumulateRecord(state, record);
  }
}

function accumulateRecord(state: SessionParseState, record: ClaudeCodeSessionRecord): void {
  // Extract common base fields
  if (!state.sessionId) {
    state.sessionId = record.sessionId;
  }
  state.gitBranch = record.gitBranch;
  state.cwd = record.cwd;
  state.version = record.version;

  const timestamp = new Date(record.timestamp).getTime();
  if (!state.firstTimestamp || timestamp < state.firstTimestamp) {
    state.firstTimestamp = timestamp;
  }
  if (!state.latestTimestamp || timestamp > state.latestTimestamp) {
    state.latestTimestamp = timestamp;
  }

  if (record.type === "user") {
    state.messageCount += 1;
    state.latestRecordType = "user";
    const content = record.message.content;
    if (typeof content === "string") {
      state.latestUserContent = content;
    } else {
      const textParts = content
        .filter((entry) => entry.type === "text" && typeof entry.text === "string")
        .map((entry) => entry.text ?? "")
        .join(" ");
      if (textParts.length > 0) {
        state.latestUserContent = textParts;
      }
    }
    if ("permissionMode" in record && typeof record.permissionMode === "string") {
      state.permissionMode = record.permissionMode;
    }
    return;
  }

  if (record.type === "assistant") {
    state.messageCount += 1;
    state.latestRecordType = "assistant";
    if (record.message.model) {
      state.model = record.message.model;
    }
    const hasToolUse = record.message.content.some((entry) => entry.type === "tool_use");
    state.lastAssistantHadToolUse = hasToolUse;
    if (hasToolUse) {
      state.toolCallCount += record.message.content.filter(
        (entry) => entry.type === "tool_use",
      ).length;
    }
    return;
  }

  if (record.type === "progress") {
    state.latestRecordType = "progress";
    const agentProgress = parseAgentProgressData(record.data);
    if (agentProgress) {
      accumulateSubagent(state, agentProgress.agentId, agentProgress.prompt, timestamp);
    }
    return;
  }

  // system records: update timestamp tracking but no special handling
  state.latestRecordType = "system";
}

function accumulateSubagent(
  state: SessionParseState,
  agentId: string,
  prompt: string | undefined,
  timestamp: number,
): void {
  const existing = state.subagents.get(agentId);
  if (existing) {
    existing.lastSeenAt = timestamp;
    existing.progressCount += 1;
  } else {
    state.subagents.set(agentId, {
      agentId,
      prompt,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      progressCount: 1,
    });
  }
}

// --- Agent resolution ---

function resolveAgentsFromState(
  state: SessionParseState,
  fileUpdatedAt: number,
  now: number,
): CanonicalAgentSnapshot[] {
  if (!state.sessionId || state.messageCount === 0) {
    return [];
  }

  const agents: CanonicalAgentSnapshot[] = [];

  // Parent agent
  const parentId = deriveAgentId(state.sessionId);
  const parentUpdatedAt = state.latestTimestamp ?? fileUpdatedAt;
  agents.push({
    id: parentId,
    name: deriveAgentName(parentId, false),
    kind: CANONICAL_AGENT_KIND.local,
    isSubagent: false,
    status: deriveStatus(now, parentUpdatedAt),
    taskSummary: state.latestUserContent ?? "Working",
    startedAt: state.firstTimestamp,
    updatedAt: fileUpdatedAt,
    source: CLAUDE_CODE_SOURCE_KIND,
    metadata: {
      model: state.model,
      gitBranch: state.gitBranch,
      version: state.version,
      cwd: state.cwd,
      permissionMode: state.permissionMode,
      messageCount: state.messageCount,
      toolCallCount: state.toolCallCount,
    },
  });

  // Subagents
  for (const [agentId, sub] of state.subagents) {
    const subId = `${state.sessionId}:${agentId}`;
    agents.push({
      id: subId,
      name: deriveAgentName(agentId, true),
      kind: CANONICAL_AGENT_KIND.local,
      isSubagent: true,
      status: deriveStatus(now, sub.lastSeenAt),
      taskSummary: sub.prompt ?? "Working",
      startedAt: sub.firstSeenAt,
      updatedAt: sub.lastSeenAt,
      source: CLAUDE_CODE_SOURCE_KIND,
      metadata: {
        model: state.model,
        gitBranch: state.gitBranch,
        parentSessionId: state.sessionId,
        progressCount: sub.progressCount,
      },
    });
  }

  return agents;
}

// --- Status inference (conservative, time-window based) ---

function deriveStatus(now: number, updatedAt: number): CanonicalAgentStatus {
  const ageMs = Math.max(0, now - updatedAt);
  if (ageMs <= CLAUDE_CODE_RUNNING_WINDOW_MS) {
    return CANONICAL_AGENT_STATUS.running;
  }
  if (ageMs <= CLAUDE_CODE_IDLE_WINDOW_MS) {
    return CANONICAL_AGENT_STATUS.idle;
  }
  return CANONICAL_AGENT_STATUS.completed;
}

// --- Helpers ---

function deriveAgentId(sessionId: string): string {
  // Use the session filename (without extension) as the ID
  return path.basename(sessionId, ".jsonl") || sessionId;
}

function deriveAgentName(id: string, isSubagent: boolean): string {
  const prefix = isSubagent ? "Subagent" : "Session";
  return `${prefix} ${id.slice(0, 6)}`;
}
