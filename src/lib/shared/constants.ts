// Shared constants for the call centre app — safe to import in client & server code.

export const SUPPORTED_LANGUAGES = [
  { code: "cs-CZ", label: "Czech", pollyVoice: "Jakub" },
  { code: "hi-IN", label: "Hindi", pollyVoice: "Kajal" },
  { code: "en-US", label: "English (US)", pollyVoice: "Joanna" },
  { code: "en-GB", label: "English (UK)", pollyVoice: "Amy" },
  { code: "de-DE", label: "German", pollyVoice: "Vicki" },
  { code: "es-ES", label: "Spanish", pollyVoice: "Lucia" },
  { code: "fr-FR", label: "French", pollyVoice: "Lea" },
  { code: "pl-PL", label: "Polish", pollyVoice: "Ola" },
  { code: "pt-BR", label: "Portuguese (BR)", pollyVoice: "Camila" },
  { code: "it-IT", label: "Italian", pollyVoice: "Bianca" },
  { code: "ar-AE", label: "Arabic", pollyVoice: "Hala" },
  { code: "ja-JP", label: "Japanese", pollyVoice: "Kazuha" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const DEFAULT_AGENT_LANGUAGE: LanguageCode = "hi-IN";
export const DEFAULT_CALLER_LANGUAGE: LanguageCode = "cs-CZ";
