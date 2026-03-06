import { createObserver } from "@agentprobe/core";

const DURATION_MS = 2 * 60 * 1000;

async function main(): Promise<void> {
  const observer = createObserver({
    workspacePaths: [process.argv[2] ?? process.cwd()],
    debounceMs: 25,
  });

  observer.subscribeToSnapshots((event) => {
    const running = event.snapshot.agents.filter((a) => a.status === "running");
    if (running.length === 0) {
      console.log(`[${ts()}] No running agents`);
      return;
    }
    console.log(`[${ts()}] ${running.length} running agent(s):`);
    for (const agent of running) {
      console.log(`  ${agent.id.slice(0, 8)} | ${agent.name} | ${agent.taskSummary.slice(0, 80)}`);
    }
  });

  await observer.start();
  console.log(`Observer started. Watching for ${DURATION_MS / 1000}s...`);

  await new Promise((resolve) => setTimeout(resolve, DURATION_MS));

  await observer.stop();
  console.log("Observer stopped.");
}

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

void main();
