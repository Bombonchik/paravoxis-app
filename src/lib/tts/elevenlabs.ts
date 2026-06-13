// ElevenLabs Text-to-Speech. Drop-in replacement for Polly.
// Uses the `eleven_turbo_v2_5` multilingual model for low-latency real-time
// translation (Czech, English, Hindi, etc. all spoken by the same voice).
//
// API key is read from VITE_EL_API_KEY at runtime.

const ELEVEN_TTS_BASE = "https://api.elevenlabs.io/v1/text-to-speech";

// Single multilingual voice — `eleven_turbo_v2_5` switches language automatically
// based on the text. Voice "Rachel" works well across all supported languages.
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const MODEL_ID = "eleven_turbo_v2_5";

function getApiKey(): string | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_EL_API_KEY || null;
}

/** Synthesize translated text to MP3. Returns null on any failure (logged). */
export async function synthesize(_languageCode: string, text: string): Promise<Blob | null> {
  if (!text.trim()) return null;
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("[tts/elevenlabs] missing VITE_EL_API_KEY");
    return null;
  }

  try {
    const res = await fetch(`${ELEVEN_TTS_BASE}/${DEFAULT_VOICE_ID}?output_format=mp3_44100_128`, {
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
