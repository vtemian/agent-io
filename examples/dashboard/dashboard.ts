import { type CanonicalAgentSnapshot, createObserver } from "@agentprobe/core";
import blessed from "blessed";
import contrib from "blessed-contrib";

const SOURCE_LABELS: Record<string, string> = {
  "cursor-transcripts": "Cursor",
  "claude-code-sessions": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

const STATUS_COLORS: Record<string, string> = {
  running: "green",
  idle: "yellow",
  completed: "gray",
  error: "red",
};

const TABLE_HEADERS = ["Source", "Status", "Task", "Duration"];
const MAX_LOG_SUMMARY = 60;
const MAX_TABLE_SUMMARY = 48;
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

const workspacePaths = process.argv.slice(2);
if (workspacePaths.length === 0) workspacePaths.push(process.cwd());

const startTime = Date.now();
let agents: CanonicalAgentSnapshot[] = [];
const observer = createObserver({ workspacePaths });

// --- UI layout ---

const screen = blessed.screen({ smartCSR: true, title: "agentprobe dashboard" });

const header = blessed.text({
  top: 0,
  left: 0,
  width: "100%",
  height: 1,
  style: { fg: "cyan", bold: true },
});

const table = contrib.table({
  top: 2,
  left: 0,
  width: "100%",
  height: "50%-2",
  label: " Agents ",
  border: { type: "line" },
  style: { border: { fg: "cyan" }, header: { fg: "white", bold: true } },
  columnSpacing: 2,
  columnWidth: [14, 12, 50, 12],
});

const log = contrib.log({
  top: "50%",
  left: 0,
  width: "100%",
  height: "50%",
  label: " Event Log ",
  border: { type: "line" },
  style: { border: { fg: "cyan" }, fg: "white" },
  scrollable: true,
  scrollbar: { style: { bg: "blue" } },
});

screen.append(header);
screen.append(table);
screen.append(log);

// --- Formatting ---

function fmtElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m${String(s).padStart(2, "0")}s`;
}

function fmtDuration(startedAt?: number): string {
  return startedAt != null ? fmtElapsed(Date.now() - startedAt) : "-";
}

function statusTag(status: string): string {
  const c = STATUS_COLORS[status] ?? "white";
  return `{${c}-fg}${status}{/${c}-fg}`;
}

const srcLabel = (s: string): string => SOURCE_LABELS[s] ?? s;
const fmtTime = (ts: number): string => new Date(ts).toLocaleTimeString();

function addLogEntry(kind: string, agent: CanonicalAgentSnapshot): void {
  const line =
    `{gray-fg}${fmtTime(Date.now())}{/gray-fg} ` +
    `${kind} ${srcLabel(agent.source)} ${statusTag(agent.status)} ` +
    agent.taskSummary.slice(0, MAX_LOG_SUMMARY);
  log.log(line);
}

// --- Render ---

function render(): void {
  const now = Date.now();
  const visible = agents.filter((a) => {
    if (a.status !== "completed" && a.status !== "error") return true;
    return now - a.updatedAt < STALE_THRESHOLD_MS;
  });

  header.setContent(
    `  agentprobe   agents: ${visible.length}/${agents.length}   uptime: ${fmtElapsed(now - startTime)}`,
  );

  if (visible.length === 0) {
    table.setData({
      headers: TABLE_HEADERS,
      data: [["", "{yellow-fg}No active agents \u2014 waiting...{/yellow-fg}", "", ""]],
    });
  } else {
    table.setData({
      headers: TABLE_HEADERS,
      data: visible.map((a) => [
        srcLabel(a.source),
        a.status,
        a.taskSummary.slice(0, MAX_TABLE_SUMMARY),
        fmtDuration(a.startedAt),
      ]),
    });
  }

  screen.render();
}

// --- Observer wiring ---

observer.subscribe((event) => {
  agents = event.snapshot.agents;
  addLogEntry(event.change.kind, event.agent);
  render();
});

try {
  await observer.start();
} catch (err) {
  screen.destroy();
  console.error("Failed to start observer:", err);
  process.exit(1);
}
const initialSnapshot = await observer.refreshNow();
agents = initialSnapshot.agents;
render();

const ticker = setInterval(render, 1000);

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(ticker);
  try {
    await observer.stop();
  } finally {
    screen.destroy();
    process.exit(0);
  }
}

screen.key(["q", "C-c"], shutdown);
process.on("SIGINT", () => void shutdown());
