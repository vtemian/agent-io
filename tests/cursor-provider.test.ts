import { createCursorTranscriptProvider, CURSOR_WATCH_DEBOUNCE_MS } from "@/providers/cursor";
import { describe, expect, it } from "vitest";

describe("cursor transcript provider", () => {
  it("includes watch by default", () => {
    const provider = createCursorTranscriptProvider();
    expect(provider.watch).toBeDefined();
    expect(provider.watch?.debounceMs).toBe(CURSOR_WATCH_DEBOUNCE_MS);
  });

  it("accepts custom watch debounce", () => {
    const provider = createCursorTranscriptProvider({ watch: { debounceMs: 500 } });
    expect(provider.watch?.debounceMs).toBe(500);
  });

  it("allows disabling watch with false", () => {
    const provider = createCursorTranscriptProvider({ watch: false });
    expect(provider.watch).toBeUndefined();
  });

  it("ignores malformed snapshot payloads during normalization", async () => {
    const provider = createCursorTranscriptProvider();

    const snapshot = await provider.normalize(
      {
        records: [
          {
            provider: "cursor",
            inputUri: "cursor://transcripts",
            observedAt: Date.now(),
            payload: {
              agents: [
                {
                  id: "agent-1",
                  name: "Agent One",
                  kind: "local",
                  isSubagent: false,
                  status: "running",
                  taskSummary: "Task",
                  updatedAt: Date.now(),
                  source: "cursor-transcripts",
                },
              ],
              connected: true,
              sourceLabel: "cursor-transcripts",
              warnings: [123],
            },
          },
        ],
        health: {
          connected: true,
          sourceLabel: "cursor-transcripts",
          warnings: [],
        },
      },
      Date.now(),
    );

    expect(snapshot.agents).toHaveLength(0);
  });
});
