// Server function: translate text via Lovable AI Gateway (Gemini).
// Called from the browser through TanStack server-fn RPC.
import { createServerFn } from "@tanstack/react-start";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { translateRequestSchema, type TranslateRequest } from "@/lib/shared/schemas";

export const translateText = createServerFn({ method: "POST" })
  .inputValidator((input: unknown): TranslateRequest => translateRequestSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const gateway = createOpenAICompatible({
      name: "lovable",
      baseURL: "https://ai.gateway.lovable.dev/v1",
      headers: {
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
    });

    const { text } = await generateText({
      model: gateway("google/gemini-3-flash-preview"),
      system:
        "You are a professional real-time interpreter for a call centre. " +
        "Translate the user's text faithfully and naturally for spoken delivery. " +
        "Preserve numbers, names, and product terms. " +
        "Reply with ONLY the translated text, no quotes, no preface, no explanation.",
      prompt:
        `Translate from ${data.sourceLanguage} to ${data.targetLanguage}.\n\n` +
        `Text:\n${data.text}`,
    });

    return { translatedText: text.trim() };
  });
