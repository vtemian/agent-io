import {
  type CanonicalAgentSnapshot,
  type CanonicalAgentStatus,
  createObserver,
} from "@agentprobe/core";
import { type GlimpseWindow, open } from "glimpseui";

const WIDTH = 300;
const HEADER_HEIGHT = 40;
const AGENT_ROW_HEIGHT = 52;
const EMPTY_HEIGHT = 80;
const MAX_HEIGHT = 500;
const TICK_MS = 1000;
const FADE_MS = 200;
const STALE_MS = 5 * 60 * 1000;

const SOURCE_LABELS: Record<string, string> = {
  "cursor-transcripts": "Cursor",
  "claude-code-sessions": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

const clickThrough = process.argv.includes("--click-through");
const paths = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const workspaces = paths.length > 0 ? paths : [process.cwd()];

const html = `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg: rgba(24, 24, 27, 0.82);
    --border: rgba(255, 255, 255, 0.07);
    --border-faint: rgba(255, 255, 255, 0.03);
    --text: #e4e4e7;
    --bright: #fafafa;
    --muted: #a1a1aa;
    --dim: #71717a;
    --ghost: #52525b;
    --running: #4ade80;
    --idle: #facc15;
    --completed: #9ca3af;
    --error: #f87171;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font: 11px/1.4 "SF Mono", Menlo, Monaco, monospace;
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
  .title { font-weight: 600; color: var(--bright); }
  .badge {
    font-size: 10px; color: var(--dim);
    background: rgba(255,255,255,0.05);
    padding: 1px 6px; border-radius: 8px;
  }
  #agents { overflow-y: auto; max-height: calc(100vh - 36px); }
  .agent {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-faint);
  }
  .agent.entering { animation: fadeIn ${FADE_MS}ms ease-out; }
  .agent.leaving  { animation: fadeOut ${FADE_MS}ms ease-in forwards; }
  .agent:last-child { border-bottom: none; }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .source { display: flex; align-items: center; gap: 5px; font-weight: 500; }
  .meta { font-size: 9px; color: var(--dim); }
  .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .dot.running  { background: var(--running); animation: pulse 2s ease-in-out infinite; }
  .dot.idle     { background: var(--idle); }
  .dot.completed { background: var(--completed); }
  .dot.error    { background: var(--error); }
  .task {
    font-size: 10px; color: var(--muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    margin-top: 2px;
  }
  .empty {
    padding: 20px 10px; text-align: center; color: var(--ghost);
  }
  .empty .pulse { animation: pulse 3s ease-in-out infinite; }
  @keyframes pulse  { 0%,100% { opacity:1; } 50% { opacity:0.35; } }
  @keyframes fadeIn  { from { opacity:0; transform:translateY(-3px); } to { opacity:1; } }
  @keyframes fadeOut { from { opacity:1; } to { opacity:0; transform:translateY(3px); } }
</style></head><body>
  <header>
    <span class="title">agentprobe</span>
    <span class="badge" id="badge">0</span>
  </header>
  <div id="agents"><div class="empty"><span class="pulse">watching...</span></div></div>
  <script>
    var prev = "";
    var ids = {};
    function ago(ts, now) {
      var s = Math.max(0, Math.floor((now - ts) / 1000));
      return s < 60 ? s + "s" : s < 3600 ? Math.floor(s / 60) + "m" : Math.floor(s / 3600) + "h";
    }
    function dur(started, now) {
      if (!started) return "";
      var s = Math.max(0, Math.floor((now - started) / 1000));
      if (s < 60) return s + "s";
      var m = Math.floor(s / 60);
      return m < 60 ? m + "m" : Math.floor(m / 60) + "h" + (m % 60) + "m";
    }
    function meta(a, now) { var d = dur(a.startedAt, now); return ago(a.updatedAt, now) + (d ? " / " + d : ""); }
    function esc(s) { var e = document.createElement("span"); e.textContent = s; return e.innerHTML; }
    function safe(s) { return s.replace(/[^a-z0-9-]/gi, ""); }
    function card(a, now, fresh) {
      var cls = "agent" + (a.leaving ? " leaving" : fresh ? " entering" : "");
      return '<div class="' + cls + '">'
        + '<div class="row"><span class="source"><span class="dot ' + safe(a.status) + '"></span>' + esc(a.label) + '</span>'
        + '<span class="meta">' + meta(a, now) + '</span></div>'
        + '<div class="task">' + esc(a.task) + '</div></div>';
    }
    function render(agents, now) {
      var active = agents.filter(function(a) { return !a.leaving; }).length;
      document.getElementById("badge").textContent = active;
      var c = document.getElementById("agents");
      if (!agents.length) { c.innerHTML = '<div class="empty"><span class="pulse">watching...</span></div>'; prev = ""; ids = {}; return; }
      var k = agents.map(function(a) { return a.id + ":" + a.status + (a.leaving ? ":L" : ""); }).join(",");
      if (k === prev) { c.querySelectorAll(".meta").forEach(function(el, i) { if (agents[i]) el.textContent = meta(agents[i], now); }); return; }
      var old = ids; ids = {}; agents.forEach(function(a) { ids[a.id] = 1; });
      prev = k;
      c.innerHTML = agents.map(function(a) { return card(a, now, !old[a.id]); }).join("");
    }
  </script>
</body></html>`;

interface AgentView {
  readonly id: string;
  readonly status: CanonicalAgentStatus;
  readonly label: string;
  readonly task: string;
  readonly updatedAt: number;
  readonly startedAt: number | undefined;
  readonly leaving: boolean;
}

function toView(agent: CanonicalAgentSnapshot): AgentView {
  return {
    id: agent.id,
    status: agent.status,
    label: SOURCE_LABELS[agent.source] ?? agent.source,
    task: agent.taskSummary,
    updatedAt: agent.updatedAt,
    startedAt: agent.startedAt,
    leaving: false,
  };
}

function isStale(agent: CanonicalAgentSnapshot): boolean {
  if (agent.status !== "completed" && agent.status !== "error") return false;
  return Date.now() - agent.updatedAt > STALE_MS;
}

function windowHeight(count: number): number {
  if (count === 0) return HEADER_HEIGHT + EMPTY_HEIGHT;
  return Math.min(HEADER_HEIGHT + count * AGENT_ROW_HEIGHT, MAX_HEIGHT);
}

async function main(): Promise<void> {
  const agents = new Map<string, AgentView>();
  const observer = createObserver({ workspacePaths: workspaces });

  const win: GlimpseWindow = open(html, {
    width: WIDTH,
    height: windowHeight(0),
    frameless: true,
    transparent: true,
    floating: true,
    clickThrough,
  });

  win.on("error", (err: unknown) => console.error("glimpse:", err));

  const send = (): void => {
    const visible = [...agents.values()];
    win.send(`render(${JSON.stringify(visible)}, ${Date.now()})`);

    try {
      win.resize(WIDTH, windowHeight(visible.filter((a) => !a.leaving).length));
    } catch (_e: unknown) {
      // resize not supported on all versions
    }
  };

  const unsubscribe = observer.subscribe((event) => {
    if (isStale(event.agent)) return;

    if (event.change.kind === "left") {
      const existing = agents.get(event.agent.id);
      if (existing) {
        agents.set(event.agent.id, { ...existing, leaving: true });
        setTimeout(() => {
          if (agents.get(event.agent.id)?.leaving) {
            agents.delete(event.agent.id);
            send();
          }
        }, FADE_MS);
      }
    } else {
      agents.set(event.agent.id, toView(event.agent));
    }
    send();
  });

  win.on("ready", send);
  await observer.start();

  const ticker = setInterval(send, TICK_MS);

  console.log(
    `glimpse ${clickThrough ? "(click-through) " : ""}watching ${workspaces.join(", ")}...`,
  );

  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    clearInterval(ticker);
    unsubscribe();
    try {
      win.close();
    } catch (_e: unknown) {
      /* already closed */
    }
    try {
      await observer.stop();
    } catch (_e: unknown) {
      /* best effort */
    }
  };

  process.on("SIGINT", () => void shutdown());
  win.on("closed", () => void shutdown());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
