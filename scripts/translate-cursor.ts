#!/usr/bin/env npx tsx
/**
 * CLI: JP segments → captions via Cursor Composer 2.5 or OpenAI.
 * Spawned by the job runner so Next.js never bundles @cursor/sdk.
 *
 * TRANSLATE_BACKEND=cursor|openai (job runner sets this).
 */

import fs from "fs";
import path from "path";
import { translateJpFileWithCursor } from "../src/lib/cursorTranslate";
import { translateJpFileWithOpenAI } from "../src/lib/openaiTranslate";
import {
  DEFAULT_OPENAI_TRANSLATE_MODEL,
  resolveTranslateBackend,
} from "../src/lib/translateBackend";

function arg(flag: string, fallback?: string): string {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required flag ${flag}`);
}

async function main() {
  const jpJson = process.argv[2];
  if (!jpJson || jpJson.startsWith("-")) {
    throw new Error(
      "Usage: translate-cursor.ts <segments.jp.json> --out-srt … --out-vtt … --out-json …"
    );
  }

  const backend = resolveTranslateBackend(process.env);
  const targetLang = process.env.TARGET_LANG || "vi";
  const chunkLines = parseInt(process.env.TRANSLATE_CHUNK_LINES || "15", 10);
  const chunkChars = parseInt(process.env.TRANSLATE_CHUNK_CHARS || "1200", 10);
  const domainEnabled = (process.env.DOMAIN_ENABLED || "1") !== "0";
  const domainDir = process.env.DOMAIN_PACK_DIR || "";

  const outSrt = arg("--out-srt");
  const outVtt = arg("--out-vtt");
  const outJson = arg("--out-json");

  for (const p of [outSrt, outVtt, outJson]) {
    fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
  }

  const outs = {
    srt: path.resolve(outSrt),
    vtt: path.resolve(outVtt),
    json: path.resolve(outJson),
  };
  const shared = {
    targetLang,
    chunkLines,
    chunkChars,
    domainEnabled: domainEnabled && !!domainDir,
    domainDir: domainDir
      ? path.isAbsolute(domainDir)
        ? domainDir
        : path.join(process.cwd(), domainDir)
      : undefined,
    onProgress: (frac: number) => {
      console.log(`PROGRESS ${frac.toFixed(4)}`);
    },
  };

  if (backend === "openai") {
    const modelId = process.env.OPENAI_TRANSLATE_MODEL || DEFAULT_OPENAI_TRANSLATE_MODEL;
    console.error(`[translate-openai] model=${modelId} lang=${targetLang} file=${jpJson}`);
    await translateJpFileWithOpenAI(path.resolve(jpJson), outs, {
      ...shared,
      apiKey: (process.env.OPENAI_API_KEY || "").trim(),
      modelId,
    });
  } else {
    const modelId = process.env.CURSOR_TRANSLATE_MODEL || "composer-2.5";
    console.error(`[translate-cursor] model=${modelId} lang=${targetLang} file=${jpJson}`);
    await translateJpFileWithCursor(path.resolve(jpJson), outs, {
      ...shared,
      apiKey: (process.env.CURSOR_API_KEY || "").trim(),
      modelId,
    });
  }

  console.error(`[translate-cloud] wrote ${outSrt}, ${outVtt}, ${outJson}`);
  console.log("PROGRESS 1.0");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
