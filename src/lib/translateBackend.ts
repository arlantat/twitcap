export type TranslateBackend = "cursor" | "openai" | "ollama";

export type TranslateBackendEnv = {
  TRANSLATE_BACKEND?: string;
  CURSOR_API_KEY?: string;
  OPENAI_API_KEY?: string;
};

/**
 * cursor = Composer 2.5 via @cursor/sdk
 * openai = cheapest OpenAI chat model (default gpt-5-nano)
 * ollama = local TRANSLATE_MODEL
 *
 * Default `auto`: Cursor key if present, else OpenAI key, else Ollama.
 */
export function resolveTranslateBackend(
  env: Record<string, string | undefined> = process.env
): TranslateBackend {
  const raw = (env.TRANSLATE_BACKEND || "auto").trim().toLowerCase();
  if (raw === "cursor" || raw === "openai" || raw === "ollama") return raw;
  if ((env.CURSOR_API_KEY || "").trim()) return "cursor";
  if ((env.OPENAI_API_KEY || "").trim()) return "openai";
  return "ollama";
}

/** Snapshot-free alias for OpenAI's cheapest current chat model. */
export const DEFAULT_OPENAI_TRANSLATE_MODEL = "gpt-5-nano";
