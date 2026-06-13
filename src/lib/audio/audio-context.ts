// Lazy singleton AudioContext + a hardware-sample-rate probe.
// AudioContexts can't be created before a user gesture in most browsers — we
// instantiate lazily from the workspace's "Connect" button.

let ctx: AudioContext | null = null;

export async function getAudioContext(): Promise<AudioContext> {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") await ctx.resume();
  return ctx;
}

/** The real hardware sample rate, even if the cached context was created at a different rate. */
export function probeSampleRate(): number {
  const probe = new AudioContext();
  const rate = probe.sampleRate;
  void probe.close();
  return rate;
}

export async function disposeAudioContext(): Promise<void> {
  if (ctx) await ctx.close();
  ctx = null;
}
