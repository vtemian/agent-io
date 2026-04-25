import { type FSWatcher, watch as fsWatch } from "node:fs";
import { toError } from "@/core/errors";

export interface ProviderWatchOptions {
  debounceMs?: number;
}

export interface ProviderWatch {
  readonly debounceMs: number;
  subscribe(
    watchPath: string,
    onEvent: () => void,
    onError: (error: Error) => void,
  ): { close(): void };
}

export interface ProviderWatchConfig {
  defaultDebounceMs: number;
  shouldEmitForFilename?: (filename: string) => boolean;
}

export function createProviderWatch(
  config: ProviderWatchConfig,
  options: ProviderWatchOptions = {},
): ProviderWatch {
  const debounceMs = options.debounceMs ?? config.defaultDebounceMs;
  const shouldEmit = config.shouldEmitForFilename;

  function subscribe(
    watchPath: string,
    onEvent: () => void,
    onError: (error: Error) => void,
  ): { close(): void } {
    const handler = (_event: string | null, filename: string | Buffer | null): void => {
      if (shouldEmit && typeof filename === "string" && !shouldEmit(filename)) {
        return;
      }
      onEvent();
    };

    const watcher = openWatcher(watchPath, handler);
    watcher.on("error", (error) => {
      onError(toError(error));
    });

    return {
      close() {
        watcher.close();
      },
    };
  }

  return {
    debounceMs,
    subscribe,
  };
}

function openWatcher(
  watchPath: string,
  handler: (event: string | null, filename: string | Buffer | null) => void,
): FSWatcher {
  try {
    // Attempt recursive watch — supported on macOS, Windows, and Linux kernel ≥5.1 via inotify.
    // Probing at runtime is more accurate than a hard-coded platform allowlist.
    return fsWatch(watchPath, { recursive: true }, handler);
  } catch {
    // recursive: true unsupported on this platform/kernel — warn and fall back so
    // at least top-level changes are caught.
    console.warn(
      `[agentprobe] fs.watch recursive mode unavailable for "${watchPath}": ` +
        `only top-level directory changes will be detected. ` +
        `Upgrade to Linux kernel 5.1+ or use macOS/Windows for full nested-change support.`,
    );
    try {
      return fsWatch(watchPath, {}, handler);
    } catch (fallbackError) {
      throw toError(fallbackError);
    }
  }
}
