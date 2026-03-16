import { createObserver } from "@agentprobe/core";

const observer = createObserver({
  workspacePaths: [process.argv[2] ?? process.cwd()],
});

observer.subscribe((event) => {
  const { change, agent } = event;
  console.log(
    `[${change.kind}] ${agent.id.slice(0, 8)} → ${agent.status} | ${agent.taskSummary.slice(0, 60)}`,
  );
});

try {
  await observer.start();
} catch (err) {
  console.error("Failed to start observer:", err);
  process.exit(1);
}
console.log("Watching... (Ctrl+C to stop)");

let shuttingDown = false;
process.on("SIGINT", () => {
  if (shuttingDown) return;
  shuttingDown = true;
  observer
    .stop()
    .catch(() => {})
    .finally(() => process.exit(0));
});
