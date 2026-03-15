import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createObserver, PROVIDER_KINDS, type TranscriptProvider } from "@/core";
import type { CanonicalAgentSnapshot } from "@/core/model";
import type { ObserverChangeEvent } from "@/core/observer";
import { cursor } from "@/providers/cursor";

const AGENT_DEFAULTS: CanonicalAgentSnapshot = {
  id: "agent-1",
  name: "Agent",
  kind: "local",
  isSubagent: false,
  status: "running",
  taskSummary: "Test task",
  updatedAt: Date.now(),
  source: "mock",
};

function makeAgent(overrides: Partial<CanonicalAgentSnapshot> = {}): CanonicalAgentSnapshot {
  return { ...AGENT_DEFAULTS, ...overrides };
}

function makeProvider(agentsFn: () => CanonicalAgentSnapshot[]): TranscriptProvider {
  return {
    id: PROVIDER_KINDS.cursor,
    discover: () => ({
      inputs: [{ uri: "/tmp/transcript.jsonl", kind: "file" }],
      watchPaths: ["/tmp"],
      warnings: [],
    }),
    read: () => ({
      records: [],
      health: { connected: true, sourceLabel: "mock", warnings: [] },
    }),
    normalize: () => ({
      agents: agentsFn(),
      health: { connected: true, sourceLabel: "mock", warnings: [] },
    }),
  };
}

describe("createObserver", () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    for (const p of cleanupPaths) {
      rmSync(p, { recursive: true, force: true });
    }
    cleanupPaths.length = 0;
  });

  it("emits change events with provider injection", async () => {
    let reads = 0;
    const provider: TranscriptProvider = {
      id: PROVIDER_KINDS.cursor,
      discover: () => ({
        inputs: [{ uri: "/tmp/transcript.jsonl", kind: "file" }],
        watchPaths: ["/tmp"],
        warnings: [],
      }),
      read: () => ({
        records: [],
        health: { connected: true, sourceLabel: "mock", warnings: [] },
      }),
      normalize: () => {
        reads += 1;
        return {
          agents: [
            {
              id: "agent-1",
              name: "Agent One",
              kind: "local",
              isSubagent: false,
              status: reads > 1 ? "idle" : "running",
              taskSummary: "Test task",
              updatedAt: Date.now(),
              source: "mock",
            },
          ],
          health: { connected: true, sourceLabel: "mock", warnings: [] },
        };
      },
    };

    const observer = createObserver({
      provider,
      workspacePaths: ["/tmp/workspace"],
      now: () => 1_000 + reads,
    });

    const changes: ObserverChangeEvent[] = [];
    observer.subscribe((event) => changes.push(event));

    await observer.start();
    const snapshot = await observer.refreshNow();
    await observer.stop();

    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.agents[0].status).toBe("idle");
    expect(changes.some((e) => e.change.kind === "joined")).toBe(true);
    expect(changes.some((e) => e.change.kind === "statusChanged")).toBe(true);
  });

  it("filters completed agents that finished before observer started", async () => {
    const observerStart = 10_000;
    const provider = makeProvider(() => [
      makeAgent({ status: "completed", updatedAt: observerStart - 5000 }),
    ]);

    const observer = createObserver({
      provider,
      workspacePaths: ["/tmp/workspace"],
      now: () => observerStart,
    });

    const changes: ObserverChangeEvent[] = [];
    observer.subscribe((event) => changes.push(event));

    await observer.start();
    await observer.stop();

    expect(changes.filter((e) => e.change.kind === "joined")).toHaveLength(0);
  });

  it("emits completed agents that finished after observer started", async () => {
    const observerStart = 10_000;
    let readCount = 0;
    const provider = makeProvider(() => {
      readCount++;
      if (readCount === 1) {
        return [];
      }
      return [makeAgent({ status: "completed", updatedAt: observerStart + 1000 })];
    });

    const observer = createObserver({
      provider,
      workspacePaths: ["/tmp/workspace"],
      now: () => observerStart,
    });

    const changes: ObserverChangeEvent[] = [];
    observer.subscribe((event) => changes.push(event));

    await observer.start();
    await observer.refreshNow();
    await observer.stop();

    const joins = changes.filter((e) => e.change.kind === "joined");
    expect(joins).toHaveLength(1);
    expect(joins[0].agent.status).toBe("completed");
  });

  it("works with injected Cursor transcript provider", async () => {
    const workspacePath = path.join(
      "/tmp",
      `observer-core-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const transcriptDir = workspaceToTranscriptDir(workspacePath);
    cleanupPaths.push(transcriptDir);
    const transcriptPath = path.join(transcriptDir, "session.jsonl");
    mkdirSync(transcriptDir, { recursive: true });
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        agentId: "a1",
        agentName: "Agent One",
        kind: "local",
        status: "running",
        task: "Build observer API",
        updatedAt: Date.now(),
      })}\n`,
      "utf8",
    );

    const observer = createObserver({
      provider: cursor(),
      workspacePaths: [workspacePath],
    });

    await observer.start();
    const snapshot = await observer.refreshNow();
    await observer.stop();

    expect(snapshot.health.connected).toBe(true);
    expect(snapshot.agents.length).toBeGreaterThan(0);
    expect(snapshot.agents[0].id).toBe("a1");
  });
});

function workspaceToTranscriptDir(workspacePath: string): string {
  const workspaceId = path.resolve(workspacePath).replace(/^\/+/, "").split(/[\\/]/).join("-");
  return path.join(homedir(), ".cursor", "projects", workspaceId, "agent-transcripts");
}
