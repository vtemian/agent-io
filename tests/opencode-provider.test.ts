import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROVIDER_KINDS } from "@/core/providers";
import { openCode } from "@/providers/opencode/provider";
import { createTestDb, seedMessage, seedProject } from "./opencode-fixtures";

describe("opencode provider", () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("discovers projects matching workspace paths", async () => {
    db.prepare("INSERT INTO project VALUES (?, ?, ?, ?)").run(
      "p1",
      "/Users/test/myproject",
      Date.now(),
      Date.now(),
    );

    const provider = openCode({ _testDb: db });
    const result = await provider.discover(["/Users/test/myproject"]);
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0].metadata?.providerId).toBe(PROVIDER_KINDS.openCode);
  });

  it("returns empty discovery when no projects match", async () => {
    db.prepare("INSERT INTO project VALUES (?, ?, ?, ?)").run(
      "p1",
      "/Users/test/other",
      Date.now(),
      Date.now(),
    );

    const provider = openCode({ _testDb: db });
    const result = await provider.discover(["/Users/test/myproject"]);
    expect(result.inputs).toHaveLength(0);
  });

  it("reads sessions and produces agent snapshots", async () => {
    const now = Date.now();
    db.prepare("INSERT INTO project VALUES (?, ?, ?, ?)").run("p1", "/test", now, now);
    db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "ses_abc",
      "p1",
      null,
      "slug",
      "/test",
      "Fix the bug",
      "1.2.24",
      now,
      now,
    );
    seedMessage(db, "m1", "ses_abc", {
      role: "user",
      time: { created: now },
      agent: "commander",
      summary: { title: "Fix the bug" },
    });
    seedMessage(db, "m2", "ses_abc", {
      role: "assistant",
      time: { created: now },
      agent: "commander",
      modelID: "claude-opus-4-6",
      providerID: "anthropic",
    });

    const provider = openCode({ _testDb: db });
    provider.connect?.();
    const discovery = await provider.discover(["/test"]);
    const readResult = await provider.read(discovery.inputs, now);

    expect(readResult.health.connected).toBe(true);

    const snapshot = await provider.normalize(readResult, now);
    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.agents[0].id).toBe("ses_abc");
    expect(snapshot.agents[0].taskSummary).toBe("Fix the bug");
    expect(snapshot.agents[0].source).toBe("opencode");
    expect(snapshot.agents[0].isSubagent).toBe(false);
  });

  it("marks sessions with parent_id as subagents", async () => {
    const now = Date.now();
    db.prepare("INSERT INTO project VALUES (?, ?, ?, ?)").run("p1", "/test", now, now);
    db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "ses_parent",
      "p1",
      null,
      "slug",
      "/test",
      "Main session",
      "1.2.24",
      now,
      now,
    );
    db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "ses_child",
      "p1",
      "ses_parent",
      "slug",
      "/test",
      "Subagent task",
      "1.2.24",
      now,
      now,
    );
    seedMessage(db, "m1", "ses_parent", { role: "user", time: { created: now } });
    seedMessage(db, "m2", "ses_child", { role: "user", time: { created: now } });

    const provider = openCode({ _testDb: db });
    provider.connect?.();
    const discovery = await provider.discover(["/test"]);
    const readResult = await provider.read(discovery.inputs, now);
    const snapshot = await provider.normalize(readResult, now);

    const parent = snapshot.agents.find((a) => a.id === "ses_parent");
    const child = snapshot.agents.find((a) => a.id === "ses_child");
    expect(parent?.isSubagent).toBe(false);
    expect(child?.isSubagent).toBe(true);
  });

  it("derives status from time_updated age", async () => {
    const now = Date.now();
    db.prepare("INSERT INTO project VALUES (?, ?, ?, ?)").run("p1", "/test", now, now);
    db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "ses_running",
      "p1",
      null,
      "slug",
      "/test",
      "Running",
      "1.2.24",
      now,
      now,
    );
    db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "ses_idle",
      "p1",
      null,
      "slug",
      "/test",
      "Idle",
      "1.2.24",
      now,
      now - 30_000,
    );
    db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "ses_done",
      "p1",
      null,
      "slug",
      "/test",
      "Done",
      "1.2.24",
      now,
      now - 120_000,
    );
    for (const sid of ["ses_running", "ses_idle", "ses_done"]) {
      seedMessage(db, `m_${sid}`, sid, { role: "user", time: { created: now } });
    }

    const provider = openCode({ _testDb: db });
    provider.connect?.();
    const discovery = await provider.discover(["/test"]);
    const readResult = await provider.read(discovery.inputs, now);
    const snapshot = await provider.normalize(readResult, now);

    const running = snapshot.agents.find((a) => a.id === "ses_running");
    const idle = snapshot.agents.find((a) => a.id === "ses_idle");
    const done = snapshot.agents.find((a) => a.id === "ses_done");
    expect(running?.status).toBe("running");
    expect(idle?.status).toBe("idle");
    expect(done?.status).toBe("completed");
  });

  it("returns warning after disconnect", async () => {
    seedProject(db, "p1", "/test");

    const provider = openCode({ _testDb: db });
    provider.connect?.();

    const beforeDisconnect = await provider.discover(["/test"]);
    expect(beforeDisconnect.warnings).toHaveLength(0);

    provider.disconnect?.();

    const afterDisconnect = await provider.discover(["/test"]);
    expect(afterDisconnect.inputs).toHaveLength(0);
    expect(afterDisconnect.warnings).toContain("OpenCode database not found.");
  });
});
