// Thin wrapper around amazon-connect-streams. Loaded only in the browser.
// The SDK is added in a later phase; for now this module exposes the API surface
// the rest of the app will depend on, with a mock fallback so the workspace UI
// can render before AWS is wired up.

export type AgentState = "offline" | "available" | "on-call" | "after-call";

export interface ConnectContact {
  contactId: string;
  callerNumber?: string;
  attributes: Record<string, string>;
  state: "connecting" | "connected" | "ended";
}

export interface StreamsClient {
  connect(instanceUrl: string, container: HTMLElement): Promise<void>;
  setAgentState(state: Exclude<AgentState, "on-call" | "after-call">): Promise<void>;
  acceptContact(contactId: string): Promise<void>;
  hangup(contactId: string): Promise<void>;
  onAgentStateChange(cb: (state: AgentState) => void): () => void;
  onContact(cb: (contact: ConnectContact) => void): () => void;
}

/**
 * Mock implementation. Replaced by the real `amazon-connect-streams` adapter
 * in phase 2 once AWS credentials + Connect instance URL are configured.
 */
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
