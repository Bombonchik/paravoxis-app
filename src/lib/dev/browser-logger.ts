// Dev-only console patch that forwards key logs to the Vite dev server so the
// developer (or an AI assistant tailing the file) can see them without the user
// pasting from DevTools. Only forwards lines tagged with one of our known
// prefixes — keeps the noise out.

const FORWARDED_PREFIXES = [
  "[tts/",
  "[live-translator]",
  "[streams]",
  "[workspace]",
  "[transcribe]",
  "[polly]",
];

function stringifyArg(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function shouldForward(args: unknown[]): boolean {
  const first = args[0];
  if (typeof first !== "string") return false;
  return FORWARDED_PREFIXES.some((p) => first.startsWith(p));
}

let installed = false;
export function installBrowserLogger(): void {
  if (installed || typeof window === "undefined") return;
  if (!(import.meta as unknown as { env: { DEV: boolean } }).env.DEV) return;
  installed = true;
  const orig = { info: console.info, warn: console.warn, error: console.error };

  function ship(level: "info" | "warn" | "error", args: unknown[]) {
    try {
      const text = args.map(stringifyArg).join(" ");
      // fire-and-forget
      void fetch("/__browser_log", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: `[${level}] ${text}`,
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      /* noop */
    }
  }

  console.info = (...args: unknown[]) => {
    orig.info(...args);
    if (shouldForward(args)) ship("info", args);
  };
  console.warn = (...args: unknown[]) => {
    orig.warn(...args);
    if (shouldForward(args)) ship("warn", args);
  };
  console.error = (...args: unknown[]) => {
    orig.error(...args);
    if (shouldForward(args)) ship("error", args);
  };
}
