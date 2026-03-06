export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === "string") {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

export const WATCH_RUNTIME_ERROR_MESSAGES = {
  notRunning: "Watch runtime is not running.",
  stoppedBeforeRefreshCompleted: "Watch runtime stopped before refresh completed.",
} as const;

export const WATCH_RUNTIME_ERROR_CODES = {
  notRunning: "NOT_RUNNING",
  stoppedBeforeRefreshCompleted: "STOPPED_BEFORE_REFRESH_COMPLETED",
} as const;
export type WatchRuntimeErrorCode =
  (typeof WATCH_RUNTIME_ERROR_CODES)[keyof typeof WATCH_RUNTIME_ERROR_CODES];

export class WatchRuntimeError extends Error {
  code: WatchRuntimeErrorCode;

  constructor(code: WatchRuntimeErrorCode, message: string) {
    super(message);
    this.name = "WatchRuntimeError";
    this.code = code;
  }
}

export function isWatchRuntimeError(error: unknown): error is WatchRuntimeError {
  return error instanceof WatchRuntimeError;
}
