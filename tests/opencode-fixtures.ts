import { createRequire } from "node:module";
import type BetterSqlite3 from "better-sqlite3";

type DatabaseConstructor = typeof BetterSqlite3;

const req = createRequire(import.meta.url);

let Database: DatabaseConstructor | undefined;
try {
  const loaded: unknown = req("better-sqlite3");
  if (!isCtor(loaded)) throw new Error("better-sqlite3 did not export a constructor");
  new loaded(":memory:").close();
  Database = loaded;
} catch (error) {
  // Swallow only unavailability errors — absent package, unbuilt native binary,
  // or the bindings-package "Could not locate the bindings file" message.
  if (!isUnavailableError(error)) {
    throw error;
  }
}

export const hasSqlite = Database !== undefined;

function isCtor(value: unknown): value is DatabaseConstructor {
  return typeof value === "function";
}

function isUnavailableError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = hasCode(error) ? error.code : undefined;
  if (code === "MODULE_NOT_FOUND" || code === "ERR_DLOPEN_FAILED") {
    return true;
  }
  const message = hasMessage(error) ? error.message : "";
  return String(message).includes("Could not locate the bindings file");
}

function hasCode(value: object): value is { code: unknown } {
  return "code" in value;
}

function hasMessage(value: object): value is { message: unknown } {
  return "message" in value;
}

const OPENCODE_SCHEMA = `
  CREATE TABLE project (
    id TEXT PRIMARY KEY,
    worktree TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL
  );
  CREATE TABLE session (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    parent_id TEXT,
    slug TEXT NOT NULL,
    directory TEXT NOT NULL,
    title TEXT NOT NULL,
    version TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES project(id)
  );
  CREATE TABLE message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL,
    data TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES session(id)
  );
  CREATE TABLE part (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL,
    data TEXT NOT NULL,
    FOREIGN KEY (message_id) REFERENCES message(id)
  );
`;

export function createTestDb(): BetterSqlite3.Database {
  if (!Database) throw new Error("better-sqlite3 is not available");
  const db = new Database(":memory:");
  db.exec(OPENCODE_SCHEMA);
  return db;
}

export function seedProject(db: BetterSqlite3.Database, id: string, worktree: string): void {
  db.prepare(
    "INSERT INTO project (id, worktree, time_created, time_updated) VALUES (?, ?, ?, ?)",
  ).run(id, worktree, Date.now(), Date.now());
}

export function seedSession(
  db: BetterSqlite3.Database,
  id: string,
  projectId: string,
  opts: { parentId?: string; title?: string; directory?: string; timeUpdated?: number } = {},
): void {
  db.prepare(
    "INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    projectId,
    opts.parentId ?? null,
    "test-slug",
    opts.directory ?? "/test",
    opts.title ?? "Test session",
    "1.2.24",
    Date.now(),
    opts.timeUpdated ?? Date.now(),
  );
}

export function seedMessage(
  db: BetterSqlite3.Database,
  id: string,
  sessionId: string,
  data: Record<string, unknown>,
  timeCreated?: number,
): void {
  const ts = timeCreated ?? Date.now();
  db.prepare(
    "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
  ).run(id, sessionId, ts, ts, JSON.stringify(data));
}

export function seedPart(
  db: BetterSqlite3.Database,
  id: string,
  messageId: string,
  sessionId: string,
  data: Record<string, unknown>,
): void {
  db.prepare(
    "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, messageId, sessionId, Date.now(), Date.now(), JSON.stringify(data));
}
