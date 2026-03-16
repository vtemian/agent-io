import type { LifecycleSnapshot, WatchLifecycleEvent } from "./types";
import { WATCH_LIFECYCLE_KIND } from "./types";

function classifyAgent<TAgent, TStatus extends string>(
  agent: TAgent,
  snapshot: LifecycleSnapshot<TAgent, TStatus>,
  previousStatusById: Map<string, TStatus>,
  at: number,
): WatchLifecycleEvent<TStatus> {
  const agentId = snapshot.getId(agent);
  const nextStatus = snapshot.getStatus(agent);
  const previousStatus = previousStatusById.get(agentId);

  if (previousStatus === undefined) {
    return {
      kind: WATCH_LIFECYCLE_KIND.joined,
      agentId,
      at,
      fromStatus: null,
      toStatus: nextStatus,
    };
  }

  if (previousStatus !== nextStatus) {
    return {
      kind: WATCH_LIFECYCLE_KIND.statusChanged,
      agentId,
      at,
      fromStatus: previousStatus,
      toStatus: nextStatus,
    };
  }

  return {
    kind: WATCH_LIFECYCLE_KIND.heartbeat,
    agentId,
    at,
    fromStatus: previousStatus,
    toStatus: nextStatus,
  };
}

function detectLeftAgents<TStatus extends string>(
  previousStatusById: Map<string, TStatus>,
  nextStatusById: Map<string, TStatus>,
  at: number,
): WatchLifecycleEvent<TStatus>[] {
  const events: WatchLifecycleEvent<TStatus>[] = [];
  for (const [agentId, previousStatus] of previousStatusById.entries()) {
    if (!nextStatusById.has(agentId)) {
      events.push({
        kind: WATCH_LIFECYCLE_KIND.left,
        agentId,
        at,
        fromStatus: previousStatus,
        toStatus: null,
      });
    }
  }
  return events;
}

function mapAgents<TAgent, TStatus extends string>(
  currentAgents: TAgent[],
  snapshot: LifecycleSnapshot<TAgent, TStatus>,
  previousStatusById: Map<string, TStatus>,
  at: number,
): { events: WatchLifecycleEvent<TStatus>[]; nextStatusById: Map<string, TStatus> } {
  const events: WatchLifecycleEvent<TStatus>[] = [];
  const nextStatusById = new Map<string, TStatus>();

  for (const agent of currentAgents) {
    const agentId = snapshot.getId(agent);
    nextStatusById.set(agentId, snapshot.getStatus(agent));
    events.push(classifyAgent(agent, snapshot, previousStatusById, at));
  }

  events.push(...detectLeftAgents(previousStatusById, nextStatusById, at));
  return { events, nextStatusById };
}

export function createLifecycleMapper<TAgent, TStatus extends string>(
  snapshot: LifecycleSnapshot<TAgent, TStatus>,
): {
  map(currentAgents: TAgent[], at?: number): WatchLifecycleEvent<TStatus>[];
  reset(): void;
} {
  let previousStatusById = new Map<string, TStatus>();

  return {
    map(currentAgents: TAgent[], at: number = Date.now()): WatchLifecycleEvent<TStatus>[] {
      const result = mapAgents(currentAgents, snapshot, previousStatusById, at);
      previousStatusById = result.nextStatusById;
      return result.events;
    },
    reset(): void {
      previousStatusById.clear();
    },
  };
}
