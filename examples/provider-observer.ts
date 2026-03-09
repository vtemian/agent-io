import type { CanonicalAgentSnapshot } from "../src/core/model";
import { createObserver } from "../src/index";

const DURATION_MS = 2 * 60 * 1000;
const STATUS_ICON: Record<string, string> = { running: "▶", idle: "◦" };

const activeAgents = new Map<string, CanonicalAgentSnapshot>();

async function main(): Promise<void> {
  const observer = createObserver({
    workspacePaths: [process.argv[2] ?? process.cwd()],
  });

  observer.subscribe((event) => {
    const { change, agent } = event;

    if (change.kind === "left" || agent.status === "completed" || agent.status === "error") {
      activeAgents.delete(agent.id);
    } else {
      activeAgents.set(agent.id, agent);
    }

    if (activeAgents.size === 0) {
      console.log(`[${ts()}] ${event.snapshot.agents.length} agents, none active`);
      return;
    }

    const counts = new Map<string, number>();
    for (const a of activeAgents.values()) {
      counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
    }
    const summary = [...counts.entries()].map(([s, n]) => `${n} ${s}`).join(", ");
    console.log(`[${ts()}] ${summary} / ${event.snapshot.agents.length} total:`);
    for (const a of activeAgents.values()) {
      console.log(
        `  ${STATUS_ICON[a.status] ?? "?"} ${a.id.slice(0, 8)} | ${a.taskSummary.slice(0, 80)}`,
      );
    }
  });

  await observer.start();
  console.log(`Observer started. Watching for ${DURATION_MS / 1000}s...`);

  await new Promise((resolve) => setTimeout(resolve, DURATION_MS));

  await observer.stop();
  console.log("Observer stopped.");
}

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

void main();
