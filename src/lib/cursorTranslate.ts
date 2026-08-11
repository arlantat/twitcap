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
  applyBatchTranslations,
  buildTranslatePrompt,
  makeBatches,
  mergeTlSegments,
  parseNumberedLines,
  reflowSentence,
  writeSrt,
  writeVtt,
  type JpSegment,
  type TlSegment,
  type TranslateContextItem,
} from "./subtitleTranslate";
import { formatDomainBlock, loadDomainPack } from "./domain";
import { LANGS, resolveTargetLang, type TargetLang } from "./lang";

export type CursorTranslateOptions = {
  apiKey: string;
  /** Default composer-2.5 (non-fast — do not pass fast=true). */
  modelId?: string;
  /** Caption target language (vi default). */
  targetLang?: TargetLang | string;
  chunkLines?: number;
  chunkChars?: number;
  contextLines?: number;
  /** Domain pack dir (profile.md + glossary.json) to inject, when set. */
  domainDir?: string;
  domainEnabled?: boolean;
  onProgress?: (fraction: number) => void | Promise<void>;
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
    // Empty sandbox cwd + no ambient settings: discourage tool/file edits.
    local: { cwd: sandboxCwd, settingSources: [] },
  });
  if (result.status === "error") {
    throw new Error(
      `Cursor translate run failed (${result.id}): ${result.error?.message || "unknown"}`
    );
  }
  return stripFence(result.result || "");
}

export async function translateSegmentsWithCursor(
  segments: JpSegment[],
  opts: CursorTranslateOptions
): Promise<{
  segments: ReturnType<typeof mergeTlSegments>;
  model: string;
  lang: TargetLang;
}> {
  const modelId = opts.modelId || "composer-2.5";
  const lang = LANGS[resolveTargetLang(opts.targetLang)];
  const chunkLines = opts.chunkLines ?? 15;
  const chunkChars = opts.chunkChars ?? 1200;
  const contextLines = opts.contextLines ?? 4;

  if (!opts.apiKey?.trim()) {
    throw new Error(
      "CURSOR_API_KEY is required for Composer translation. Add it to .env.local (https://cursor.com/dashboard/integrations)."
    );
  }

  const sandboxCwd = await fs.mkdtemp(path.join(os.tmpdir(), "twitcap-cursor-mt-"));
  // Minimal workspace so the agent has nothing useful to edit.
  await fs.writeFile(
    path.join(sandboxCwd, "README.txt"),
    "Subtitle translation sandbox. Do not edit files. Reply with text only.\n",
    "utf8"
  );

  try {
    let domainBlock = "";
    if (opts.domainEnabled !== false && opts.domainDir) {
      try {
        const pack = loadDomainPack(opts.domainDir);
        domainBlock = formatDomainBlock({
          profile: pack.profile,
          terms: pack.terms,
          lang: lang.code,
        });
      } catch (err) {
        console.error("[cursorTranslate] domain pack load failed:", err);
      }
    }

    const batches = makeBatches(segments, chunkLines, chunkChars);
    const translations: Record<number, string> = {};
    let context: TranslateContextItem[] = [];

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      const prompt = buildTranslatePrompt(batch, context, domainBlock, lang);
      let raw: string;
      try {
        raw = await promptComposer(opts.apiKey, modelId, prompt, sandboxCwd);
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

      const parsed = parseNumberedLines(raw);
      const batchOut = applyBatchTranslations(batch, parsed);
      Object.assign(translations, batchOut);

      // Bilingual rolling context: JP + what we just produced, so the next
      // batch keeps pronouns/terms consistent.
      context = batch
        .map((s) => ({
          id: s.id,
          text: s.text,
          tl: batchOut[s.id],
        }))
        .slice(-contextLines);

      await opts.onProgress?.((bi + 1) / Math.max(batches.length, 1));
    }

    return {
      segments: mergeTlSegments(segments, translations),
      model: modelId,
      lang: lang.code,
    };
  } finally {
    await fs.rm(sandboxCwd, { recursive: true, force: true }).catch(() => {});
  }
}

type SentenceUnit = {
  id: number;
  text: string;
  start: number;
  end: number;
  cue_ids: number[];
};

type DisplayCue = { id?: number; start: number; end: number; text: string };

/**
 * Sentence-level mode: translate whole sentences (complete thoughts), then
 * re-flow each translation across that sentence's display cues so subtitle
 * timing is unchanged. Falls back to per-cue translation when the JP JSON has
 * no sentence units (e.g. POLISH_JP=0).
 */
export async function translateJpFileWithCursor(
  jpJsonPath: string,
  outs: { srt: string; vtt: string; json: string },
  opts: CursorTranslateOptions
): Promise<void> {
  const raw = JSON.parse(await fs.readFile(jpJsonPath, "utf8"));
  const displayCues: DisplayCue[] = raw.segments || [];
  const sentences: SentenceUnit[] = raw.sentences || [];

  let tlSegs: TlSegment[];
  let model: string;
  let lang: string;
  let sentenceLevel = false;

  if (sentences.length > 0) {
    sentenceLevel = true;
    const units: JpSegment[] = sentences
      .map((s) => ({
        id: s.id,
        start: s.start,
        end: s.end,
        text: String(s.text || "").trim(),
      }))
      .filter((s) => s.text);

    const result = await translateSegmentsWithCursor(units, opts);
    model = result.model;
    lang = result.lang;

    const cueById = new Map<number, DisplayCue>();
    displayCues.forEach((c, i) => {
      cueById.set(typeof c.id === "number" ? c.id : i, c);
    });
    const tlBySentence = new Map<number, string>();
    for (const seg of result.segments) tlBySentence.set(seg.id, seg.text_tl);

    tlSegs = [];
    for (const sent of sentences) {
      const cues = sent.cue_ids
        .map((id) => cueById.get(id))
        .filter((c): c is DisplayCue => !!c);
      if (!cues.length) continue;
      const translation = tlBySentence.get(sent.id) ?? sent.text;
      const pieces = reflowSentence(
        translation,
        cues.map((c) => ({ jpLen: String(c.text || "").length }))
      );
      cues.forEach((cue, i) => {
        const piece = (pieces[i] || "").trim();
        if (!piece) return; // hide cues left without words
        tlSegs.push({
          id: tlSegs.length,
          start: cue.start,
          end: cue.end,
          text_jp: String(cue.text || ""),
          text_tl: piece,
        });
      });
    }
  } else {
    const segments = displayCues
      .map((s, i) => ({
        id: typeof s.id === "number" ? s.id : i,
        start: s.start,
        end: s.end,
        text: String(s.text || "").trim(),
      }))
      .filter((s: JpSegment) => s.text);
    const result = await translateSegmentsWithCursor(segments, opts);
    tlSegs = result.segments;
    model = result.model;
    lang = result.lang;
  }

  await fs.writeFile(outs.srt, writeSrt(tlSegs), "utf8");
  await fs.writeFile(outs.vtt, writeVtt(tlSegs), "utf8");
  await fs.writeFile(
    outs.json,
    JSON.stringify(
      {
        source_language: raw.language || raw.source_language || "ja",
        target_language: lang!,
        model: model!,
        translate_backend: "cursor",
        sentence_level: sentenceLevel,
        segments: tlSegs,
      },
      null,
      2
    ),
    "utf8"
  );
}
