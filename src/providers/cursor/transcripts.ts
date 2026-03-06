import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  CANONICAL_AGENT_KIND,
  CANONICAL_AGENT_STATUS,
  type CanonicalAgentKind,
  type CanonicalAgentSnapshot,
  type CanonicalAgentStatus,
} from "@/core/model";
import { z } from "zod";
import {
  AGENT_COMPLETION_QUIET_WINDOW_MS,
  CURSOR_SOURCE_KIND,
  STREAMING_QUIET_WINDOW_MS,
} from "./constants";

interface CursorTranscriptRecord {
  agentId: string;
  agentName: string;
  kind?: string;
  status: string;
  task: string;
  startedAt?: number;
  updatedAt: number;
}

interface ConversationTranscriptRecord {
  role: string;
  text?: string;
}

type ConversationSignal = "active" | "completed" | "error";

const nonEmptyStringSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1));

const finiteNumberSchema = z.number().refine(Number.isFinite);
const agentStatusSchema = z.nativeEnum(CANONICAL_AGENT_STATUS);
const agentKindSchema = z.nativeEnum(CANONICAL_AGENT_KIND);

const flatTranscriptRecordSchema = z.object({
  agentId: nonEmptyStringSchema,
  agentName: nonEmptyStringSchema,
  kind: nonEmptyStringSchema.optional(),
  status: nonEmptyStringSchema,
  task: nonEmptyStringSchema,
  startedAt: finiteNumberSchema.optional(),
  updatedAt: finiteNumberSchema,
});

const conversationContentEntrySchema = z.object({
  type: z.string(),
  text: z.string().optional(),
});

interface TranscriptParseState {
  latestUserTask: string | undefined;
  sawConversationRecord: boolean;
  latestConversationSignal: ConversationSignal | undefined;
  latestConversationRole: string | undefined;
  sawUserTurn: boolean;
  hasAssistantReplyAfterLatestUser: boolean;
  flatAgents: CanonicalAgentSnapshot[];
}

interface TranscriptFileCache {
  mtimeMs: number;
  sizeBytes: number;
  lineCount: number;
  state: TranscriptParseState;
  fileUpdatedAt: number;
}

const RUNNING_WINDOW_MS = 60_000;
const IDLE_WINDOW_MS = 5 * 60_000;

const conversationLineSchema = z.object({
  role: nonEmptyStringSchema,
  message: z
    .object({
      content: z.array(conversationContentEntrySchema),
    })
    .optional(),
});

export interface TranscriptSourceResult {
  agents: CanonicalAgentSnapshot[];
  connected: boolean;
  sourceLabel: string;
  warnings: string[];
}

export interface CursorTranscriptSourceOptions {
  sourcePaths: string[];
  sourceLabel?: string;
}

export interface CursorTranscriptSource {
  readonly sourceKind: typeof CURSOR_SOURCE_KIND;
  connect(): Promise<void> | void;
  disconnect(): Promise<void> | void;
  readSnapshot(now?: number): Promise<TranscriptSourceResult> | TranscriptSourceResult;
  getWatchPaths?(): string[];
}

export function createCursorTranscriptSource(
  options: CursorTranscriptSourceOptions,
): CursorTranscriptSource {
  const sourcePaths = Array.isArray(options.sourcePaths) ? [...options.sourcePaths] : [];
  const sourceLabel = options.sourceLabel ?? CURSOR_SOURCE_KIND;
  let connected = false;
  const fileCache = new Map<string, TranscriptFileCache>();

  function connect(): void {
    connected = true;
  }

  function disconnect(): void {
    connected = false;
    fileCache.clear();
  }

  async function readSnapshot(now: number = Date.now()): Promise<TranscriptSourceResult> {
    if (!connected) {
      return {
        agents: [],
        connected: false,
        sourceLabel,
        warnings: ["Cursor transcript source is disconnected."],
      };
    }

    if (sourcePaths.length === 0) {
      return {
        agents: [],
        connected: false,
        sourceLabel,
        warnings: ["No transcript paths configured."],
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

      if (cached && cached.mtimeMs === fileUpdatedAt) {
        successfulReads += 1;
        mergeAgents(
          resolveAgentsFromState(cached.state, sourcePath, cached.fileUpdatedAt, now),
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
          resolveAgentsFromState(cached.state, sourcePath, effectiveUpdatedAt, now),
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
        warnings.push(`Failed to read transcript path: ${sourcePath}`);
        continue;
      }

      const lines = contents.split(/\r?\n/);
      let state: TranscriptParseState;
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

      mergeAgents(
        resolveAgentsFromState(state, sourcePath, effectiveUpdatedAt, now),
        orderedIds,
        latestById,
      );
    }

    pruneStaleEntries(fileCache, sourcePaths);

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
    sourceKind: CURSOR_SOURCE_KIND,
    connect,
    disconnect,
    readSnapshot,
    getWatchPaths(): string[] {
      return [...sourcePaths];
    },
  };
}

// --- Parse state management ---

function createInitialParseState(): TranscriptParseState {
  return {
    latestUserTask: undefined,
    sawConversationRecord: false,
    latestConversationSignal: undefined,
    latestConversationRole: undefined,
    sawUserTurn: false,
    hasAssistantReplyAfterLatestUser: false,
    flatAgents: [],
  };
}

function cloneParseState(state: TranscriptParseState): TranscriptParseState {
  return { ...state, flatAgents: [...state.flatAgents] };
}

// --- Incremental line parser ---

function accumulateLines(
  state: TranscriptParseState,
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

    const record = parseFlatRecord(parsed);
    if (!record) {
      accumulateConversationLine(state, parsed, sourcePath, warnings, i);
      continue;
    }

    accumulateFlatRecord(state, record, sourcePath, warnings, i);
  }
}

function accumulateConversationLine(
  state: TranscriptParseState,
  parsed: unknown,
  sourcePath: string,
  warnings: string[],
  lineIndex: number,
): void {
  const conversationRecord = parseConversationRecord(parsed);
  if (!conversationRecord) {
    warnings.push(formatLineWarning(sourcePath, lineIndex + 1, "Unrecognized transcript record."));
    return;
  }

  state.sawConversationRecord = true;
  state.latestConversationRole = conversationRecord.role;

  if (conversationRecord.role === "user" && conversationRecord.text) {
    state.latestUserTask = sanitizeTaskSummary(conversationRecord.text);
    state.latestConversationSignal = "active";
    state.sawUserTurn = true;
    state.hasAssistantReplyAfterLatestUser = false;
  }

  if (conversationRecord.text && isAssistantRole(conversationRecord.role)) {
    if (state.sawUserTurn) {
      state.hasAssistantReplyAfterLatestUser = true;
    }
    const signal = deriveConversationSignal(conversationRecord.text);
    if (signal) {
      state.latestConversationSignal = signal;
    }
  }
}

function accumulateFlatRecord(
  state: TranscriptParseState,
  record: CursorTranscriptRecord,
  sourcePath: string,
  warnings: string[],
  lineIndex: number,
): void {
  const statusResult = agentStatusSchema.safeParse(record.status);
  if (!statusResult.success) {
    warnings.push(formatLineWarning(sourcePath, lineIndex + 1, "Invalid agent status."));
    return;
  }

  const kindResult = parseAgentKind(record.kind);
  if (!kindResult.success) {
    warnings.push(formatLineWarning(sourcePath, lineIndex + 1, "Invalid agent kind."));
    return;
  }

  const snapshot: CanonicalAgentSnapshot = {
    id: record.agentId,
    name: record.agentName,
    kind: kindResult.value,
    isSubagent: isSubagentPath(sourcePath),
    status: statusResult.data,
    taskSummary: record.task,
    updatedAt: record.updatedAt,
    source: CURSOR_SOURCE_KIND,
  };

  if (typeof record.startedAt === "number") {
    snapshot.startedAt = record.startedAt;
  }

  state.flatAgents.push(snapshot);
}

// --- Agent resolution ---

function resolveAgentsFromState(
  state: TranscriptParseState,
  sourcePath: string,
  fileUpdatedAt: number,
  now: number,
): CanonicalAgentSnapshot[] {
  if (state.flatAgents.length > 0 || !state.sawConversationRecord) {
    return state.flatAgents;
  }

  const agentId = deriveAgentId(sourcePath);
  return [
    {
      id: agentId,
      name: deriveAgentName(agentId, sourcePath),
      kind: CANONICAL_AGENT_KIND.local,
      isSubagent: isSubagentPath(sourcePath),
      status: deriveConversationStatus(
        now,
        fileUpdatedAt,
        state.latestConversationSignal,
        state.latestConversationRole,
        state.hasAssistantReplyAfterLatestUser,
      ),
      taskSummary: state.latestUserTask ?? "Working",
      updatedAt: fileUpdatedAt,
      source: CURSOR_SOURCE_KIND,
    },
  ];
}

// --- Merge and cache helpers ---

function mergeAgents(
  agents: CanonicalAgentSnapshot[],
  orderedIds: string[],
  latestById: Map<string, CanonicalAgentSnapshot>,
): void {
  for (const agent of agents) {
    const existing = latestById.get(agent.id);
    if (!existing) {
      latestById.set(agent.id, agent);
      orderedIds.push(agent.id);
    } else if (agent.updatedAt > existing.updatedAt) {
      latestById.set(agent.id, agent);
    }
  }
}

function pruneStaleEntries(
  cache: Map<string, TranscriptFileCache>,
  currentPaths: readonly string[],
): void {
  if (cache.size <= currentPaths.length) {
    return;
  }
  const current = new Set(currentPaths);
  for (const key of cache.keys()) {
    if (!current.has(key)) {
      cache.delete(key);
    }
  }
}

// --- Record parsing ---

function parseFlatRecord(value: unknown): CursorTranscriptRecord | null {
  const parsed = flatTranscriptRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseAgentKind(
  value: string | undefined,
): { success: true; value: CanonicalAgentKind } | { success: false } {
  if (value === undefined) {
    return { success: true, value: CANONICAL_AGENT_KIND.local };
  }
  const parsed = agentKindSchema.safeParse(value);
  return parsed.success ? { success: true, value: parsed.data } : { success: false };
}

function parseConversationRecord(value: unknown): ConversationTranscriptRecord | null {
  const parsed = conversationLineSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const { role } = parsed.data;
  const text = (parsed.data.message?.content ?? [])
    .filter((entry) => entry.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text?.trim() ?? "")
    .filter((part) => part.length > 0)
    .join("\n");
  return text.length > 0 ? { role, text } : { role };
}

// --- Text analysis ---

function sanitizeTaskSummary(value: string): string {
  const match = value.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  const query = match ? match[1] : value;
  return query.replace(/\s+/g, " ").trim();
}

function formatLineWarning(sourcePath: string, lineNumber: number, reason: string): string {
  return `${sourcePath}:${lineNumber} ${reason}`;
}

function hasErrorMarker(value: string): boolean {
  return /(error|failed|exception|traceback)/i.test(value);
}

function deriveConversationStatus(
  now: number,
  updatedAt: number,
  latestSignal: ConversationSignal | undefined,
  latestRole: string | undefined,
  hasAssistantReplyAfterLatestUser: boolean,
): CanonicalAgentStatus {
  if (latestSignal === "error") {
    return CANONICAL_AGENT_STATUS.error;
  }
  if (latestSignal === "completed") {
    return CANONICAL_AGENT_STATUS.completed;
  }

  const ageMs = Math.max(0, now - updatedAt);
  const assistantDone =
    hasAssistantReplyAfterLatestUser &&
    isAssistantRole(latestRole ?? "") &&
    latestSignal !== "active";

  if (assistantDone) {
    if (ageMs <= STREAMING_QUIET_WINDOW_MS) {
      return CANONICAL_AGENT_STATUS.running;
    }
    if (ageMs <= AGENT_COMPLETION_QUIET_WINDOW_MS) {
      return CANONICAL_AGENT_STATUS.idle;
    }
    return CANONICAL_AGENT_STATUS.completed;
  }

  if (ageMs <= RUNNING_WINDOW_MS) {
    return CANONICAL_AGENT_STATUS.running;
  }
  if (latestSignal === "active" && !hasAssistantReplyAfterLatestUser) {
    if (ageMs <= IDLE_WINDOW_MS) {
      return CANONICAL_AGENT_STATUS.idle;
    }
    return CANONICAL_AGENT_STATUS.completed;
  }
  if (ageMs <= IDLE_WINDOW_MS) {
    return CANONICAL_AGENT_STATUS.idle;
  }
  return CANONICAL_AGENT_STATUS.completed;
}

// --- Path helpers ---

function deriveAgentId(sourcePath: string): string {
  const fileName = path.basename(sourcePath, ".jsonl");
  return fileName.length > 0 ? fileName : sourcePath;
}

function deriveAgentName(agentId: string, sourcePath: string): string {
  const prefix = isSubagentPath(sourcePath) ? "Subagent" : "Agent";
  return `${prefix} ${agentId.slice(0, 6)}`;
}

function isSubagentPath(sourcePath: string): boolean {
  return sourcePath.replaceAll("\\", "/").includes("/subagents/");
}

function isAssistantRole(role: string): boolean {
  return role === "assistant";
}

// --- Signal detection ---

function deriveConversationSignal(value: string): ConversationSignal | undefined {
  const normalized = value.toLowerCase();
  if (hasInProgressMarker(normalized)) {
    return "active";
  }
  if (hasErrorMarker(value)) {
    return "error";
  }
  if (hasCompletionMarker(value)) {
    return "completed";
  }
  return undefined;
}

function hasCompletionMarker(value: string): boolean {
  const normalized = value.toLowerCase();
  if (hasInProgressMarker(normalized)) {
    return false;
  }
  const hasNegativeCompletion =
    /\b(not done|not completed|still working|in progress|wip|nu este gata|inca lucrez)\b/.test(
      normalized,
    );
  if (hasNegativeCompletion) {
    return false;
  }
  return /\b(done|complete|completed|implemented|finished|all set|ready to test|ready for testing|gata|terminat|finalizat|cu succes)\b/.test(
    normalized,
  );
}

function hasInProgressMarker(normalizedValue: string): boolean {
  return /\b(running command|executing command|sleep\(|task start|still running)\b/.test(
    normalizedValue,
  );
}
