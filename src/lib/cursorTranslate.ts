/**
 * JP→target-language subtitle translation via Cursor SDK (Composer 2.5, non-fast).
 *
 * Docs: https://cursor.com/docs/sdk/typescript
 * Billing: SDK runs use the same pools as IDE/Cloud Agents (Pro+ key required).
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { Agent, CursorAgentError } from "@cursor/sdk";
import {
  translateJpFileWithPrompt,
  type CloudTranslateOptions,
} from "./cloudTranslate";

export type CursorTranslateOptions = CloudTranslateOptions & {
  apiKey: string;
  /** Default composer-2.5 (non-fast — do not pass fast=true). */
  modelId?: string;
};

function stripFence(text: string): string {
  let t = (text || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
  }
  return t.trim();
}

async function promptComposer(
  apiKey: string,
  modelId: string,
  prompt: string,
  sandboxCwd: string
): Promise<string> {
  const result = await Agent.prompt(prompt, {
    apiKey,
    model: { id: modelId },
    local: { cwd: sandboxCwd, settingSources: [] },
  });
  if (result.status === "error") {
    throw new Error(
      `Cursor translate run failed (${result.id}): ${result.error?.message || "unknown"}`
    );
  }
  return stripFence(result.result || "");
}

export async function translateJpFileWithCursor(
  jpJsonPath: string,
  outs: { srt: string; vtt: string; json: string },
  opts: CursorTranslateOptions
): Promise<void> {
  if (!opts.apiKey?.trim()) {
    throw new Error(
      "CURSOR_API_KEY is required for Composer translation. Add it to .env.local (https://cursor.com/dashboard/integrations)."
    );
  }
  const modelId = opts.modelId || "composer-2.5";
  const sandboxCwd = await fs.mkdtemp(path.join(os.tmpdir(), "twitcap-cursor-mt-"));
  await fs.writeFile(
    path.join(sandboxCwd, "README.txt"),
    "Subtitle translation sandbox. Do not edit files. Reply with text only.\n",
    "utf8"
  );

  try {
    await translateJpFileWithPrompt(
      jpJsonPath,
      outs,
      opts,
      async (prompt) => {
        try {
          return await promptComposer(opts.apiKey, modelId, prompt, sandboxCwd);
        } catch (err) {
          if (err instanceof CursorAgentError) {
            throw new Error(
              `Cursor SDK startup failed: ${err.message} (retryable=${String(
                (err as { isRetryable?: boolean }).isRetryable
              )})`
            );
          }
          throw err;
        }
      },
      { model: modelId, backend: "cursor" }
    );
  } finally {
    await fs.rm(sandboxCwd, { recursive: true, force: true }).catch(() => {});
  }
}
