import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOpenCodeDatabase, type OpenCodeDatabase } from "@/providers/opencode/database";
import { createTestDb, seedMessage, seedPart, seedProject, seedSession } from "./opencode-fixtures";

const MS_PER_DAY = 86_400_000;

describe("opencode database", () => {
  let rawDb: ReturnType<typeof createTestDb>;
  let ocDb: OpenCodeDatabase;

  beforeEach(() => {
    rawDb = createTestDb();
    ocDb = createOpenCodeDatabase(rawDb);
  });

  afterEach(() => {
    rawDb.close();
  });

  describe("findProjectIds", () => {
    it("returns project IDs matching workspace paths", () => {
      seedProject(rawDb, "p1", "/Users/test/projectA");
      seedProject(rawDb, "p2", "/Users/test/projectB");
      seedProject(rawDb, "p3", "/Users/other/projectC");

      const ids = ocDb.findProjectIds(["/Users/test/projectA"]);
      expect(ids).toEqual(["p1"]);
    });

    it("matches subdirectory workspace paths", () => {
      seedProject(rawDb, "p1", "/Users/test/projectA");

      const ids = ocDb.findProjectIds(["/Users/test"]);
      expect(ids).toEqual(["p1"]);
    });

    it("returns empty array when no projects match", () => {
      seedProject(rawDb, "p1", "/Users/test/projectA");

      const ids = ocDb.findProjectIds(["/other"]);
      expect(ids).toEqual([]);
    });

    it("returns empty array for empty workspace paths", () => {
      seedProject(rawDb, "p1", "/Users/test/projectA");

      const ids = ocDb.findProjectIds([]);
      expect(ids).toEqual([]);
    });
  });

  describe("findSessions", () => {
    it("returns sessions for given project IDs within time window", () => {
      seedProject(rawDb, "p1", "/test");
      seedSession(rawDb, "s1", "p1", { title: "Session 1", timeUpdated: Date.now() });
      seedSession(rawDb, "s2", "p1", {
        title: "Session 2",
        timeUpdated: Date.now() - MS_PER_DAY * 30,
      });

      const sessions = ocDb.findSessions(["p1"], Date.now() - MS_PER_DAY * 7);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe("s1");
    });

    it("returns subagent sessions with parentId", () => {
      seedProject(rawDb, "p1", "/test");
      seedSession(rawDb, "s1", "p1");
      seedSession(rawDb, "s2", "p1", { parentId: "s1", title: "Subagent task" });

      const sessions = ocDb.findSessions(["p1"], 0);
      const sub = sessions.find((s) => s.id === "s2");
      expect(sub).toBeDefined();
      expect(sub?.parentId).toBe("s1");
    });

    it("returns empty array for empty projectIds", () => {
      seedProject(rawDb, "p1", "/test");
      seedSession(rawDb, "s1", "p1");

      const sessions = ocDb.findSessions([], 0);
      expect(sessions).toEqual([]);
    });
  });

  describe("getSessionStats", () => {
    it("returns message and tool call counts per session", () => {
      seedProject(rawDb, "p1", "/test");
      seedSession(rawDb, "s1", "p1");
      seedMessage(rawDb, "m1", "s1", { role: "user", time: { created: 1 }, agent: "commander" });
      seedMessage(rawDb, "m2", "s1", {
        role: "assistant",
        time: { created: 2 },
        agent: "commander",
        modelID: "claude-opus-4-6",
      });
      seedPart(rawDb, "pt1", "m2", "s1", { type: "tool", tool: "read" });
      seedPart(rawDb, "pt2", "m2", "s1", { type: "tool", tool: "write" });
      seedPart(rawDb, "pt3", "m2", "s1", { type: "text", text: "done" });

      const stats = ocDb.getSessionStats(["s1"]);
      expect(stats.get("s1")).toBeDefined();
      expect(stats.get("s1")?.messageCount).toBe(2);
      expect(stats.get("s1")?.toolCallCount).toBe(2);
      expect(stats.get("s1")?.latestAgent).toBe("commander");
      expect(stats.get("s1")?.latestModel).toBe("claude-opus-4-6");
    });

    it("returns empty map for empty sessionIds", () => {
      const stats = ocDb.getSessionStats([]);
      expect(stats.size).toBe(0);
    });
  });

  describe("getLatestUserSummary", () => {
    it("returns the title from the latest user message summary", () => {
      seedProject(rawDb, "p1", "/test");
      seedSession(rawDb, "s1", "p1");
      seedMessage(
        rawDb,
        "m1",
        "s1",
        { role: "user", time: { created: 1 }, summary: { title: "First task" } },
        1000,
      );
      seedMessage(
        rawDb,
        "m2",
        "s1",
        { role: "user", time: { created: 2 }, summary: { title: "Latest task" } },
        2000,
      );

      const summary = ocDb.getLatestUserSummary("s1");
      expect(summary).toBe("Latest task");
    });

    it("returns undefined when no user messages exist", () => {
      seedProject(rawDb, "p1", "/test");
      seedSession(rawDb, "s1", "p1");

      const summary = ocDb.getLatestUserSummary("s1");
      expect(summary).toBeUndefined();
    });
  });

  describe("getDataVersion", () => {
    it("returns a number", () => {
      const version = ocDb.getDataVersion();
      expect(typeof version).toBe("number");
    });
  });
});
