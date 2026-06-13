// Demo-grade AWS configuration. Stored in localStorage on the agent's machine.
// Production should swap this for a Cognito Identity Pool (see AWS sample CDK stack).

export interface AwsRuntimeConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  connectInstanceUrl: string;
}

const STORAGE_KEY = "paravoxis.aws.config";

export function loadAwsConfig(): AwsRuntimeConfig | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as AwsRuntimeConfig;
    } catch {
      /* fall through to env fallback */
    }
  }
  return loadAwsConfigFromEnv();
}

function loadAwsConfigFromEnv(): AwsRuntimeConfig | null {
  // Vite-exposed env vars (must be prefixed VITE_ to reach the browser bundle).
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const accessKeyId = env.VITE_AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.VITE_AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: env.VITE_AWS_SESSION_TOKEN || undefined,
    region: env.VITE_AWS_REGION || "us-east-1",
    connectInstanceUrl: (env.VITE_CONNECT_INSTANCE_URL || "").replace(/\/$/, ""),
  };
}

export function saveAwsConfig(cfg: AwsRuntimeConfig): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function clearAwsConfig(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function requireAwsConfig(): AwsRuntimeConfig {
  const cfg = loadAwsConfig();
  if (!cfg) throw new Error("AWS configuration missing — set it in Settings → AWS.");
  if (!cfg.region || !cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error("AWS credentials are incomplete — re-enter them in Settings.");
  }
  return cfg;
}

export function awsCredentials(cfg: AwsRuntimeConfig) {
  return {
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    sessionToken: cfg.sessionToken || undefined,
  };
}
