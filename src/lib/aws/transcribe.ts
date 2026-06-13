// Wrapper around AWS Transcribe Streaming. Each call opens an HTTP/2 stream
// and yields partial + final transcripts back through callbacks.
import {
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient,
  type Item,
} from "@aws-sdk/client-transcribe-streaming";
import { awsCredentials, requireAwsConfig, type AwsRuntimeConfig } from "./config";
import { toAudioEventStream, wrapMediaStream } from "./transcribe-utils";

export type TranscribeStability = "high" | "medium" | "low" | "none";

export interface TranscribeOptions {
  languageCode: string;
  sampleRate: number;
  partialStability?: TranscribeStability;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  signal?: AbortSignal;
}

let cachedClient: TranscribeStreamingClient | null = null;
let cachedFor: string | null = null;

function getClient(cfg: AwsRuntimeConfig): TranscribeStreamingClient {
  const key = `${cfg.region}:${cfg.accessKeyId}`;
  if (cachedClient && cachedFor === key) return cachedClient;
  cachedClient?.destroy();
  cachedClient = new TranscribeStreamingClient({
    region: cfg.region,
    credentials: awsCredentials(cfg),
  });
  cachedFor = key;
  return cachedClient;
}

export async function startStreamingTranscription(
  mediaStream: MediaStream,
  opts: TranscribeOptions,
): Promise<() => void> {
  const cfg = requireAwsConfig();
  const client = getClient(cfg);
  const micStream = wrapMediaStream(mediaStream);
  const enableStability = opts.partialStability && opts.partialStability !== "none";

  const command = new StartStreamTranscriptionCommand({
    LanguageCode: opts.languageCode as never,
    MediaEncoding: "pcm",
    MediaSampleRateHertz: opts.sampleRate,
    AudioStream: toAudioEventStream(micStream, opts.sampleRate),
    EnablePartialResultsStabilization: enableStability,
    PartialResultsStability: enableStability ? (opts.partialStability as "high" | "medium" | "low") : undefined,
  });

  console.info("[transcribe] opening stream", { languageCode: opts.languageCode, sampleRate: opts.sampleRate });
  const response = await client.send(command, { abortSignal: opts.signal });
  console.info("[transcribe] stream open");

  let lastProcessedIndex = 0;
  const pump = (async () => {
    try {
      for await (const event of response.TranscriptResultStream ?? []) {
        if (opts.signal?.aborted) break;
        const results = event.TranscriptEvent?.Transcript?.Results ?? [];
        if (results.length > 0) {
          console.debug("[transcribe] event", { partial: results[0].IsPartial, items: results[0].Alternatives?.[0]?.Items?.length });
        }
        const partial = readPartial(results, lastProcessedIndex);
        if (partial) opts.onPartial(partial);
        const final = readFinal(results, lastProcessedIndex, !!enableStability);
        if (final) {
          lastProcessedIndex = final.nextIndex;
          opts.onFinal(final.text);
        }
      }
      console.info("[transcribe] stream closed");
    } catch (err) {
      if (!opts.signal?.aborted) console.error("[transcribe] stream error", err);
    }
  })();

  return () => {
    try {
      micStream.stop();
      micStream.destroy();
    } catch {
      /* noop */
    }
    void pump;
  };
}

function readPartial(results: any[], lastProcessedIndex: number): string | null {
  if (!results.length || results[0].IsPartial !== true) return null;
  const items = (results[0].Alternatives?.[0]?.Items ?? []) as Item[];
  if (!items.length) return null;
  return joinItems(items, lastProcessedIndex);
}

function readFinal(
  results: any[],
  lastProcessedIndex: number,
  stabilization: boolean,
): { text: string; nextIndex: number } | null {
  if (!results.length) return null;
  if (results[0].IsPartial === true && !stabilization) return null;

  if (results[0].IsPartial === false) {
    const items = (results[0].Alternatives?.[0]?.Items ?? []) as Item[];
    if (!items.length) return null;
    return { text: joinItems(items, lastProcessedIndex), nextIndex: 0 };
  }

  // stabilized-partial path: cut at the first stable punctuation after the cursor
  const items = (results[0].Alternatives?.[0]?.Items ?? []) as Item[];
  const endIdx = items.findIndex(
    (item, index) =>
      index >= lastProcessedIndex &&
      item.Type === "punctuation" &&
      [",", ".", "!", "?"].includes(item.Content ?? ""),
  );
  if (endIdx === -1) return null;
  const segment = items.slice(lastProcessedIndex, endIdx + 1);
  if (!segment.every((item) => item.Stable === true)) return null;
  return { text: joinItems(segment, 0), nextIndex: endIdx + 1 };
}

function joinItems(items: Item[], from: number): string {
  return items
    .slice(from)
    .map((item) => item.Content ?? "")
    .join(" ")
    .trim()
    .replace(/\s+([.,!?])/g, "$1");
}
