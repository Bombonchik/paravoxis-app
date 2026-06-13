# `lib/core` — Business logic

Framework-agnostic TypeScript. **No React, no AWS, no fetch.** Pure data and
state machines so they can be unit-tested in isolation and reused on the
server.

- `types.ts` — shared types: `Speaker`, `TranscriptSegment`, `CallSession`.
- `turn-manager.ts` — barge-in / floor control between caller and agent.
- `translation-session.ts` — observable per-call state container.
