// Tracks who currently "has the floor" so we don't translate over each other.
import type { Speaker } from "./types";

export class TurnManager {
  private active: Speaker | null = null;
  private lastChangeAt = 0;

  beginSpeaking(speaker: Speaker, at = Date.now()): boolean {
    if (this.active && this.active !== speaker) {
      // The other side started speaking — barge-in. Allow handover after 250ms.
      if (at - this.lastChangeAt < 250) return false;
    }
    this.active = speaker;
    this.lastChangeAt = at;
    return true;
  }

  endSpeaking(speaker: Speaker, at = Date.now()) {
    if (this.active === speaker) {
      this.active = null;
      this.lastChangeAt = at;
    }
  }

  current(): Speaker | null {
    return this.active;
  }
}
