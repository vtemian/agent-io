import {
  type CanonicalAgentSnapshot,
  type CanonicalAgentStatus,
  createObserver,
} from "@agentprobe/core";
import { type GlimpseWindow, open } from "glimpseui";

const WINDOW_WIDTH = 280;
const WINDOW_HEIGHT = 300;
const TICK_MS = 1000;
const FADE_MS = 200;

const SOURCE_LABELS: Record<string, string> = {
  "cursor-transcripts": "Cursor",
  "claude-code-sessions": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

const html = `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg: rgba(24, 24, 27, 0.75);
    --border: rgba(255, 255, 255, 0.06);
    --text: #e4e4e7;
    --text-bright: #fafafa;
    --text-muted: #a1a1aa;
    --text-dim: #71717a;
    --text-ghost: #52525b;
    --status-running: #4ade80;
    --status-idle: #facc15;
    --status-completed: #9ca3af;
    --status-error: #f87171;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "SF Mono", "Menlo", "Monaco", monospace;
    font-size: 11px;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    -webkit-user-select: none;
    user-select: none;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 10px 6px;
    border-bottom: 1px solid var(--border);
  }
  .title { font-weight: 600; font-size: 11px; color: var(--text-bright); }
  .count { font-size: 10px; color: var(--text-dim); }
  #agents { overflow-y: auto; max-height: calc(100vh - 36px); }
  .agent {
    padding: 6px 10px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
  }
  .agent.entering { animation: fadeIn ${FADE_MS}ms ease-out; }
  .agent.leaving  { animation: fadeOut ${FADE_MS}ms ease-in forwards; }
  .agent:last-child { border-bottom: none; }
  .agent-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2px;
  }
  .agent-source { display: flex; align-items: center; gap: 5px; font-weight: 500; }
  .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .dot.running  { background: var(--status-running); animation: pulse 2s ease-in-out infinite; }
  .dot.idle     { background: var(--status-idle); }
  .dot.completed { background: var(--status-completed); }
  .dot.error    { background: var(--status-error); }
  .time-ago { font-size: 9px; color: var(--text-dim); }
  .task-summary {
    font-size: 10px; color: var(--text-muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .empty { padding: 24px 10px; text-align: center; color: var(--text-ghost); }
  @keyframes pulse  { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
  @keyframes fadeIn  { from { opacity:0; transform:translateY(-3px); } to { opacity:1; transform:translateY(0); } }
  @keyframes fadeOut { from { opacity:1; transform:translateY(0); } to { opacity:0; transform:translateY(3px); } }
</style></head><body>
  <header>
    <span class="title">agentprobe</span>
    <span class="count" id="count">0 active</span>
  </header>
  <div id="agents"><div class="empty">No active agents</div></div>
  <script>
    var knownKeys = "";
    var knownIds = {};
    function timeAgo(ts, now) {
      var d = Math.max(0, Math.floor((now - ts) / 1000));
      if (d < 60) return d + "s ago";
      if (d < 3600) return Math.floor(d / 60) + "m ago";
      return Math.floor(d / 3600) + "h ago";
    }
    function esc(s) { var e = document.createElement("span"); e.textContent = s; return e.innerHTML; }
    function safeAttr(s) { return s.replace(/[^a-z0-9-]/gi, ""); }
    function card(a, now, isNew) {
      var cls = "agent" + (a.leaving ? " leaving" : isNew ? " entering" : "");
      return '<div class="' + cls + '"><div class="agent-header">'
        + '<span class="agent-source"><span class="dot ' + safeAttr(a.status) + '"></span>' + esc(a.sourceLabel) + '</span>'
        + '<span class="time-ago">' + timeAgo(a.updatedAt, now) + '</span></div>'
        + '<div class="task-summary">' + esc(a.taskSummary) + '</div></div>';
    }
    function render(agents, now) {
      var active = agents.filter(function(a) { return !a.leaving; }).length;
      document.getElementById("count").textContent = active + " active";
      var c = document.getElementById("agents");
      if (!agents.length) { c.innerHTML = '<div class="empty">No active agents</div>'; knownKeys = ""; knownIds = {}; return; }
      var nk = agents.map(function(a) { return a.id + ":" + a.status + (a.leaving ? ":L" : ""); }).join(",");
      if (nk === knownKeys) { var els = c.querySelectorAll(".time-ago"); for (var i = 0; i < els.length && i < agents.length; i++) els[i].textContent = timeAgo(agents[i].updatedAt, now); return; }
      var prev = knownIds; knownIds = {}; agents.forEach(function(a) { knownIds[a.id] = true; });
      knownKeys = nk;
      c.innerHTML = agents.map(function(a) { return card(a, now, !prev[a.id]); }).join("");
    }
  </script>
</body></html>`;

interface AgentView {
  readonly id: string;
  readonly status: CanonicalAgentStatus;
  readonly sourceLabel: string;
  readonly taskSummary: string;
  readonly updatedAt: number;
  readonly leaving: boolean;
}

function toView(agent: CanonicalAgentSnapshot): AgentView {
  return {
    id: agent.id,
    status: agent.status,
    sourceLabel: SOURCE_LABELS[agent.source] ?? agent.source,
    taskSummary: agent.taskSummary,
    updatedAt: agent.updatedAt,
    leaving: false,
  };
}

async function main(): Promise<void> {
  const workspacePaths = process.argv.length > 2 ? process.argv.slice(2) : [process.cwd()];
  const agents = new Map<string, AgentView>();
  const observer = createObserver({ workspacePaths });

  const win: GlimpseWindow = open(html, {
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    frameless: true,
    transparent: true,
    floating: true,
    clickThrough: true,
  });

  win.on("error", (err: unknown) => console.error("Glimpse:", err));

  const sendUpdate = (): void => {
    const payload = JSON.stringify([...agents.values()]);
    win.send(`render(${payload}, ${Date.now()})`);
  };

  const unsubscribe = observer.subscribe((event) => {
    if (event.change.kind === "left") {
      const existing = agents.get(event.agent.id);
      if (existing) {
        agents.set(event.agent.id, { ...existing, leaving: true });
        setTimeout(() => {
          if (agents.get(event.agent.id)?.leaving) {
            agents.delete(event.agent.id);
            sendUpdate();
          }
        }, FADE_MS);
      }
    } else {
      agents.set(event.agent.id, toView(event.agent));
    }
    sendUpdate();
  });

  win.on("ready", sendUpdate);
  await observer.start();

  const ticker = setInterval(sendUpdate, TICK_MS);
  console.log(`Floating monitor — watching ${workspacePaths.join(", ")}...`);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(ticker);
    unsubscribe();
    try {
      win.close();
    } catch (e: unknown) {
      console.debug("Window close skipped:", e);
    }
    try {
      await observer.stop();
    } catch (e: unknown) {
      console.debug("Observer stop failed:", e);
    }
  };

  process.on("SIGINT", () => void shutdown());
  win.on("closed", () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
