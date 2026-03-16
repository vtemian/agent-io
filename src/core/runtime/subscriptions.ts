import { toError } from "@/core/errors";
import { WATCH_RESUBSCRIBE_BASE_DELAY_MS, WATCH_RESUBSCRIBE_MAX_DELAY_MS } from "./shared";

interface Subscription {
  close(): void;
}

type SubscribeToChanges = (
  watchPath: string,
  onEvent: () => void,
  onError: (error: Error) => void,
) => Subscription;

interface RuntimeSubscriptionsOptions {
  watchPaths?: string[];
  getWatchPaths?: () => string[];
  subscribeToChanges?: SubscribeToChanges;
  debounceMs: number;
  onFileChanged: () => void;
  isStartedWithToken: (token: number) => boolean;
  canSubscribeWithToken: (token: number) => boolean;
  emitError: (error: Error) => void;
}

interface ChangeSubscription {
  watchPath: string;
  close(): void;
}

interface SubscriptionState {
  readonly subscriptions: ChangeSubscription[];
  readonly pendingTimers: Map<string, ReturnType<typeof globalThis.setTimeout>>;
  readonly resubscribeAttempts: Map<string, number>;
  debounceTimer: ReturnType<typeof globalThis.setTimeout> | null;
}

function resolveWatchPaths(options: RuntimeSubscriptionsOptions): string[] {
  return options.watchPaths?.length ? options.watchPaths : (options.getWatchPaths?.() ?? []);
}

function normalizeWatchPaths(watchPaths: readonly string[]): string[] {
  return [
    ...new Set(
      watchPaths.map((watchPath) => watchPath.trim()).filter((watchPath) => watchPath.length > 0),
    ),
  ];
}

function clearDebounceTimer(state: SubscriptionState): void {
  if (!state.debounceTimer) {
    return;
  }
  globalThis.clearTimeout(state.debounceTimer);
  state.debounceTimer = null;
}

function closeSubscriptions(state: SubscriptionState, emitError: (error: Error) => void): void {
  const activeSubscriptions = state.subscriptions.splice(0, state.subscriptions.length);
  for (const subscription of activeSubscriptions) {
    try {
      subscription.close();
    } catch (error) {
      emitError(toError(error));
    }
  }
}

function clearResubscribeTimers(state: SubscriptionState): void {
  for (const timer of state.pendingTimers.values()) {
    globalThis.clearTimeout(timer);
  }
  state.pendingTimers.clear();
  state.resubscribeAttempts.clear();
}

function clearResubscribeStateForPath(state: SubscriptionState, watchPath: string): void {
  const timer = state.pendingTimers.get(watchPath);
  if (timer !== undefined) {
    globalThis.clearTimeout(timer);
    state.pendingTimers.delete(watchPath);
  }
  state.resubscribeAttempts.delete(watchPath);
}

function onWatchedEvent(
  state: SubscriptionState,
  options: RuntimeSubscriptionsOptions,
  token: number,
): void {
  if (!options.isStartedWithToken(token)) {
    return;
  }

  if (state.debounceTimer) {
    globalThis.clearTimeout(state.debounceTimer);
  }
  state.debounceTimer = globalThis.setTimeout(() => {
    state.debounceTimer = null;
    options.onFileChanged();
  }, options.debounceMs);
}

function unsubscribeByWatchPath(state: SubscriptionState, watchPath: string): void {
  for (let index = state.subscriptions.length - 1; index >= 0; index -= 1) {
    if (state.subscriptions[index]?.watchPath !== watchPath) {
      continue;
    }
    const [subscription] = state.subscriptions.splice(index, 1);
    try {
      subscription?.close();
    } catch {
      // Subscription close can throw if the underlying watcher was already destroyed.
      // During cleanup we only care that we tried — surfacing this error would mask
      // the real issue that triggered the cleanup.
    }
  }
}

function scheduleResubscribe(
  state: SubscriptionState,
  options: RuntimeSubscriptionsOptions,
  watchPath: string,
  token: number,
): void {
  if (!options.subscribeToChanges || !options.isStartedWithToken(token)) {
    return;
  }

  if (state.pendingTimers.has(watchPath)) {
    return;
  }

  const attempts = (state.resubscribeAttempts.get(watchPath) ?? 0) + 1;
  state.resubscribeAttempts.set(watchPath, attempts);
  const delayMs = Math.min(
    WATCH_RESUBSCRIBE_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1),
    WATCH_RESUBSCRIBE_MAX_DELAY_MS,
  );
  const timer = globalThis.setTimeout(() => {
    state.pendingTimers.delete(watchPath);
    if (!options.isStartedWithToken(token)) {
      return;
    }
    resubscribeWatchPath(state, options, watchPath, token);
  }, delayMs);
  state.pendingTimers.set(watchPath, timer);
}

function trySubscribeWatchPath(
  state: SubscriptionState,
  options: RuntimeSubscriptionsOptions,
  watchPath: string,
  token: number,
): void {
  if (!options.subscribeToChanges || !options.canSubscribeWithToken(token)) {
    return;
  }
  try {
    const subscription = options.subscribeToChanges(
      watchPath,
      () => onWatchedEvent(state, options, token),
      (error) => onWatchedError(state, options, watchPath, error, token),
    );
    state.subscriptions.push({ watchPath, close: () => subscription.close() });
    clearResubscribeStateForPath(state, watchPath);
  } catch (error) {
    options.emitError(toError(error));
    scheduleResubscribe(state, options, watchPath, token);
  }
}

function resubscribeWatchPath(
  state: SubscriptionState,
  options: RuntimeSubscriptionsOptions,
  watchPath: string,
  token: number,
): void {
  if (!options.subscribeToChanges || !options.isStartedWithToken(token)) {
    return;
  }
  unsubscribeByWatchPath(state, watchPath);
  trySubscribeWatchPath(state, options, watchPath, token);
}

function onWatchedError(
  state: SubscriptionState,
  options: RuntimeSubscriptionsOptions,
  watchPath: string,
  error: Error,
  token: number,
): void {
  if (!options.isStartedWithToken(token)) {
    return;
  }
  options.emitError(error);
  resubscribeWatchPath(state, options, watchPath, token);
}

export function createRuntimeSubscriptions(options: RuntimeSubscriptionsOptions): {
  initializeSubscriptions(token: number): void;
  clearDebounceTimer(): void;
  closeSubscriptions(): void;
  clearResubscribeTimers(): void;
  dispose(): void;
} {
  const state: SubscriptionState = {
    subscriptions: [],
    pendingTimers: new Map(),
    resubscribeAttempts: new Map(),
    debounceTimer: null,
  };

  return {
    initializeSubscriptions(token: number): void {
      if (!options.subscribeToChanges) {
        return;
      }
      const paths = normalizeWatchPaths(resolveWatchPaths(options));
      for (const watchPath of paths) {
        trySubscribeWatchPath(state, options, watchPath, token);
      }
    },
    clearDebounceTimer: () => clearDebounceTimer(state),
    closeSubscriptions: () => closeSubscriptions(state, options.emitError),
    clearResubscribeTimers: () => clearResubscribeTimers(state),
    dispose(): void {
      clearDebounceTimer(state);
      closeSubscriptions(state, options.emitError);
      clearResubscribeTimers(state);
    },
  };
}
