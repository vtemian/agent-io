import { homedir } from "node:os";
import path from "node:path";

export const OPENCODE_SOURCE_KIND = "opencode";
export const OPENCODE_RUNNING_WINDOW_MS = 5_000;
export const OPENCODE_IDLE_WINDOW_MS = 60_000;
const DAYS_PER_WEEK = 7;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1_000;
export const OPENCODE_SESSION_WINDOW_MS =
  DAYS_PER_WEEK * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
export const OPENCODE_WATCH_POLL_INTERVAL_MS = 2_000;
export const OPENCODE_WATCH_DEBOUNCE_MS = 100;
export const OPENCODE_AGENT_NAME_PREFIX_LENGTH = 6;
export const OPENCODE_DB_PATH_DEFAULT = path.join(
  homedir(),
  ".local",
  "share",
  "opencode",
  "opencode.db",
);
