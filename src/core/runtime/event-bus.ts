import { toError } from "@/core/errors";

export const RUNTIME_BUS_EVENT_TYPES = {
  fileChanged: "file-changed",
  checkIdle: "check-idle",
  refreshRequested: "refresh-requested",
} as const;

export type RuntimeBusEventType =
  (typeof RUNTIME_BUS_EVENT_TYPES)[keyof typeof RUNTIME_BUS_EVENT_TYPES];

export interface EventBusOptions<TEvent extends { type: string }> {
  handlers: Record<string, (event: TEvent) => Promise<void> | void>;
  getToken: () => number;
  onHandlerError?: (error: Error) => void;
}

export interface EventBus<TEvent extends { type: string }> {
  dispatch(event: TEvent, token: number): void;
  clear(): void;
}

interface BusState<TEvent> {
  readonly queue: TEvent[];
  processing: boolean;
}

async function processQueue<TEvent extends { type: string }>(
  state: BusState<TEvent>,
  options: EventBusOptions<TEvent>,
): Promise<void> {
  if (state.processing) {
    return;
  }
  state.processing = true;

  while (state.queue.length > 0) {
    const event = state.queue.shift();
    if (event === undefined) {
      continue;
    }
    const handler = options.handlers[event.type];
    if (!handler) {
      continue;
    }

    try {
      await handler(event);
    } catch (error) {
      // Handler errors must not crash the bus — a failing handler would block all
      // subsequent events in the queue, causing the runtime to silently stop responding.
      options.onHandlerError?.(toError(error));
    }
  }

  state.processing = false;
}

export function createEventBus<TEvent extends { type: string }>(
  options: EventBusOptions<TEvent>,
): EventBus<TEvent> {
  const { getToken } = options;
  const state: BusState<TEvent> = { queue: [], processing: false };

  return {
    dispatch(event: TEvent, token: number): void {
      if (token !== getToken()) {
        return;
      }
      state.queue.push(event);
      void processQueue(state, options);
    },

    clear(): void {
      state.queue.length = 0;
    },
  };
}
