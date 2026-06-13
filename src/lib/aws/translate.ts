// Amazon Translate wrapper. Direct browser call — same pattern as the AWS V2V sample.
import { TranslateClient, TranslateTextCommand } from "@aws-sdk/client-translate";
import { awsCredentials, requireAwsConfig, type AwsRuntimeConfig } from "./config";

let cached: TranslateClient | null = null;
let cachedFor: string | null = null;

function getClient(cfg: AwsRuntimeConfig): TranslateClient {
  const key = `${cfg.region}:${cfg.accessKeyId}`;
  if (cached && cachedFor === key) return cached;
  cached?.destroy();
  cached = new TranslateClient({ region: cfg.region, credentials: awsCredentials(cfg) });
  cachedFor = key;
  return cached;
}

/** Translate. `source` accepts "auto" for auto-detection (Translate's `auto`). */
export async function translate(source: string, target: string, text: string): Promise<string> {
  if (!text.trim()) return "";
  const cfg = requireAwsConfig();
  const client = getClient(cfg);
  const response = await client.send(
    new TranslateTextCommand({
      Text: text,
      SourceLanguageCode: toTranslateLang(source),
      TargetLanguageCode: toTranslateLang(target),
    }),
  );
  return response.TranslatedText ?? "";
}

/** Transcribe uses `cs-CZ`, Translate uses `cs` — drop the region tag. */
export function toTranslateLang(code: string): string {
  if (code === "auto") return "auto";
  const [base] = code.split("-");
  return base;
}
