import { reduceSessions, type OfficeEvent, type SessionMap, type SessionState } from "@ai-office/shared";

/** Current per-session office state, derived from events by the shared reducer. */
export class SessionRegistry {
  private sessions: SessionMap = {};

  apply(event: OfficeEvent): SessionState {
    this.sessions = reduceSessions(this.sessions, event);
    return this.sessions[event.sessionId]!;
  }

  all(): SessionMap {
    return this.sessions;
  }
}
