// Amazon Polly — synthesize a translated string to MP3 we can play in an <audio> element.
import { PollyClient, SynthesizeSpeechCommand, type Engine } from "@aws-sdk/client-polly";
import { awsCredentials, requireAwsConfig, type AwsRuntimeConfig } from "./config";
import { SUPPORTED_LANGUAGES } from "@/lib/shared/constants";

let cached: PollyClient | null = null;
let cachedFor: string | null = null;

function getClient(cfg: AwsRuntimeConfig): PollyClient {
  const key = `${cfg.region}:${cfg.accessKeyId}`;
  if (cached && cachedFor === key) return cached;
  cached?.destroy();
  cached = new PollyClient({ region: cfg.region, credentials: awsCredentials(cfg) });
  cachedFor = key;
  return cached;
}

// Some Polly voices only support the "standard" engine (e.g. Czech "Jakub" has
// no neural variant). Picking the wrong engine returns a 400. Listed by VoiceId.
const NEURAL_VOICES = new Set(["Joanna", "Amy", "Vicki", "Lucia", "Lea", "Camila", "Bianca", "Hala", "Kajal", "Kazuha"]);

export async function synthesize(languageCode: string, text: string): Promise<Blob | null> {
  if (!text.trim()) return null;
  const voice = SUPPORTED_LANGUAGES.find((l) => l.code === languageCode)?.pollyVoice;
  if (!voice) return null;
  const engine: Engine = NEURAL_VOICES.has(voice) ? ("neural" as Engine) : ("standard" as Engine);

  const cfg = requireAwsConfig();
  const client = getClient(cfg);
  try {
    const response = await client.send(
      new SynthesizeSpeechCommand({
        OutputFormat: "mp3",
        Text: text,
        VoiceId: voice as never,
        Engine: engine,
        LanguageCode: languageCode as never,
      }),
    );
    if (!response.AudioStream) return null;
    const bytes = await response.AudioStream.transformToByteArray();
    return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
      type: "audio/mpeg",
    });
  } catch (err) {
    console.error("[polly] synthesize failed", { languageCode, voice, engine, err });
    return null;
  }
}
