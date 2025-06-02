import { isRegistryInitComplete } from "../types/registryState";

interface QueuedEvent {
  args: any[];
  handler: (...args: any[]) => Promise<void>;
}

class EventQueue {
  private static instance: EventQueue;
  private queue: QueuedEvent[] = [];
  private processing = false;
  private eventProcessingEnabled = false;

  private constructor() {}

  public static getInstance(): EventQueue {
    if (!EventQueue.instance) {
      EventQueue.instance = new EventQueue();
    }
    return EventQueue.instance;
  }

  public enableEventProcessing() {
    this.eventProcessingEnabled = true;
  }

  public async enqueue(
    handler: (...args: any[]) => Promise<void>,
    args: any[]
  ) {
    // Always queue events during initialization
    if (!this.eventProcessingEnabled) {
      this.queue.push({ args, handler });
      return;
    }

    if (isRegistryInitComplete()) {
      // If registry is already initialized and processing is enabled, process immediately
      await handler(...args);
    } else {
      // Otherwise, queue for later
      this.queue.push({ args, handler });
    }
  }

  public async processQueue() {
    if (
      this.processing ||
      this.queue.length === 0 ||
      !this.eventProcessingEnabled
    ) {
      return;
    }

    this.processing = true;

    // Process events sequentially to avoid nonce conflicts
    while (this.queue.length > 0) {
      const event = this.queue.shift();
      if (event) {
        try {
          await event.handler(...event.args);
        } catch (error) {
          console.error("Error processing queued event:", error);
        }
      }
    }

    this.processing = false;
  }
}

export const eventQueue = EventQueue.getInstance();
