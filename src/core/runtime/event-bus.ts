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
}

export interface EventBus<TEvent extends { type: string }> {
  dispatch(event: TEvent, token: number): void;
  clear(): void;
}

export function createEventBus<TEvent extends { type: string }>(
  options: EventBusOptions<TEvent>,
): EventBus<TEvent> {
  const { handlers, getToken } = options;
  const queue: TEvent[] = [];
  let isProcessing = false;

  async function processQueue(): Promise<void> {
    if (isProcessing) {
      return;
    }
    isProcessing = true;

    while (queue.length > 0) {
      const event = queue.shift();
      if (event === undefined) {
        continue;
      }
      const handler = handlers[event.type];
      if (!handler) {
        continue;
      }

      try {
        await handler(event);
      } catch {
        // Handler errors must not crash the bus.
      }
    }

    isProcessing = false;
  }

  return {
    dispatch(event: TEvent, token: number): void {
      if (token !== getToken()) {
        return;
      }
      queue.push(event);
      void processQueue();
    },

    clear(): void {
      queue.length = 0;
    },
  };
}
