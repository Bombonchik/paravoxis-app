## Goal

Build a custom agent workspace that extends Amazon Connect with bidirectional real-time voice translation. Caller speech (auto-detected language, e.g. Czech) is transcribed, translated to the agent's language (e.g. Hindi), and spoken back; the agent's spoken reply is transcribed, translated to the caller's language, and injected back into the call.

## Architecture overview

```text
┌──────────────────────────────────────────────────────────┐
│  Browser (Agent)                                         │
│  ┌────────────────────────────────────────────────────┐  │
│  │  src/features/agent-workspace  (UI)                │  │
│  │   - Softphone controls (accept/hangup/mute/hold)   │  │
│  │   - Live transcript (caller + agent, both langs)   │  │
│  │   - Language selector, contact attributes panel    │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  src/lib/connect/agent  (Amazon integration)       │  │
│  │   - amazon-connect-streams (headless, no CCP UI)   │  │
│  │   - Contact/Agent event subscriptions              │  │
│  │   - Mic capture → WebSocket to server              │  │
│  │   - Translated TTS audio → WebAudio playback       │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  src/lib/core  (business logic, isomorphic)        │  │
│  │   - Translation session state machine              │  │
│  │   - Turn-taking, partial vs final segments         │  │
│  │   - Language pair resolution + glossary hooks      │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
                │  WebSocket / server fns
                ▼
┌──────────────────────────────────────────────────────────┐
│  TanStack server (src/routes/api/*, src/lib/*.server)    │
│   - /api/stt-stream  (WS): PCM → Transcribe streaming    │
│   - /api/tts          (POST): text → Polly MP3/PCM       │
│   - /api/translate    (POST): Lovable AI Gateway         │
│   - /api/connect/token: STS creds for Streams SDK        │
│   - /api/kvs-consumer (WS): caller audio from KVS        │
└──────────────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────┐
│  AWS                                                     │
│   - Amazon Connect instance (Live Media Streaming on)    │
│   - Kinesis Video Streams (caller audio)                 │
│   - Transcribe streaming (auto language ID)              │
│   - Polly Neural (TTS, incl. hi-IN, cs-CZ)               │
│  Lovable AI Gateway                                      │
│   - Gemini for translation (handles Czech↔Hindi well)    │
└──────────────────────────────────────────────────────────┘
```

## Repo layout (single app, modular folders)

```text
src/
  features/
    agent-workspace/        # UI: softphone, transcript, controls
    settings/               # Connect instance + language prefs
  lib/
    connect/                # Amazon Connect integration
      streams-client.ts     # amazon-connect-streams init (headless)
      contact-events.ts     # subscribe to contact lifecycle
      kvs/                  # Kinesis Video Streams audio consumer
      tts-injector.ts       # play translated TTS to agent
    core/                   # Business logic (framework-agnostic)
      translation-session.ts
      turn-manager.ts
      language-detect.ts
      types.ts
    aws/                    # *.server.ts wrappers
      transcribe.server.ts
      polly.server.ts
      kvs.server.ts
      sts.server.ts
    ai/
      translate.functions.ts  # Lovable AI Gateway translation
    shared/
      schemas.ts            # zod schemas shared client/server
      constants.ts
  routes/
    index.tsx               # login / instance picker
    _authenticated/
      workspace.tsx         # main agent UI
      settings.tsx
    api/
      stt-stream.ts         # WS: agent mic → Transcribe
      kvs-stream.ts         # WS: caller audio → Transcribe
      tts.ts                # POST: Polly synth
      translate.ts          # POST: translation
      connect/
        token.ts            # STS short-lived creds for browser SDK
```

Clear seams: `features/*` only imports from `lib/core` and `lib/connect`; `lib/core` is pure TS, no AWS/React; `lib/aws/*` and `lib/ai/*` are server-only.

## Real-time voice flow

**Caller → Agent (Czech → Hindi)**
1. Connect contact connects; Live Media Streaming pushes caller audio to KVS.
2. Server WS handler (`/api/kvs-stream`) reads KVS fragments, decodes to PCM, pipes to Transcribe streaming with `IdentifyLanguage=true` (or fixed source).
3. Transcribe partial/final results stream back to the browser over the same WS.
4. On each final segment, browser calls `/api/translate` (Gemini via Lovable AI Gateway) → Hindi text.
5. Browser calls `/api/tts` (Polly Neural, `Kajal`/`Aditi`) → audio bytes.
6. `tts-injector` plays the audio in the agent's headset only (not back into the call).

**Agent → Caller (Hindi → Czech)**
1. Browser captures mic via `getUserMedia` (separate from Connect's call audio).
2. PCM streamed over WS to `/api/stt-stream` → Transcribe (Hindi).
3. Final segment → translate to Czech → Polly (`Jakub` voice) → audio.
4. Inject translated audio into the live call. Two options, decide at implementation: (a) Connect Chat-to-Voice / Contact Flow "Play prompt" via API — limited latency; (b) Custom SIP media bridge using Amazon Chime SDK Voice Connector. **Recommend (b)** for true low-latency interjection; we'll prototype (a) first as a fallback.

Turn manager in `lib/core` prevents the agent from being translated while the caller is mid-utterance and vice versa.

## Amazon Connect integration specifics

- Use `amazon-connect-streams` in **headless mode** (`ccpLoadTimeout`, hide iframe via CSS) so we control all UI but still get contact/agent state, accept/hangup, mute, hold, and CCP audio device routing.
- Subscribe to `contact.onConnecting`, `onConnected`, `onEnded`; read contact attributes (set `caller_language` in the contact flow when known).
- STS-vended short-lived credentials served from `/api/connect/token` (never ship long-lived AWS keys to browser).

## Auth & roles

- Lovable Cloud auth (email/password to start), `app_role` enum with `agent` and `supervisor`.
- `_authenticated` layout gate; `/workspace` requires `agent`; `/settings` requires `supervisor`.
- `profiles` table (display name, default agent language, Connect username mapping).

## Secrets needed

Workspace-level: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (or an assumable role ARN), `CONNECT_INSTANCE_ID`, `CONNECT_INSTANCE_URL`, `KVS_STREAM_PREFIX`. Lovable provisions `LOVABLE_API_KEY` automatically.

## Build phases

1. **Scaffold + auth.** Modular folders, Lovable Cloud, roles, profiles, `_authenticated/workspace` shell, settings page.
2. **Headless Connect.** Streams SDK init, login flow, contact state UI, accept/hangup/mute. No translation yet.
3. **Translation server primitives.** `/api/translate` (Lovable AI Gemini), `/api/tts` (Polly), unit-tested with fixtures.
4. **Agent → Caller path.** Mic capture, WS to Transcribe, translate, Polly. Inject via Contact Flow "Play prompt" (latency-tolerant prototype).
5. **Caller → Agent path.** Enable Live Media Streaming, KVS consumer WS, Transcribe streaming with language ID, headset-only TTS playback.
6. **Low-latency injection upgrade.** Chime SDK Voice Connector bridge for sub-second agent-side injection.
7. **Transcript UI + supervisor view.** Persist transcripts to Lovable Cloud, supervisor live monitor.

Each phase ends with a runnable demo. We'll stop after phase 2 for review before wiring real AWS.

## Open items I'll confirm during implementation

- Whether you already have an Amazon Connect instance + IAM user/role with Transcribe/Translate/Polly/KVS/Chime permissions, or want me to document the AWS console steps.
- Agent-side audio injection mechanism (Contact Flow prompt vs Chime Voice Connector) — I'll prototype the simpler one first and we'll measure latency.
- Exact Polly voices per language and whether the caller should hear the agent's original voice ducked under translated TTS, or fully replaced.
