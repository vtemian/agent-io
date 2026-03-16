import { toError } from "@/core/errors";
import { createLifecycleMapper } from "@/core/lifecycle";
import type {
  WatchRuntime,
  WatchRuntimeEvent,
  WatchRuntimeOptions,
  WatchSnapshot,
  WatchSource,
} from "@/core/types";
import { WATCH_LIFECYCLE_KIND, WATCH_RUNTIME_EVENT_TYPES } from "@/core/types";
import type { EventBus } from "./event-bus";
import { createEventBus, RUNTIME_BUS_EVENT_TYPES } from "./event-bus";
import {
  createNotRunningError,
  createStoppedError,
  DEFAULT_CHECK_IDLE_DELAY_MS,
  DEFAULT_DEBOUNCE_MS,
  disconnectQuietly,
  emitToListeners,
  type RuntimeState,
  type RuntimeStatus,
  rejectWaiters,
  resolveWaiters,
  WATCH_RUNTIME_INTERNAL_STATES,
} from "./shared";
import { createRuntimeSubscriptions } from "./subscriptions";

type RuntimeBusEvent =
  | { type: typeof RUNTIME_BUS_EVENT_TYPES.fileChanged }
  | { type: typeof RUNTIME_BUS_EVENT_TYPES.checkIdle }
  | { type: typeof RUNTIME_BUS_EVENT_TYPES.refreshRequested };

type RuntimeSubs = ReturnType<typeof createRuntimeSubscriptions>;

interface Ref<T> {
  current: T;
}

interface RuntimeContext<TAgent, TStatus extends string> {
  readonly source: WatchSource<TAgent>;
  readonly lifecycle: ReturnType<typeof createLifecycleMapper<TAgent, TStatus>>;
  readonly listeners: Set<(event: WatchRuntimeEvent<TAgent, TStatus>) => void>;
  readonly now: () => number;
  readonly checkIdleDelayMs: number;
  readonly runtimeState: RuntimeState<TAgent>;
  readonly busRef: Ref<EventBus<RuntimeBusEvent> | null>;
  readonly subsRef: Ref<RuntimeSubs | null>;
  idleTimer: ReturnType<typeof globalThis.setTimeout> | null;
}

function getBus<TAgent, TStatus extends string>(
  ctx: RuntimeContext<TAgent, TStatus>,
): EventBus<RuntimeBusEvent> {
  const bus = ctx.busRef.current;
  if (bus === null) {
    throw new Error("Runtime bus not initialized");
  }
  return bus;
}

function getSubs<TAgent, TStatus extends string>(
  ctx: RuntimeContext<TAgent, TStatus>,
): RuntimeSubs {
  const subs = ctx.subsRef.current;
  if (subs === null) {
    throw new Error("Runtime subscriptions not initialized");
  }
  return subs;
}

interface RuntimeStatusView {
  state: RuntimeStatus;
  desiredRunning: boolean;
  lifecycleToken: number;
}

function isState(rs: RuntimeStatusView, value: RuntimeStatus): boolean {
  return rs.state === value;
}

function isStarted(rs: RuntimeStatusView): boolean {
  return isState(rs, WATCH_RUNTIME_INTERNAL_STATES.started);
}

function isStopped(rs: RuntimeStatusView): boolean {
  return isState(rs, WATCH_RUNTIME_INTERNAL_STATES.stopped);
}

function isStarting(rs: RuntimeStatusView): boolean {
  return isState(rs, WATCH_RUNTIME_INTERNAL_STATES.starting);
}

function isStopping(rs: RuntimeStatusView): boolean {
  return isState(rs, WATCH_RUNTIME_INTERNAL_STATES.stopping);
}

function isTokenCurrent(rs: RuntimeStatusView, token: number): boolean {
  return token === rs.lifecycleToken;
}

function isStartedWithToken(rs: RuntimeStatusView, token: number): boolean {
  return isStarted(rs) && isTokenCurrent(rs, token);
}

function canSubscribeWithToken(rs: RuntimeStatusView, token: number): boolean {
  return (isStarted(rs) || isStarting(rs)) && isTokenCurrent(rs, token);
}

function nextLifecycleToken(rs: RuntimeStatusView): number {
  rs.lifecycleToken += 1;
  return rs.lifecycleToken;
}

function emit<TAgent, TStatus extends string>(
  ctx: RuntimeContext<TAgent, TStatus>,
  event: WatchRuntimeEvent<TAgent, TStatus>,
): void {
  emitToListeners(ctx.listeners, event);
}

function emitStateEvent<TAgent, TStatus extends string>(
  ctx: RuntimeContext<TAgent, TStatus>,
  state: "started" | "stopped",
): void {
  emit(ctx, { type: WATCH_RUNTIME_EVENT_TYPES.state, at: ctx.now(), state });
}

function emitRuntimeError<TAgent, TStatus extends string>(
  ctx: RuntimeContext<TAgent, TStatus>,
  error: Error,
): void {
  emit(ctx, { type: WATCH_RUNTIME_EVENT_TYPES.error, at: ctx.now(), error });
}

function clearIdleTimer<TAgent, TStatus extends string>(
  ctx: RuntimeContext<TAgent, TStatus>,
): void {
  if (ctx.idleTimer !== null) {
    globalThis.clearTimeout(ctx.idleTimer);
    ctx.idleTimer = null;
  }
}

function scheduleCheckIdle<TAgent, TStatus extends string>(
  ctx: RuntimeContext<TAgent, TStatus>,
): void {
  if (ctx.checkIdleDelayMs <= 0 || !isStarted(ctx.runtimeState)) {
    return;
  }
  clearIdleTimer(ctx);
  ctx.idleTimer = globalThis.setTimeout(() => {
    ctx.idleTimer = null;
    getBus(ctx).dispatch(
      { type: RUNTIME_BUS_EVENT_TYPES.checkIdle },
      ctx.runtimeState.lifecycleToken,
    );
  }, ctx.checkIdleDelayMs);
}

async function readAndEmit<TAgent, TStatus extends string>(
  ctx: RuntimeContext<TAgent, TStatus>,
): Promise<{ snapshot: WatchSnapshot<TAgent>; hasStatusChanges: boolean }> {
  const at = ctx.now();
  const snapshot = await ctx.source.readSnapshot(at);
  if (!isStarted(ctx.runtimeState)) {
    throw createStoppedError();
  }
  const lifecycleEvents = ctx.lifecycle.map(snapshot.agents, at);
  const hasStatusChanges = lifecycleEvents.some(
    (e) =>
      e.kind === WATCH_LIFECYCLE_KIND.statusChanged ||
      e.kind === WATCH_LIFECYCLE_KIND.joined ||
      e.kind === WATCH_LIFECYCLE_KIND.left,
  );
  if (hasStatusChanges) {
    emit(ctx, { type: WATCH_RUNTIME_EVENT_TYPES.snapshot, at, snapshot });
    emit(ctx, { type: WATCH_RUNTIME_EVENT_TYPES.lifecycle, at, events: lifecycleEvents });
  }
  return { snapshot, hasStatusChanges };
}

function rejectAllQueuedWaiters<TAgent>(rs: RuntimeState<TAgent>, error: unknown): void {
  const waiters = rs.queuedWaiters;
  rs.queuedWaiters = [];
  rejectWaiters(waiters, error);
}

function rejectActiveCycleWaiters<TAgent>(rs: RuntimeState<TAgent>, error: unknown): void {
  const waiters = rs.activeCycleWaiters;
  rs.activeCycleWaiters = [];
  rejectWaiters(waiters, error);
}

function handleAbortedStart(
  rs: RuntimeStatusView,
  source: { disconnect?(): Promise<void> | void },
  token: number,
): Promise<void> | undefined {
  const superseded = !isTokenCurrent(rs, token);
  const aborted = !isStarting(rs) || !rs.desiredRunning;
  if (!superseded && !aborted) {
    return undefined;
  }
  if (!superseded) {
    rs.state = WATCH_RUNTIME_INTERNAL_STATES.stopped;
  }
  return disconnectQuietly(source);
}

async function runStartOperation<TAgent, TStatus extends string>(
  ctx: RuntimeContext<TAgent, TStatus>,
  token: number,
): Promise<void> {
  try {
    await ctx.source.connect?.();

    const abortCleanup = handleAbortedStart(ctx.runtimeState, ctx.source, token);
    if (abortCleanup !== undefined) {
      await abortCleanup;
      return;
    }

    getSubs(ctx).initializeSubscriptions(token);
    ctx.runtimeState.state = WATCH_RUNTIME_INTERNAL_STATES.started;
    emitStateEvent(ctx, WATCH_RUNTIME_INTERNAL_STATES.started);
    getBus(ctx).dispatch({ type: RUNTIME_BUS_EVENT_TYPES.fileChanged }, token);
  } catch (error) {
    if (isTokenCurrent(ctx.runtimeState, token)) {
      ctx.runtimeState.state = WATCH_RUNTIME_INTERNAL_STATES.stopped;
      getSubs(ctx).clearDebounceTimer();
      getSubs(ctx).closeSubscriptions();
      ctx.lifecycle.reset();
      rejectAllQueuedWaiters(ctx.runtimeState, error);
    }
    await disconnectQuietly(ctx.source);
    throw error;
  }
}

async function runStopOperation<TAgent, TStatus extends string>(
  ctx: RuntimeContext<TAgent, TStatus>,
  token: number,
): Promise<void> {
  try {
    await ctx.source.disconnect?.();
  } finally {
    if (isTokenCurrent(ctx.runtimeState, token)) {
      ctx.runtimeState.state = WATCH_RUNTIME_INTERNAL_STATES.stopped;
      emitStateEvent(ctx, WATCH_RUNTIME_INTERNAL_STATES.stopped);
    }
  }
}

async function runtimeStart<TAgent, TStatus extends string>(
  ctx: RuntimeContext<TAgent, TStatus>,
): Promise<void> {
  ctx.runtimeState.desiredRunning = true;
  if (isStarted(ctx.runtimeState)) {
    return;
  }
  if (isStarting(ctx.runtimeState) && ctx.runtimeState.startPromise) {
    return ctx.runtimeState.startPromise;
  }
  if (isStopping(ctx.runtimeState) && ctx.runtimeState.stopPromise) {
    await ctx.runtimeState.stopPromise;
  }

  ctx.runtimeState.state = WATCH_RUNTIME_INTERNAL_STATES.starting;
  const token = nextLifecycleToken(ctx.runtimeState);
  const operation = runStartOperation(ctx, token);
  ctx.runtimeState.startPromise = operation;
  try {
    await operation;
  } finally {
    if (ctx.runtimeState.startPromise === operation) {
      ctx.runtimeState.startPromise = null;
    }
  }
}

async function runtimeStop<TAgent, TStatus extends string>(
  ctx: RuntimeContext<TAgent, TStatus>,
): Promise<void> {
  ctx.runtimeState.desiredRunning = false;
  if (isStopped(ctx.runtimeState)) {
    return;
  }
  if (isStopping(ctx.runtimeState) && ctx.runtimeState.stopPromise) {
    return ctx.runtimeState.stopPromise;
  }
  if (isStarting(ctx.runtimeState) && ctx.runtimeState.startPromise) {
    try {
      await ctx.runtimeState.startPromise;
    } catch {
      // Continue stopping after failed start.
    }
  }

  ctx.runtimeState.state = WATCH_RUNTIME_INTERNAL_STATES.stopping;
  const token = nextLifecycleToken(ctx.runtimeState);
  getSubs(ctx).dispose();
  clearIdleTimer(ctx);
  getBus(ctx).clear();
  ctx.lifecycle.reset();

  const stoppedError = createStoppedError();
  rejectAllQueuedWaiters(ctx.runtimeState, stoppedError);
  rejectActiveCycleWaiters(ctx.runtimeState, stoppedError);

  const operation = runStopOperation(ctx, token);
  ctx.runtimeState.stopPromise = operation;
  try {
    await operation;
  } finally {
    if (ctx.runtimeState.stopPromise === operation) {
      ctx.runtimeState.stopPromise = null;
    }
  }
}

function runtimeRefreshNow<TAgent, TStatus extends string>(
  ctx: RuntimeContext<TAgent, TStatus>,
): Promise<WatchSnapshot<TAgent>> {
  if (!isStarted(ctx.runtimeState)) {
    return Promise.reject(createNotRunningError());
  }
  return new Promise<WatchSnapshot<TAgent>>((resolve, reject) => {
    ctx.runtimeState.queuedWaiters.push({ resolve, reject });
    getBus(ctx).dispatch(
      { type: RUNTIME_BUS_EVENT_TYPES.refreshRequested },
      ctx.runtimeState.lifecycleToken,
    );
  });
}

async function handleFileChanged<TAgent, TStatus extends string>(
  ctx: RuntimeContext<TAgent, TStatus>,
): Promise<void> {
  if (!isStarted(ctx.runtimeState)) {
    return;
  }
  try {
    await readAndEmit(ctx);
    scheduleCheckIdle(ctx);
  } catch (error) {
    if (!isStarted(ctx.runtimeState)) {
      return;
    }
    emitRuntimeError(ctx, toError(error));
  }
}

async function handleCheckIdle<TAgent, TStatus extends string>(
  ctx: RuntimeContext<TAgent, TStatus>,
): Promise<void> {
  if (!isStarted(ctx.runtimeState)) {
    return;
  }
  try {
    const { snapshot } = await readAndEmit(ctx);
    if (snapshot.agents.length > 0) {
      scheduleCheckIdle(ctx);
    }
  } catch (error) {
    if (!isStarted(ctx.runtimeState)) {
      return;
    }
    emitRuntimeError(ctx, toError(error));
  }
}

async function handleRefreshRequested<TAgent, TStatus extends string>(
  ctx: RuntimeContext<TAgent, TStatus>,
): Promise<void> {
  const waiters = ctx.runtimeState.queuedWaiters;
  ctx.runtimeState.queuedWaiters = [];
  if (waiters.length === 0 || !isStarted(ctx.runtimeState)) {
    rejectWaiters(waiters, createStoppedError());
    return;
  }
  ctx.runtimeState.activeCycleWaiters = waiters;
  try {
    const { snapshot } = await readAndEmit(ctx);
    resolveWaiters(waiters, snapshot);
    scheduleCheckIdle(ctx);
  } catch (error) {
    if (!isStarted(ctx.runtimeState)) {
      rejectWaiters(waiters, createStoppedError());
      return;
    }
    emitRuntimeError(ctx, toError(error));
    rejectWaiters(waiters, error);
  } finally {
    ctx.runtimeState.activeCycleWaiters = [];
  }
}

function buildBusHandlers<TAgent, TStatus extends string>(
  ctx: RuntimeContext<TAgent, TStatus>,
): Record<string, (event: RuntimeBusEvent) => Promise<void>> {
  return {
    [RUNTIME_BUS_EVENT_TYPES.fileChanged]: () => handleFileChanged(ctx),
    [RUNTIME_BUS_EVENT_TYPES.checkIdle]: () => handleCheckIdle(ctx),
    [RUNTIME_BUS_EVENT_TYPES.refreshRequested]: () => handleRefreshRequested(ctx),
  };
}

function initializeRuntimeContext<TAgent, TStatus extends string>(
  options: WatchRuntimeOptions<TAgent, TStatus>,
): RuntimeContext<TAgent, TStatus> {
  const checkIdleDelayMs =
    options.checkIdleDelayMs === false
      ? 0
      : (options.checkIdleDelayMs ?? DEFAULT_CHECK_IDLE_DELAY_MS);

  return {
    source: options.source,
    lifecycle: createLifecycleMapper(options.lifecycle),
    listeners: new Set(),
    now: options.now ?? (() => Date.now()),
    checkIdleDelayMs,
    idleTimer: null,
    runtimeState: {
      state: WATCH_RUNTIME_INTERNAL_STATES.stopped,
      desiredRunning: false,
      lifecycleToken: 0,
      queuedWaiters: [],
      activeCycleWaiters: [],
      startPromise: null,
      stopPromise: null,
    },
    busRef: { current: null },
    subsRef: { current: null },
  };
}

function wireDeps<TAgent, TStatus extends string>(
  ctx: RuntimeContext<TAgent, TStatus>,
  options: WatchRuntimeOptions<TAgent, TStatus>,
): void {
  ctx.busRef.current = createEventBus<RuntimeBusEvent>({
    getToken: () => ctx.runtimeState.lifecycleToken,
    onHandlerError: (error) => emitRuntimeError(ctx, error),
    handlers: buildBusHandlers(ctx),
  });

  ctx.subsRef.current = createRuntimeSubscriptions({
    watchPaths: options.watchPaths,
    getWatchPaths: () => options.source.getWatchPaths?.() ?? [],
    subscribeToChanges: options.subscribeToChanges,
    debounceMs: Math.max(0, options.debounceMs ?? DEFAULT_DEBOUNCE_MS),
    onFileChanged: () => {
      getBus(ctx).dispatch(
        { type: RUNTIME_BUS_EVENT_TYPES.fileChanged },
        ctx.runtimeState.lifecycleToken,
      );
    },
    isStartedWithToken: (token) => isStartedWithToken(ctx.runtimeState, token),
    canSubscribeWithToken: (token) => canSubscribeWithToken(ctx.runtimeState, token),
    emitError: (error) => emitRuntimeError(ctx, error),
  });
}

export function createWatchRuntime<TAgent, TStatus extends string = string>(
  options: WatchRuntimeOptions<TAgent, TStatus>,
): WatchRuntime<TAgent, TStatus> {
  const ctx = initializeRuntimeContext(options);
  wireDeps(ctx, options);

  return {
    start: () => runtimeStart(ctx),
    stop: () => runtimeStop(ctx),
    refreshNow: () => runtimeRefreshNow(ctx),
    subscribe(listener: (event: WatchRuntimeEvent<TAgent, TStatus>) => void): () => void {
      ctx.listeners.add(listener);
      return () => {
        ctx.listeners.delete(listener);
      };
    },
  };
}
