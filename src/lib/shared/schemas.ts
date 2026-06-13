import { z } from "zod";

export const translateRequestSchema = z.object({
  text: z.string().min(1).max(4000),
  sourceLanguage: z.string().min(2).max(10),
  targetLanguage: z.string().min(2).max(10),
});
export type TranslateRequest = z.infer<typeof translateRequestSchema>;

export const ttsRequestSchema = z.object({
  text: z.string().min(1).max(2000),
  language: z.string().min(2).max(10),
  voice: z.string().optional(),
});
export type TtsRequest = z.infer<typeof ttsRequestSchema>;
