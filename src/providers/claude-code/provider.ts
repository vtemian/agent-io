import {
  type CanonicalSnapshot,
  type DiscoveryInput,
  type DiscoveryResult,
  PROVIDER_KINDS,
  type TranscriptProvider,
  type TranscriptReadResult,
} from "@/core";
import { arraysEqual, normalizeFromPayload } from "@/providers/shared/providers";
import { CLAUDE_CODE_SOURCE_KIND } from "./constants";
import {
  listSessionFileNames,
  resolveSessionDirectories,
  resolveSessionSourcePaths,
} from "./discovery";
import { type ClaudeCodeTranscriptSource, createClaudeCodeTranscriptSource } from "./transcripts";
import { type ClaudeCodeWatchOptions, createClaudeCodeWatch } from "./watch";

export interface ClaudeCodeOptions {
  claudeHomePath?: string;
  sourceLabel?: string;
  watch?: ClaudeCodeWatchOptions | false;
  maxFiles?: number;
}

interface ProviderState {
  source: ClaudeCodeTranscriptSource | undefined;
  sourcePathKey: string;
  connected: boolean;
  cachedDiscovery: DiscoveryResult | undefined;
  cachedFileList: string[] | undefined;
  cachedWorkspacePaths: string[] | undefined;
}

interface DiscoveryOptions {
  claudeHomePath: string | undefined;
  maxFiles: number | undefined;
}

export function claudeCode(options: ClaudeCodeOptions = {}): TranscriptProvider {
  const sourceLabel = options.sourceLabel ?? CLAUDE_CODE_SOURCE_KIND;
  const discoveryOptions: DiscoveryOptions = {
    claudeHomePath: options.claudeHomePath,
    maxFiles: options.maxFiles,
  };
  const watch = options.watch === false ? undefined : createClaudeCodeWatch(options.watch);
  const state: ProviderState = {
    source: undefined,
    sourcePathKey: "",
    connected: false,
    cachedDiscovery: undefined,
    cachedFileList: undefined,
    cachedWorkspacePaths: undefined,
  };

  return {
    id: PROVIDER_KINDS.claudeCode,
    discover: (workspacePaths: string[]) =>
      performDiscover(state, discoveryOptions, workspacePaths),
    connect(): void {
      state.connected = true;
      state.source?.connect();
    },
    disconnect(): void {
      state.connected = false;
      state.source?.disconnect();
      state.cachedDiscovery = undefined;
      state.cachedFileList = undefined;
      state.cachedWorkspacePaths = undefined;
    },
    read: (inputs: DiscoveryInput[], now: number = Date.now()) =>
      performRead(state, sourceLabel, inputs, now),
    normalize: (readResult: TranscriptReadResult, _now: number): CanonicalSnapshot =>
      normalizeFromPayload(readResult),
    watch,
  };
}

function performDiscover(
  state: ProviderState,
  opts: DiscoveryOptions,
  workspacePaths: string[],
): DiscoveryResult {
  const sessionOpts = {
    workspacePaths,
    claudeHomePath: opts.claudeHomePath,
    maxFiles: opts.maxFiles,
  };
  const currentFileList = listSessionFileNames(sessionOpts);
  if (
    state.cachedDiscovery &&
    state.cachedFileList &&
    state.cachedWorkspacePaths &&
    arraysEqual(currentFileList, state.cachedFileList) &&
    arraysEqual(workspacePaths, state.cachedWorkspacePaths)
  ) {
    return state.cachedDiscovery;
  }

  const watchPaths = resolveSessionDirectories(sessionOpts);
  const sourcePaths = resolveSessionSourcePaths(sessionOpts);
  const inputs: DiscoveryInput[] = sourcePaths.map((sourcePath) => ({
    uri: sourcePath,
    kind: "file",
    metadata: { providerId: PROVIDER_KINDS.claudeCode },
  }));
  state.cachedDiscovery = { inputs, watchPaths, warnings: [] };
  state.cachedFileList = currentFileList;
  state.cachedWorkspacePaths = [...workspacePaths];
  return state.cachedDiscovery;
}

async function performRead(
  state: ProviderState,
  sourceLabel: string,
  inputs: DiscoveryInput[],
  now: number,
): Promise<TranscriptReadResult> {
  const sourcePaths = inputs.map((input) => input.uri);
  const nextSourcePathKey = sourcePaths.join("\n");
  state.source = ensureSource(
    state.source,
    sourcePaths,
    sourceLabel,
    state.sourcePathKey,
    nextSourcePathKey,
  );
  state.sourcePathKey = nextSourcePathKey;
  if (state.connected) {
    state.source.connect();
  }
  const snapshot = await state.source.readSnapshot(now);
  return buildReadResult(snapshot, now);
}

function buildReadResult(
  snapshot: { connected: boolean; sourceLabel: string; warnings: string[] },
  now: number,
): TranscriptReadResult {
  return {
    records: [
      {
        provider: PROVIDER_KINDS.claudeCode,
        inputUri: "claude-code://sessions",
        observedAt: now,
        payload: snapshot,
      },
    ],
    health: {
      connected: snapshot.connected,
      sourceLabel: snapshot.sourceLabel,
      warnings: snapshot.warnings,
    },
  };
}

function ensureSource(
  existing: ClaudeCodeTranscriptSource | undefined,
  sourcePaths: string[],
  sourceLabel: string,
  previousKey: string,
  nextKey: string,
): ClaudeCodeTranscriptSource {
  if (existing && nextKey === previousKey) {
    return existing;
  }
  return createClaudeCodeTranscriptSource({ sourcePaths, sourceLabel });
}
