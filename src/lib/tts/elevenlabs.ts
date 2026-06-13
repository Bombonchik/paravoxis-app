// ElevenLabs Text-to-Speech. Drop-in replacement for Polly.
// Uses the `eleven_turbo_v2_5` multilingual model for low-latency real-time
// translation (Czech, English, Hindi, etc. all spoken by the same voice).
//
// API key is read from VITE_EL_API_KEY at runtime.

const ELEVEN_BASE = "https://api.elevenlabs.io/v1";
const MODEL_ID = "eleven_turbo_v2_5";

function getApiKey(): string | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_EL_API_KEY || null;
}

// ElevenLabs free tier blocks "library voices" via the API. We can't hardcode
// Rachel (21m00…) any more. Instead, list the account's available voices on
// first call and cache the first one — that's guaranteed to be usable.
let cachedVoiceId: string | null = null;
let voicePromise: Promise<string | null> | null = null;
async function resolveVoiceId(apiKey: string): Promise<string | null> {
  if (cachedVoiceId) return cachedVoiceId;
  if (voicePromise) return voicePromise;
  voicePromise = (async () => {
    try {
      const res = await fetch(`${ELEVEN_BASE}/voices`, { headers: { "xi-api-key": apiKey } });
      if (!res.ok) {
        console.error("[tts/elevenlabs] /voices HTTP", res.status, await res.text().catch(() => ""));
        return null;
      }
      const data = (await res.json()) as { voices?: Array<{ voice_id: string; name?: string }> };
      const first = data.voices?.[0];
      if (!first) {
        console.error("[tts/elevenlabs] no voices on this account");
        return null;
      }
      console.info("[tts/elevenlabs] using voice", first.name ?? "(unnamed)", first.voice_id);
      cachedVoiceId = first.voice_id;
      return cachedVoiceId;
    } catch (err) {
      console.error("[tts/elevenlabs] voices fetch failed", err);
      return null;
    }
  })();
  return voicePromise;
}

/** Synthesize translated text to MP3. Returns null on any failure (logged). */
export async function synthesize(_languageCode: string, text: string): Promise<Blob | null> {
  if (!text.trim()) return null;
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("[tts/elevenlabs] missing VITE_EL_API_KEY");
    return null;
  }

  const voiceId = await resolveVoiceId(apiKey);
  if (!voiceId) return null;

  try {
    const res = await fetch(`${ELEVEN_BASE}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[tts/elevenlabs] HTTP", res.status, body.slice(0, 300));
      return null;
    }
    const buf = await res.arrayBuffer();
    return new Blob([buf], { type: "audio/mpeg" });
  } catch (err) {
    console.error("[tts/elevenlabs] fetch error", err);
    return null;
  }
}
