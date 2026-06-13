// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import fs from "node:fs";

// Dev-only: receive POSTs of browser console logs at /__browser_log and append
// them to /tmp/paravoxis-browser.log so they can be tailed without copy-pasting.
const LOG_PATH = "/tmp/paravoxis-browser.log";
function browserLogSinkPlugin() {
  return {
    name: "paravoxis-browser-log-sink",
    apply: "serve" as const,
    configureServer(server: any) {
      server.middlewares.use("/__browser_log", (req: any, res: any, next: any) => {
        if (req.method !== "POST") return next();
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk.toString()));
        req.on("end", () => {
          const line = `${new Date().toISOString()} ${body.replace(/\s+/g, " ").slice(0, 4000)}\n`;
          try {
            fs.appendFileSync(LOG_PATH, line);
          } catch {
            /* noop */
          }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      // microphone-stream depends on readable-stream which needs Node's events/util/stream.
      // Without these polyfills, instantiating MicrophoneStream throws and the entire
      // Transcribe pipeline dies before making a single AWS call.
      nodePolyfills({
        include: ["buffer", "events", "util", "stream", "process"],
        globals: { Buffer: true, process: true },
      }),
      browserLogSinkPlugin(),
    ],
  },
});
