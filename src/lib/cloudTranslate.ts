/**
 * Shared JP→target-language subtitle translation: batch prompts, then
 * sentence re-flow onto display cues. Backends only supply a prompt() fn.
 */

import fs from "fs/promises";
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

export type CloudTranslateOptions = {
  targetLang?: TargetLang | string;
  chunkLines?: number;
  chunkChars?: number;
  contextLines?: number;
  domainDir?: string;
  domainEnabled?: boolean;
  onProgress?: (fraction: number) => void | Promise<void>;
};

export type PromptFn = (prompt: string) => Promise<string>;

export async function translateSegmentsWithPrompt(
  segments: JpSegment[],
  opts: CloudTranslateOptions,
  promptFn: PromptFn
): Promise<{
  segments: ReturnType<typeof mergeTlSegments>;
  lang: TargetLang;
}> {
  const lang = LANGS[resolveTargetLang(opts.targetLang)];
  const chunkLines = opts.chunkLines ?? 15;
  const chunkChars = opts.chunkChars ?? 1200;
  const contextLines = opts.contextLines ?? 4;

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
      console.error("[cloudTranslate] domain pack load failed:", err);
    }
  }

  const batches = makeBatches(segments, chunkLines, chunkChars);
  const translations: Record<number, string> = {};
  let context: TranslateContextItem[] = [];

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const prompt = buildTranslatePrompt(batch, context, domainBlock, lang);
    const raw = await promptFn(prompt);
    const parsed = parseNumberedLines(raw);
    const batchOut = applyBatchTranslations(batch, parsed);
    Object.assign(translations, batchOut);
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
    lang: lang.code,
  };
}

type SentenceUnit = {
  id: number;
  text: string;
  start: number;
  end: number;
  cue_ids: number[];
};

type DisplayCue = { id?: number; start: number; end: number; text: string };

export async function translateJpFileWithPrompt(
  jpJsonPath: string,
  outs: { srt: string; vtt: string; json: string },
  opts: CloudTranslateOptions,
  promptFn: PromptFn,
  meta: { model: string; backend: string }
): Promise<void> {
  const raw = JSON.parse(await fs.readFile(jpJsonPath, "utf8"));
  const displayCues: DisplayCue[] = raw.segments || [];
  const sentences: SentenceUnit[] = raw.sentences || [];

  let tlSegs: TlSegment[];
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

    const result = await translateSegmentsWithPrompt(units, opts, promptFn);
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
        if (!piece) return;
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
    const result = await translateSegmentsWithPrompt(segments, opts, promptFn);
    tlSegs = result.segments;
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
        model: meta.model,
        translate_backend: meta.backend,
        sentence_level: sentenceLevel,
        segments: tlSegs,
      },
      null,
      2
    ),
    "utf8"
  );
}
