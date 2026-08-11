#!/usr/bin/env npx tsx
/**
 * CLI: JP segments → EN captions via Cursor Composer 2.5.
 * Spawned by the job runner so Next.js never bundles @cursor/sdk.
 *
 * Usage:
 *   npx tsx scripts/translate-cursor.ts segments.jp.json \
 *     --out-srt captions.en.srt --out-vtt captions.en.vtt --out-json segments.en.json
 *
 * Progress: stdout lines "PROGRESS <0..1>"
 */

import fs from "fs";
import path from "path";
import { translateJpFileWithCursor } from "../src/lib/cursorTranslate";

function arg(flag: string, fallback?: string): string {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required flag ${flag}`);
}

async function main() {
  const jpJson = process.argv[2];
  if (!jpJson || jpJson.startsWith("-")) {
    throw new Error("Usage: translate-cursor.ts <segments.jp.json> --out-srt … --out-vtt … --out-json …");
  }

  const apiKey = (process.env.CURSOR_API_KEY || "").trim();
  const modelId = process.env.CURSOR_TRANSLATE_MODEL || "composer-2.5";
  const targetLang = process.env.TARGET_LANG || "vi";
  const chunkLines = parseInt(process.env.TRANSLATE_CHUNK_LINES || "15", 10);
  const chunkChars = parseInt(process.env.TRANSLATE_CHUNK_CHARS || "1200", 10);
  const domainEnabled = (process.env.DOMAIN_ENABLED || "1") !== "0";
  // Full path to the selected pack dir (packs/<slug>), not the domain root.
  const domainDir = process.env.DOMAIN_PACK_DIR || "";

  const outSrt = arg("--out-srt");
  const outVtt = arg("--out-vtt");
  const outJson = arg("--out-json");

  // Ensure parent dirs exist
  for (const p of [outSrt, outVtt, outJson]) {
    fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
  }

  console.error(
    `[translate-cursor] model=${modelId} lang=${targetLang} file=${jpJson}`
  );
  await translateJpFileWithCursor(
    path.resolve(jpJson),
    {
      srt: path.resolve(outSrt),
      vtt: path.resolve(outVtt),
      json: path.resolve(outJson),
    },
    {
      apiKey,
      modelId,
      targetLang,
      chunkLines,
      chunkChars,
      domainEnabled: domainEnabled && !!domainDir,
      domainDir: domainDir
        ? path.isAbsolute(domainDir)
          ? domainDir
          : path.join(process.cwd(), domainDir)
        : undefined,
      onProgress: (frac) => {
        console.log(`PROGRESS ${frac.toFixed(4)}`);
      },
    }
  );
  console.error(`[translate-cursor] wrote ${outSrt}, ${outVtt}, ${outJson}`);
  console.log("PROGRESS 1.0");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
