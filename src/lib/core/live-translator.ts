// Orchestrates the live translation loop for a single voice contact.
//
// Voice-to-voice routing (when speakTranslations is on):
//   - Customer (caller) audio → transcribe → translate → Polly in agent's language
//     → played out the agent's <audio> element (agent hears translation, not raw caller).
//     The hidden raw-customer <audio> element is muted so only Polly is heard.
//   - Agent mic → transcribe → translate → Polly in caller's language
//     → piped into a MediaStreamDestination whose track REPLACES the outbound
//       WebRTC audio sender → customer hears the Polly voice instead of agent's raw speech.
import { synthesize } from "@/lib/aws/polly";
import { startStreamingTranscription } from "@/lib/aws/transcribe";
import { translate } from "@/lib/aws/translate";
import type { Speaker, TranscriptSegment } from "./types";
import type { TranslationSession } from "./translation-session";

export interface LiveTranslatorOptions {
  session: TranslationSession;
  customerAudio: MediaStream;
  agentAudio: MediaStream;
  callerLanguage: string;
  agentLanguage: string;
  speakTranslations?: boolean;
  /** Outbound (agent → customer) RTC sender, used to swap mic for Polly audio. */
  agentSender: RTCRtpSender | null;
  onError?: (err: unknown) => void;
}

export class LiveTranslator {
  private aborts: AbortController[] = [];
  private stops: Array<() => void> = [];
  private agentPlaybackEl: HTMLAudioElement | null = null; // agent hears caller's translated voice
  private audioCtx: AudioContext | null = null;
  private outboundDest: MediaStreamAudioDestinationNode | null = null;
  private originalAgentTrack: MediaStreamTrack | null = null;
  private disposed = false;
  private readonly partialIds: Record<Speaker, string> = {
    caller: "caller-partial",
    agent: "agent-partial",
  };

  constructor(private readonly opts: LiveTranslatorOptions) {}

  async start(): Promise<void> {
    console.info("[live-translator] start");
    this.audioCtx = new AudioContext();
    const sampleRate = this.audioCtx.sampleRate;
    console.info("[live-translator] sample rate:", sampleRate);

    if (this.opts.speakTranslations) {
      // Agent-side playback: speaker hears caller-side Polly translation.
      this.agentPlaybackEl = new Audio();
      this.agentPlaybackEl.autoplay = true;

      // Mute the raw remote audio so the agent ONLY hears Polly's translated version.
      const raw = document.getElementById("paravoxis-remote-audio") as HTMLAudioElement | null;
      if (raw) raw.muted = true;

      // Customer-side playback: build a MediaStreamDestination and swap the agent's
      // outbound RTC track to it so the customer hears Polly instead of raw mic.
      if (this.opts.agentSender) {
        this.outboundDest = this.audioCtx.createMediaStreamDestination();
        this.originalAgentTrack = this.opts.agentSender.track;
        const newTrack = this.outboundDest.stream.getAudioTracks()[0];
        await this.opts.agentSender.replaceTrack(newTrack);
        console.info("[live-translator] swapped agent outbound track for Polly destination");
      } else {
        console.warn("[live-translator] no agent RTC sender — customer will hear raw agent mic");
      }
    }

    try {
      await Promise.all([
        this.startSide("caller", this.opts.customerAudio, this.opts.callerLanguage, this.opts.agentLanguage, sampleRate),
        this.startSide("agent", this.opts.agentAudio, this.opts.agentLanguage, this.opts.callerLanguage, sampleRate),
      ]);
      console.info("[live-translator] both sides started");
    } catch (err) {
      console.error("[live-translator] startSide failed:", err);
      throw err;
    }
  }

  private async startSide(
    speaker: Speaker,
    stream: MediaStream,
    sourceLang: string,
    targetLang: string,
    sampleRate: number,
  ): Promise<void> {
    console.info(`[live-translator] startSide(${speaker}) lang=${sourceLang} tracks=${stream.getAudioTracks().length}`);
    const abort = new AbortController();
    this.aborts.push(abort);

    const stop = await startStreamingTranscription(stream, {
      languageCode: sourceLang,
      sampleRate,
      partialStability: "medium",
      signal: abort.signal,
      onPartial: (text) => {
        if (this.disposed || !text) return;
        const seg: TranscriptSegment = {
          id: this.partialIds[speaker],
          speaker,
          language: sourceLang,
          originalText: text,
          isFinal: false,
          startedAt: Date.now(),
        };
        this.opts.session.upsertSegment(seg);
      },
      onFinal: (text) => {
        if (this.disposed || !text) return;
        void this.handleFinal(speaker, text, sourceLang, targetLang);
      },
    });
    this.stops.push(stop);
  }

  private async handleFinal(speaker: Speaker, text: string, sourceLang: string, targetLang: string) {
    const finalId = `${speaker}-${Date.now()}`;
    const startedAt = Date.now();
    this.opts.session.removeSegment(this.partialIds[speaker]);
    this.opts.session.upsertSegment({
      id: finalId, speaker, language: sourceLang, originalText: text,
      translatedLanguage: targetLang, isFinal: true, startedAt,
    });

    try {
      const translated = await translate(sourceLang, targetLang, text);
      if (this.disposed) return;
      this.opts.session.upsertSegment({
        id: finalId, speaker, language: sourceLang, originalText: text,
        translatedText: translated, translatedLanguage: targetLang,
        isFinal: true, startedAt, finishedAt: Date.now(),
      });
      if (!this.opts.speakTranslations || !translated) return;

      const blob = await synthesize(targetLang, translated);
      if (!blob || this.disposed) return;

      if (speaker === "caller") {
        // Caller spoke → translation goes to AGENT's speakers.
        if (this.agentPlaybackEl) {
          const url = URL.createObjectURL(blob);
          this.agentPlaybackEl.src = url;
          await this.agentPlaybackEl.play().catch(() => undefined);
          this.agentPlaybackEl.onended = () => URL.revokeObjectURL(url);
        }
      } else {
        // Agent spoke → translation goes to CUSTOMER via the swapped RTC track.
        await this.playToOutbound(blob);
      }
    } catch (err) {
      this.opts.onError?.(err);
    }
  }

  /** Decode mp3 → schedule into the outbound MediaStreamDestination so the customer hears it. */
  private async playToOutbound(blob: Blob): Promise<void> {
    if (!this.audioCtx || !this.outboundDest) return;
    const arrayBuf = await blob.arrayBuffer();
    const audioBuf = await this.audioCtx.decodeAudioData(arrayBuf).catch(() => null);
    if (!audioBuf || this.disposed) return;
    const src = this.audioCtx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(this.outboundDest);
    src.start();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.aborts.forEach((a) => a.abort());
    this.stops.forEach((s) => {
      try { s(); } catch { /* noop */ }
    });
    this.aborts = [];
    this.stops = [];
    if (this.agentPlaybackEl) {
      this.agentPlaybackEl.pause();
      this.agentPlaybackEl.src = "";
      this.agentPlaybackEl = null;
    }
    // Restore original mic on the outbound RTC sender.
    if (this.opts.agentSender && this.originalAgentTrack) {
      void this.opts.agentSender.replaceTrack(this.originalAgentTrack).catch(() => undefined);
    }
    const raw = document.getElementById("paravoxis-remote-audio") as HTMLAudioElement | null;
    if (raw) raw.muted = false;
    void this.audioCtx?.close();
    this.audioCtx = null;
    this.outboundDest = null;
  }
}
