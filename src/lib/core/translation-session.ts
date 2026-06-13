// Framework-agnostic state machine for a single live translated call.
// UI subscribes via `subscribe(listener)`; AWS/AI integration code feeds it events.
import type { CallSession, Speaker, TranscriptSegment } from "./types";
import { TurnManager } from "./turn-manager";

type Listener = (session: CallSession) => void;

export class TranslationSession {
  private state: CallSession;
  private listeners = new Set<Listener>();
  readonly turns = new TurnManager();

  constructor(init: Omit<CallSession, "segments" | "startedAt"> & Partial<Pick<CallSession, "startedAt">>) {
    this.state = {
      ...init,
      startedAt: init.startedAt ?? Date.now(),
      segments: [],
    };
  }

  get snapshot(): CallSession {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  upsertSegment(segment: TranscriptSegment) {
    const existing = this.state.segments.findIndex((s) => s.id === segment.id);
    const next = [...this.state.segments];
    if (existing >= 0) next[existing] = { ...next[existing], ...segment };
    else next.push(segment);
    this.state = { ...this.state, segments: next };
    this.emit();
  }

  setLanguage(speaker: Speaker, language: string) {
    this.state =
      speaker === "caller"
        ? { ...this.state, callerLanguage: language }
        : { ...this.state, agentLanguage: language };
    this.emit();
  }

  private emit() {
    for (const l of this.listeners) l(this.state);
  }
}
