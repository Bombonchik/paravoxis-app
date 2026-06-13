// Pure types for the translation engine — no React, no AWS, no IO.
import type { LanguageCode } from "@/lib/shared/constants";

export type Speaker = "caller" | "agent";

export interface TranscriptSegment {
  id: string;
  speaker: Speaker;
  language: LanguageCode | string;
  originalText: string;
  translatedText?: string;
  translatedLanguage?: LanguageCode | string;
  isFinal: boolean;
  startedAt: number;
  finishedAt?: number;
}

export interface CallSession {
  contactId: string;
  callerLanguage: LanguageCode | string;
  agentLanguage: LanguageCode | string;
  startedAt: number;
  segments: TranscriptSegment[];
}
