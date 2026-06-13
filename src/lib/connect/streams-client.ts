// Adapter around `amazon-connect-streams`. Initializes a (hidden) CCP iframe and
// exposes the bits the workspace needs: agent state, the current voice contact,
// mute/hold/hangup, and the remote (customer) audio stream that drives Transcribe.
//
// Falls back to a mock implementation when no Connect instance URL is configured
// so the UI is still usable in dev.

import "amazon-connect-streams";

import { loadAwsConfig } from "@/lib/aws/config";

// Monkey-patch RTCPeerConnection so we can grab the inbound (customer) audio
// stream off every peer connection the streams library creates. The
// softphoneManager API doesn't expose `_remoteAudioStream` reliably across
// versions, but `ontrack` is universal.
let capturedRemoteStream: MediaStream | null = null;
let capturedPeerConnection: RTCPeerConnection | null = null;
let rtcPatched = false;
function installRtcCapture() {
  if (rtcPatched || typeof window === "undefined") return;
  rtcPatched = true;
  const OriginalRTC = (window as any).RTCPeerConnection;
  if (!OriginalRTC) return;
  function PatchedRTC(this: any, ...args: any[]) {
    const pc = new OriginalRTC(...args);
    capturedPeerConnection = pc;
    pc.addEventListener("track", (ev: RTCTrackEvent) => {
      console.info("[streams] RTC ontrack — remote streams:", ev.streams.length);
      if (ev.streams && ev.streams[0]) {
        capturedRemoteStream = ev.streams[0];
      } else if (ev.track) {
        capturedRemoteStream = new MediaStream([ev.track]);
      }
      const audioEl = document.getElementById("paravoxis-remote-audio") as HTMLAudioElement | null;
      if (audioEl && capturedRemoteStream) {
        audioEl.srcObject = capturedRemoteStream;
        audioEl.play().catch(() => undefined);
      }
    });
    return pc;
  }
  PatchedRTC.prototype = OriginalRTC.prototype;
  Object.setPrototypeOf(PatchedRTC, OriginalRTC);
  (window as any).RTCPeerConnection = PatchedRTC;
}

// Loads the parent-side WebRTC engine (`connect-rtc.js`) once.
// Required when `allowFramedSoftphone: false` so the parent page can actually
// negotiate the WebRTC peer connection — without it, calls fail to connect.
let rtcLoadPromise: Promise<void> | null = null;
function ensureConnectRtcLoaded(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((globalThis as any).connect?.RTCSession) return Promise.resolve();
  if (rtcLoadPromise) return rtcLoadPromise;
  rtcLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/connect-rtc.js";
    script.async = true;
    script.onload = () => {
      console.info("[streams] connect-rtc.js loaded");
      resolve();
    };
    script.onerror = (e) => {
      console.error("[streams] failed to load connect-rtc.js", e);
      reject(new Error("Failed to load connect-rtc.js"));
    };
    document.head.appendChild(script);
  });
  return rtcLoadPromise;
}

// amazon-connect-streams attaches itself to `window.connect`. We access it via globalThis
// to avoid colliding with the local `connect()` method on the streams client.

export type AgentState = "offline" | "available" | "on-call" | "after-call";

export interface ConnectContact {
  contactId: string;
  callerNumber?: string;
  attributes: Record<string, string>;
  state: "connecting" | "connected" | "ended";
}

export interface StreamsClient {
  connect(container: HTMLElement): Promise<void>;
  setAgentState(state: Exclude<AgentState, "on-call" | "after-call">): Promise<void>;
  acceptContact(contactId: string): Promise<void>;
  hangup(contactId: string): Promise<void>;
  toggleMute(): Promise<boolean>;
  toggleHold(): Promise<boolean>;
  /** Customer-side `MediaStream` (the WebRTC remote audio). Available while a voice contact is active. */
  getCustomerAudioStream(): MediaStream | null;
  /** Agent → customer outbound audio sender. Used to swap the mic for Polly translation. */
  getAgentRtpSender(): RTCRtpSender | null;
  onAgentStateChange(cb: (state: AgentState) => void): () => void;
  onContact(cb: (contact: ConnectContact) => void): () => void;
}

const MOCK_INSTANCE_URL = "mock://no-instance-configured";

export function createStreamsClient(): StreamsClient {
  const cfg = loadAwsConfig();
  if (!cfg?.connectInstanceUrl || cfg.connectInstanceUrl.startsWith("mock://")) {
    return createMockStreamsClient();
  }
  return createRealStreamsClient(cfg.connectInstanceUrl);
}

function createRealStreamsClient(instanceUrl: string): StreamsClient {
  const agentListeners = new Set<(s: AgentState) => void>();
  const contactListeners = new Set<(c: ConnectContact) => void>();

  let agentState: AgentState = "offline";
  let currentContact: any | null = null;
  let currentConnectionId: string | null = null;
  let initialized = false;
  let muted = false;

  function emitAgent(state: AgentState) {
    agentState = state;
    agentListeners.forEach((l) => l(state));
  }
  function emitContact(c: ConnectContact) {
    contactListeners.forEach((l) => l(c));
  }

  function getAgentRtpSender(): RTCRtpSender | null {
    if (!capturedPeerConnection) return null;
    try {
      return capturedPeerConnection.getSenders().find((s) => s.track?.kind === "audio") ?? null;
    } catch {
      return null;
    }
  }

  function getCustomerAudioStream(): MediaStream | null {
    if (capturedRemoteStream && capturedRemoteStream.getAudioTracks().length > 0) {
      return capturedRemoteStream;
    }
    // Fallback to softphoneManager API (works on older streams versions).
    if (!currentConnectionId) return null;
    try {
      const core = (globalThis as any).connect?.core;
      const spm = core?.getSoftphoneManager?.() ?? core?.softphoneManager;
      const session = spm?.getSession?.(currentConnectionId);
      return session?._remoteAudioStream ?? null;
    } catch {
      return null;
    }
  }

  function bindAgent(agent: any) {
    agent.onStateChange(() => {
      const s = agent.getState()?.type;
      if (s === "routable") emitAgent("available");
      else if (s === "not_routable") emitAgent("after-call");
      else if (s === "offline") emitAgent("offline");
    });
    // Capture the active WebRTC connection ID so we can pull `_remoteAudioStream`
    // off the softphone session when transcription starts.
    agent.onLocalMediaStreamCreated?.((data: any) => {
      currentConnectionId = data?.connectionId ?? null;
      console.info("[streams] agent local media stream created", currentConnectionId);
    });
  }

  function bindContact(contact: any) {
    currentContact = contact;
    const contactId = contact.getContactId();
    console.info("[streams] new contact", contactId);
    const attrs = contact.getAttributes?.() ?? {};
    const normalizedAttrs: Record<string, string> = {};
    for (const [k, v] of Object.entries<any>(attrs)) {
      normalizedAttrs[k] = String(v?.value ?? v ?? "");
    }
    const callerNumber = contact.getInitialConnection?.()?.getEndpoint?.()?.phoneNumber;

    contact.onConnecting(() => {
      console.info("[streams] contact connecting (ringing)", contactId);
      emitContact({ contactId, callerNumber, attributes: normalizedAttrs, state: "connecting" });
    });
    contact.onConnected(() => {
      console.info("[streams] contact connected", contactId);
      emitAgent("on-call");
      emitContact({ contactId, callerNumber, attributes: normalizedAttrs, state: "connected" });
    });
    contact.onEnded(() => {
      console.info("[streams] contact ended", contactId);
      emitAgent("after-call");
      emitContact({ contactId, callerNumber, attributes: normalizedAttrs, state: "ended" });
      currentContact = null;
      currentConnectionId = null;
      muted = false;
    });
    // Also fire immediately if the contact arrived already-connecting
    const state = contact.getStatus?.()?.type ?? contact.getState?.()?.type;
    if (state === "connecting" || state === "incoming") {
      emitContact({ contactId, callerNumber, attributes: normalizedAttrs, state: "connecting" });
    }
  }

  return {
    async connect(container: HTMLElement) {
      if (initialized) return;
      initialized = true;
      installRtcCapture();
      await ensureConnectRtcLoaded();
      const c = (globalThis as any).connect;
      c.core.initCCP(container, {
        ccpUrl: `${instanceUrl}/connect/ccp-v2`,
        loginPopup: true,
        loginPopupAutoClose: true,
        region: loadAwsConfig()?.region,
        // CRITICAL: allowFramedSoftphone:false keeps the WebRTC peer connection in the
        // parent window so we can pull `_remoteAudioStream` off the softphone session.
        // With `true` the peer connection lives in the CCP iframe and is unreachable.
        softphone: { allowFramedSoftphone: false, disableRingtone: false },
      });

      c.agent((agent: any) => {
        console.info("[streams] CCP initialization completed, binding agent");
        try {
          c.core.initSoftphoneManager({ allowFramedSoftphone: true });
        } catch (err) {
          console.warn("[streams] initSoftphoneManager threw (may already be initialized)", err);
        }
        bindAgent(agent);
      });
      c.contact(bindContact);
      c.core.onSoftphoneSessionInit?.(({ connectionId }: { connectionId: string }) => {
        console.info("[streams] softphone session init", connectionId);
        currentConnectionId = connectionId;
      });
    },
    async setAgentState(state) {
      const map: Record<string, string> = { available: "Available", offline: "Offline" };
      const target = map[state];
      const agent = new (globalThis as any).connect.Agent();
      const next = agent.getAgentStates().find((s: any) => s.name === target);
      if (next) agent.setState(next);
    },
    async acceptContact() {
      const conn = currentContact?.getAgentConnection?.();
      if (!conn?.accept) {
        console.warn("[streams] acceptContact: no active connection to accept");
        return;
      }
      console.info("[streams] accepting contact");
      conn.accept({
        success: () => console.info("[streams] contact accepted"),
        failure: (err: any) => console.error("[streams] contact accept failed", err),
      });
    },
    async hangup() {
      currentContact?.getAgentConnection?.()?.destroy?.();
    },
    async toggleMute() {
      const agent = new (globalThis as any).connect.Agent();
      muted = !muted;
      muted ? agent.mute() : agent.unmute();
      return muted;
    },
    async toggleHold() {
      const conn = currentContact?.getActiveInitialConnection?.();
      if (!conn) return false;
      const isOnHold = conn.isOnHold?.();
      isOnHold ? conn.resume() : conn.hold();
      return !isOnHold;
    },
    getCustomerAudioStream,
    getAgentRtpSender,
    onAgentStateChange(cb) {
      agentListeners.add(cb);
      cb(agentState);
      return () => agentListeners.delete(cb);
    },
    onContact(cb) {
      contactListeners.add(cb);
      return () => contactListeners.delete(cb);
    },
  };
}

/** Kept so the workspace renders without AWS — used only when no instance URL is set. */
export function createMockStreamsClient(): StreamsClient {
  const agentListeners = new Set<(s: AgentState) => void>();
  const contactListeners = new Set<(c: ConnectContact) => void>();
  let agentState: AgentState = "offline";

  return {
    async connect() {
      agentState = "available";
      agentListeners.forEach((l) => l(agentState));
    },
    async setAgentState(state) {
      agentState = state;
      agentListeners.forEach((l) => l(agentState));
    },
    async acceptContact() {
      agentState = "on-call";
      agentListeners.forEach((l) => l(agentState));
    },
    async hangup() {
      agentState = "after-call";
      agentListeners.forEach((l) => l(agentState));
    },
    async toggleMute() {
      return false;
    },
    async toggleHold() {
      return false;
    },
    getCustomerAudioStream() {
      return null;
    },
    getAgentRtpSender() {
      return null;
    },
    onAgentStateChange(cb) {
      agentListeners.add(cb);
      cb(agentState);
      return () => agentListeners.delete(cb);
    },
    onContact(cb) {
      contactListeners.add(cb);
      return () => contactListeners.delete(cb);
    },
  };
}

export const MOCK_INSTANCE = MOCK_INSTANCE_URL;
