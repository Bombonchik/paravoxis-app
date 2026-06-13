# `lib/connect` — Amazon Connect integration

This folder owns everything that talks to **Amazon Connect** from the browser.

- `streams-client.ts` — wraps `amazon-connect-streams` (headless CCP); exposes
  agent state, contact lifecycle, accept/hangup/mute. Ships with a mock
  implementation so the UI runs before AWS is wired up.
- `contact-events.ts` — (phase 2) subscriptions for `onConnecting`, `onConnected`,
  `onEnded`, contact attribute reads.
- `kvs/` — (phase 5) Kinesis Video Streams consumer that pipes caller audio to
  the server WebSocket.
- `tts-injector.ts` — (phase 4/5) plays translated TTS into the agent headset
  (and, in phase 6, into the call via Chime Voice Connector).

`features/agent-workspace` is the only consumer.
