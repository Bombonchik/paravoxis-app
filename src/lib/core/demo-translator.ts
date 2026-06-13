// Single-mic, two-language translator for hackathon demos with no Connect instance.
// The agent's microphone is treated as the audio source for *both* speakers; the
// operator toggles which side is "currently talking" with two push-to-talk buttons.
// Each side opens its own Transcribe Streaming session in the speaker's language.
import { synthesize } from "@/lib/aws/polly";
import { startStreamingTranscription } from "@/lib/aws/transcribe";
import { translate } from "@/lib/aws/translate";
import { probeSampleRate } from "@/lib/audio/audio-context";
import type { Speaker } from "./types";
import type { TranslationSession } from "./translation-session";

export interface DemoTranslatorOptions {
  session: TranslationSession;
  mic: MediaStream;
  languages: Record<Speaker, string>;
  speakTranslations?: boolean;
  onError?: (err: unknown) => void;
}

export class DemoTranslator {
  private readonly sampleRate = probeSampleRate();
  private readonly stops: Partial<Record<Speaker, () => void>> = {};
  private readonly aborts: Partial<Record<Speaker, AbortController>> = {};
  private playback: HTMLAudioElement | null = null;

  constructor(private readonly opts: DemoTranslatorOptions) {
    if (opts.speakTranslations) {
      this.playback = new Audio();
      this.playback.autoplay = true;
    }
  }

  isActive(speaker: Speaker): boolean {
    return !!this.stops[speaker];
  }

  async startSpeaking(speaker: Speaker): Promise<void> {
    if (this.stops[speaker]) return;
    const sourceLang = this.opts.languages[speaker];
    const targetLang = this.opts.languages[speaker === "caller" ? "agent" : "caller"];
    const abort = new AbortController();
    this.aborts[speaker] = abort;
    const partialId = `${speaker}-partial`;

    try {
      const stop = await startStreamingTranscription(this.opts.mic, {
        languageCode: sourceLang,
        sampleRate: this.sampleRate,
        partialStability: "medium",
        signal: abort.signal,
        onPartial: (text) => {
          if (!text) return;
          this.opts.session.upsertSegment({
            id: partialId,
            speaker,
            language: sourceLang,
            originalText: text,
            isFinal: false,
            startedAt: Date.now(),
          });
        },
        onFinal: (text) => {
          if (!text) return;
          void this.handleFinal(speaker, text, sourceLang, targetLang);
        },
      });
      this.stops[speaker] = stop;
    } catch (err) {
      this.opts.onError?.(err);
      throw err;
    }
  }

  async stopSpeaking(speaker: Speaker): Promise<void> {
    this.aborts[speaker]?.abort();
    try {
      this.stops[speaker]?.();
    } catch {
      /* noop */
    }
    delete this.aborts[speaker];
    delete this.stops[speaker];
    this.opts.session.removeSegment(`${speaker}-partial`);
  }

  async dispose(): Promise<void> {
    await Promise.all([this.stopSpeaking("caller"), this.stopSpeaking("agent")]);
    if (this.playback) {
      this.playback.pause();
      this.playback.src = "";
      this.playback = null;
    }
  }

  private async handleFinal(speaker: Speaker, text: string, sourceLang: string, targetLang: string) {
    const id = `${speaker}-${Date.now()}`;
    const startedAt = Date.now();
    this.opts.session.removeSegment(`${speaker}-partial`);
    this.opts.session.upsertSegment({
      id,
      speaker,
      language: sourceLang,
      originalText: text,
      translatedLanguage: targetLang,
      isFinal: true,
      startedAt,
    });
    try {
      const translated = await translate(sourceLang, targetLang, text);
      this.opts.session.upsertSegment({
        id,
        speaker,
        language: sourceLang,
        originalText: text,
        translatedText: translated,
        translatedLanguage: targetLang,
        isFinal: true,
        startedAt,
        finishedAt: Date.now(),
      });
      if (this.opts.speakTranslations && this.playback && translated) {
        const blob = await synthesize(targetLang, translated).catch(() => null);
        if (blob) {
          const url = URL.createObjectURL(blob);
          this.playback.src = url;
          await this.playback.play().catch(() => undefined);
          this.playback.onended = () => URL.revokeObjectURL(url);
        }
      }
    } catch (err) {
      this.opts.onError?.(err);
    }
  }
}
