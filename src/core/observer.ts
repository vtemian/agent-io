import {
  CANONICAL_AGENT_STATUS,
  type CanonicalAgentSnapshot,
  type CanonicalAgentStatus,
} from "./model";
import type {
  CanonicalSnapshot,
  DiscoveryResult,
  TranscriptProvider,
  TranscriptReadResult,
} from "./providers";
import { createWatchRuntime } from "./runtime/index";
import { emitToListeners } from "./runtime/shared";
import type { WatchHealth, WatchLifecycleEvent, WatchRuntime } from "./types";
import { WATCH_LIFECYCLE_KIND, WATCH_RUNTIME_EVENT_TYPES, type WatchSource } from "./types";

export interface ObserverSnapshot {
  at: number;
  agents: CanonicalAgentSnapshot[];
  health: WatchHealth;
}

export interface ObserverChangeEvent {
  change: WatchLifecycleEvent<CanonicalAgentStatus>;
  agent: CanonicalAgentSnapshot;
  snapshot: ObserverSnapshot;
}

export interface ObserverOptions {
  provider: TranscriptProvider;
  workspacePaths: string[];
  debounceMs?: number;
  checkIdleDelayMs?: number | false;
  now?: () => number;
}

export interface Observer {
  start(): Promise<void>;
  stop(): Promise<void>;
  refreshNow(): Promise<ObserverSnapshot>;
  subscribe(listener: (event: ObserverChangeEvent) => void): () => void;
}

interface ObserverState {
  latestSnapshot: ObserverSnapshot | undefined;
  previousSnapshot: ObserverSnapshot | undefined;
  discovery: DiscoveryResult | undefined;
  startedAt: number;
}

function buildSource(
  options: ObserverOptions,
  state: ObserverState,
  now: () => number,
): WatchSource<CanonicalAgentSnapshot> {
  return {
    connect: async () => {
      state.startedAt = now();
      state.discovery = await options.provider.discover(options.workspacePaths);
      await options.provider.connect?.();
    },
    disconnect: () => options.provider.disconnect?.(),
    readSnapshot: async (at?: number) => {
      const observedAt = at ?? now();
      const resolved = await options.provider.discover(options.workspacePaths);
      state.discovery = resolved;
      const readResult = await options.provider.read(resolved.inputs, observedAt);
      const normalized = await options.provider.normalize(readResult, observedAt);
      return mergeSnapshotWarnings(normalized, readResult, resolved);
    },
    getWatchPaths: () => state.discovery?.watchPaths ?? [],
  };
}

function handleSnapshotEvent(
  state: ObserverState,
  event: {
    at: number;
    snapshot: { agents: CanonicalAgentSnapshot[]; health: WatchHealth };
  },
): void {
  state.previousSnapshot = state.latestSnapshot;
  state.latestSnapshot = {
    at: event.at,
    agents: event.snapshot.agents,
    health: event.snapshot.health,
  };
}

function handleLifecycleEvents(
  state: ObserverState,
  events: WatchLifecycleEvent<CanonicalAgentStatus>[],
  listeners: Set<(event: ObserverChangeEvent) => void>,
): void {
  if (!state.latestSnapshot) {
    return;
  }
  const currentById = indexAgentsById(state.latestSnapshot.agents);
  const previousById = indexAgentsById(state.previousSnapshot?.agents ?? []);
  for (const change of events) {
    const agent = resolveAgentForChange(change, currentById, previousById, state.startedAt);
    if (agent) {
      emitToListeners(listeners, { change, agent, snapshot: state.latestSnapshot });
    }
  }
}

function resetState(state: ObserverState): void {
  state.latestSnapshot = undefined;
  state.previousSnapshot = undefined;
  state.discovery = undefined;
  state.startedAt = 0;
}

function cleanWorkspacePaths(paths: string[]): string[] {
  return paths.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function initRuntime(
  options: ObserverOptions,
  source: WatchSource<CanonicalAgentSnapshot>,
  now: () => number,
): WatchRuntime<CanonicalAgentSnapshot, CanonicalAgentStatus> {
  const providerWatch = options.provider.watch;

  return createWatchRuntime<CanonicalAgentSnapshot, CanonicalAgentStatus>({
    source,
    lifecycle: {
      getId: (agent) => agent.id,
      getStatus: (agent) => agent.status,
    },
    debounceMs: options.debounceMs ?? providerWatch?.debounceMs,
    checkIdleDelayMs: options.checkIdleDelayMs,
    now,
    subscribeToChanges: providerWatch
      ? (watchPath, onEvent, onError) => providerWatch.subscribe(watchPath, onEvent, onError)
      : undefined,
  });
}

function wireRuntimeEvents(
  runtime: WatchRuntime<CanonicalAgentSnapshot, CanonicalAgentStatus>,
  state: ObserverState,
  listeners: Set<(event: ObserverChangeEvent) => void>,
): void {
  runtime.subscribe((event) => {
    if (event.type === WATCH_RUNTIME_EVENT_TYPES.snapshot) {
      handleSnapshotEvent(state, event);
      return;
    }

    if (event.type === WATCH_RUNTIME_EVENT_TYPES.lifecycle) {
      handleLifecycleEvents(state, event.events, listeners);
      return;
    }
  });
}

export function createObserver(options: ObserverOptions): Observer {
  const now = options.now ?? (() => Date.now());
  const listeners = new Set<(event: ObserverChangeEvent) => void>();
  const resolvedOptions = {
    ...options,
    workspacePaths: cleanWorkspacePaths(options.workspacePaths),
  };

  const state: ObserverState = {
    latestSnapshot: undefined,
    previousSnapshot: undefined,
    discovery: undefined,
    startedAt: 0,
  };

  const source = buildSource(resolvedOptions, state, now);
  const runtime = initRuntime(options, source, now);
  wireRuntimeEvents(runtime, state, listeners);

  return {
    start: () => runtime.start(),
    stop: async () => {
      await runtime.stop();
      listeners.clear();
      resetState(state);
    },
    refreshNow: async () => {
      const snapshot = await runtime.refreshNow();
      const at = state.latestSnapshot?.at ?? now();
      return { at, agents: snapshot.agents, health: snapshot.health };
    },
    subscribe(listener: (event: ObserverChangeEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function mergeSnapshotWarnings(
  normalized: CanonicalSnapshot,
  readResult: TranscriptReadResult,
  discovery: DiscoveryResult,
): CanonicalSnapshot {
  const warnings = [
    ...discovery.warnings,
    ...readResult.health.warnings,
    ...normalized.health.warnings,
  ];
  return {
    agents: normalized.agents,
    health: {
      connected: normalized.health.connected,
      sourceLabel: normalized.health.sourceLabel,
      warnings: warnings.length > 0 ? [...new Set(warnings)] : [],
    },
  };
}

function indexAgentsById(agents: CanonicalAgentSnapshot[]): Map<string, CanonicalAgentSnapshot> {
  return new Map(agents.map((agent) => [agent.id, agent]));
}

function isStaleJoinEvent(
  change: WatchLifecycleEvent<CanonicalAgentStatus>,
  agent: CanonicalAgentSnapshot,
  observerStartedAt: number,
): boolean {
  // Only filter agents that were already completed/errored before the
  // observer started. Sessions that completed after startup are genuine
  // new events — even if they finished before the next poll.
  return (
    change.kind === WATCH_LIFECYCLE_KIND.joined &&
    (agent.status === CANONICAL_AGENT_STATUS.completed ||
      agent.status === CANONICAL_AGENT_STATUS.error) &&
    agent.updatedAt < observerStartedAt
  );
}

function resolveAgentForChange(
  change: WatchLifecycleEvent<CanonicalAgentStatus>,
  currentById: Map<string, CanonicalAgentSnapshot>,
  previousById: Map<string, CanonicalAgentSnapshot>,
  observerStartedAt: number,
): CanonicalAgentSnapshot | undefined {
  if (change.kind === WATCH_LIFECYCLE_KIND.heartbeat) {
    return undefined;
  }
  const agent = currentById.get(change.agentId) ?? previousById.get(change.agentId);
  if (!agent || isStaleJoinEvent(change, agent, observerStartedAt)) {
    return undefined;
  }
  return agent;
}
