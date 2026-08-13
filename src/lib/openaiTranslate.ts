/**
 * JP→target-language subtitle translation via OpenAI Chat Completions.
 * Default model is gpt-5-nano (cheapest current chat model).
 *
 * Docs: https://developers.openai.com/api/docs
 */

import {
  translateJpFileWithPrompt,
  type CloudTranslateOptions,
} from "./cloudTranslate";
import { DEFAULT_OPENAI_TRANSLATE_MODEL } from "./translateBackend";

export type OpenAITranslateOptions = CloudTranslateOptions & {
  apiKey: string;
  modelId?: string;
  fetchImpl?: typeof fetch;
};

function stripFence(text: string): string {
  let t = (text || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
  }
  return t.trim();
}

export function parseOpenAIChatText(data: unknown): string {
  const choices = (data as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenAI translate returned an empty completion");
  }
  return stripFence(content);
}

export async function promptOpenAI(
  apiKey: string,
  modelId: string,
  prompt: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    const snippet = raw.replace(/\s+/g, " ").slice(0, 300);
    throw new Error(`OpenAI translate failed (${res.status}): ${snippet || res.statusText}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("OpenAI translate returned non-JSON");
  }
  return parseOpenAIChatText(data);
}

export async function translateJpFileWithOpenAI(
  jpJsonPath: string,
  outs: { srt: string; vtt: string; json: string },
  opts: OpenAITranslateOptions
): Promise<void> {
  if (!opts.apiKey?.trim()) {
    throw new Error(
      "OPENAI_API_KEY is required for OpenAI translation. Add it to .env.local (https://platform.openai.com/api-keys)."
    );
  }
  const modelId = opts.modelId || DEFAULT_OPENAI_TRANSLATE_MODEL;
  const fetchImpl = opts.fetchImpl || fetch;
  await translateJpFileWithPrompt(
    jpJsonPath,
    outs,
    opts,
    (prompt) => promptOpenAI(opts.apiKey, modelId, prompt, fetchImpl),
    { model: modelId, backend: "openai" }
  );
}
