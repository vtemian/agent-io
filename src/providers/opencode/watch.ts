import { toError } from "@/core/errors";
import { OPENCODE_WATCH_DEBOUNCE_MS, OPENCODE_WATCH_POLL_INTERVAL_MS } from "./constants";

export interface OpenCodeWatchConfig {
  pollIntervalMs?: number;
  getDataVersion: () => number;
}

export interface OpenCodeWatch {
  readonly debounceMs: number;
  subscribe(
    watchPath: string,
    onEvent: () => void,
    onError: (error: Error) => void,
  ): { close(): void };
}

export function createOpenCodeWatch(config: OpenCodeWatchConfig): OpenCodeWatch {
  const pollIntervalMs = config.pollIntervalMs ?? OPENCODE_WATCH_POLL_INTERVAL_MS;

  function subscribe(
    _watchPath: string,
    onEvent: () => void,
    onError: (error: Error) => void,
  ): { close(): void } {
    let lastVersion: number | undefined;

    try {
      lastVersion = config.getDataVersion();
    } catch (error) {
      onError(toError(error));
    }

    const timer = setInterval(() => {
      try {
        const currentVersion = config.getDataVersion();
        if (lastVersion !== undefined && currentVersion !== lastVersion) {
          onEvent();
        }
        lastVersion = currentVersion;
      } catch (error) {
        onError(toError(error));
      }
    }, pollIntervalMs);

    return {
      close() {
        clearInterval(timer);
      },
    };
  }

  return {
    debounceMs: OPENCODE_WATCH_DEBOUNCE_MS,
    subscribe,
  };
}
