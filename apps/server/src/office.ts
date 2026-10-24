import { EMPTY_OFFICE, compactPods, reduceOffice, sweepOffDuty, type OfficeEvent, type OfficeState, type OfficeUpdate } from "@ai-office/shared";

/** Current office (sessions + rooms), derived from events by the shared reducer. */
export class OfficeRegistry {
  state: OfficeState = EMPTY_OFFICE;

  apply(event: OfficeEvent): OfficeUpdate {
    const update = reduceOffice(this.state, event);
    this.state = update.state;
    return update;
  }

  /** Closes pod holes; call only before any client is connected. */
  compact(): void {
    this.state = compactPods(this.state);
  }

  /** Sends idle sessions home; true when anything changed. */
  sweep(now: number, offDutyMs: number): boolean {
    const next = sweepOffDuty(this.state, now, offDutyMs);
    const changed = next !== this.state;
    this.state = next;
    return changed;
  }
}
