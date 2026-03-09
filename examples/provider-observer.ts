import { createObserver } from "../src/index";

const DURATION_MS = 2 * 60 * 1000;
let lastSnapshotAt = 0;

async function main(): Promise<void> {
  const observer = createObserver({
    workspacePaths: [process.argv[2] ?? process.cwd()],
  });

  observer.subscribeToSnapshots((event) => {
    const now = performance.now();
    const delta = lastSnapshotAt > 0 ? `+${(now - lastSnapshotAt).toFixed(0)}ms` : "init";
    lastSnapshotAt = now;

    const running = event.snapshot.agents.filter((a) => a.status === "running");
    const idle = event.snapshot.agents.filter((a) => a.status === "idle");
    const total = event.snapshot.agents.length;

    if (running.length === 0 && idle.length === 0) {
      console.log(`[${ts()}] (${delta}) ${total} agents, none active`);
      return;
    }
    const parts = [
      running.length > 0 ? `${running.length} running` : "",
      idle.length > 0 ? `${idle.length} idle` : "",
    ]
      .filter(Boolean)
      .join(", ");
    console.log(`[${ts()}] (${delta}) ${parts} / ${total} total:`);
    for (const agent of running) {
      console.log(`  ▶ ${agent.id.slice(0, 8)} | ${agent.taskSummary.slice(0, 80)}`);
    }
    for (const agent of idle) {
      console.log(`  ◦ ${agent.id.slice(0, 8)} | ${agent.taskSummary.slice(0, 80)}`);
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
