import { createCursorTranscriptProvider } from "@/providers/cursor";
import { describe, expect, it } from "vitest";

describe("cursor transcript provider", () => {
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
