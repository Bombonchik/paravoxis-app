// ElevenLabs Text-to-Speech.
// User is on a paid plan so we use Rachel (library voice) + multilingual turbo
// model for low-latency Czech/English/Hindi synthesis.

const ELEVEN_BASE = "https://api.elevenlabs.io/v1";
const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel
const MODEL_ID = "eleven_turbo_v2_5";

function getApiKey(): string | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_EL_API_KEY || null;
}

export async function synthesize(_languageCode: string, text: string): Promise<Blob | null> {
  if (!text.trim()) return null;
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("[tts/elevenlabs] missing VITE_EL_API_KEY");
    return null;
  }
  try {
    const res = await fetch(`${ELEVEN_BASE}/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.4, similarity_boost: 0.75, use_speaker_boost: true },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[tts/elevenlabs] HTTP", res.status, body.slice(0, 300));
      return null;
    }
    const buf = await res.arrayBuffer();
    console.info("[tts/elevenlabs] ok", buf.byteLength, "bytes for", text.slice(0, 60));
    return new Blob([buf], { type: "audio/mpeg" });
  } catch (err) {
    console.error("[tts/elevenlabs] fetch error", err);
    return null;
  }
}
