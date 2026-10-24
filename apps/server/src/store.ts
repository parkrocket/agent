import { MAX_RECENT_EVENTS, type OfficeEvent } from "@ai-office/shared";

/** In-memory ring buffer of recent events, replayed to clients on connect. */
export class EventStore {
  private events: OfficeEvent[] = [];

  constructor(private readonly capacity = MAX_RECENT_EVENTS) {}

  add(event: OfficeEvent): void {
    this.events.push(event);
    if (this.events.length > this.capacity) {
      this.events.splice(0, this.events.length - this.capacity);
    }
  }

  recent(): OfficeEvent[] {
    return [...this.events].sort((a, b) => a.ts - b.ts);
  }
}
