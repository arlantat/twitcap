/** Pure helpers for chunked JP→EN subtitle translation (any MT backend). */

export type JpSegment = {
  id: number;
  start: number;
  end: number;
  text: string;
};

export type TlSegment = {
  id: number;
  start: number;
  end: number;
  text_jp: string;
  /** Translated caption text in the job's target language. */
  text_tl: string;
};

/** @deprecated legacy alias from the EN-only era. */
export type EnSegment = TlSegment;

const NUMBERED_RE = /^\s*(\d{1,4})\s*[\.\):：\-]\s*(.+?)\s*$/;

export function parseNumberedLines(text: string): Record<number, string> {
  const out: Record<number, string> = {};
  for (const raw of (text || "").split(/\r?\n/)) {
    const m = raw.match(NUMBERED_RE);
    if (!m) continue;
    const id = parseInt(m[1], 10);
    const body = m[2].trim();
    if (body) out[id] = body;
  }
  return out;
}

export function makeBatches(
  segments: JpSegment[],
  maxLines: number,
  maxChars: number
): JpSegment[][] {
  const batches: JpSegment[][] = [];
  let batch: JpSegment[] = [];
  let chars = 0;
  for (const seg of segments) {
    batch.push(seg);
    chars += (seg.text || "").length;
    if (batch.length >= maxLines || chars >= maxChars) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export type TranslateContextItem = {
  id: number;
  text: string;
  /** Previous translation of this line, when available — keeps voice/terms consistent. */
  tl?: string;
};

export type PromptLangSpec = {
  code: string;
  name: string;
  styleLines: string[];
};

const DEFAULT_LANG: PromptLangSpec = {
  code: "en",
  name: "English",
  styleLines: [
    "- Each line must be a fully coherent standard English sentence a native speaker would say.",
    "- Prefer natural meaning over word-for-word Japanese when ASR is fragmented or noisy.",
    "- Smooth fillers and glue fragments into clear speech; drop empty uh/um equivalents.",
    "- No Japanese characters in the output.",
  ],
};

export function buildTranslatePrompt(
  batch: JpSegment[],
  context: TranslateContextItem[] = [],
  domainBlock?: string,
  lang: PromptLangSpec = DEFAULT_LANG
): string {
  const lines: string[] = [];
  lines.push(
    `You are translating Japanese livestream subtitles into ${lang.name} captions.`,
    "",
    "CRITICAL — text reply only:",
    "- Do NOT use tools, edit files, run commands, or browse the repo.",
    `- Reply with ONLY numbered ${lang.name} lines matching the input IDs.`,
    "- One output line per input line number. Never merge or split IDs.",
    "- No markdown fences, no commentary, no quotes around lines.",
    "",
    "QUALITY:",
    ...lang.styleLines,
    "- Keep names/proper nouns (romanize if needed).",
    "- Prefer DOMAIN/GLOSSARY renderings when the Japanese matches.",
    ""
  );
  const domain = (domainBlock || "").trim();
  if (domain) {
    lines.push(domain);
    if (!domain.endsWith("\n")) lines.push("");
  }
  if (context.length) {
    lines.push(
      "Context — previous lines already translated (do NOT retranslate these):"
    );
    for (const c of context) {
      lines.push(c.tl ? `${c.id}. ${c.text} → ${c.tl}` : `${c.id}. ${c.text}`);
    }
    lines.push("");
  }
  lines.push(
    `Translate these Japanese subtitle lines into coherent ${lang.name}. Same line numbers:`
  );
  for (const seg of batch) {
    lines.push(`${seg.id}. ${seg.text}`);
  }
  return lines.join("\n");
}

export function applyBatchTranslations(
  batch: JpSegment[],
  parsed: Record<number, string>
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const seg of batch) {
    const en = (parsed[seg.id] || "").trim();
    out[seg.id] = en || seg.text;
  }
  return out;
}

export function mergeTlSegments(
  segments: JpSegment[],
  translations: Record<number, string>
): TlSegment[] {
  return segments.map((seg) => ({
    id: seg.id,
    start: seg.start,
    end: seg.end,
    text_jp: seg.text,
    text_tl: translations[seg.id] ?? seg.text,
  }));
}

/** @deprecated use mergeTlSegments. */
export const mergeEnSegments = mergeTlSegments;

export function srtTimestamp(seconds: number): string {
  const msTotal = Math.round(seconds * 1000);
  const h = Math.floor(msTotal / 3_600_000);
  let rem = msTotal % 3_600_000;
  const m = Math.floor(rem / 60_000);
  rem %= 60_000;
  const s = Math.floor(rem / 1000);
  const ms = rem % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function vttTimestamp(seconds: number): string {
  return srtTimestamp(seconds).replace(",", ".");
}

export function writeSrt(segments: TlSegment[]): string {
  return segments
    .map(
      (s, i) =>
        `${i + 1}\n${srtTimestamp(s.start)} --> ${srtTimestamp(s.end)}\n${s.text_tl}\n`
    )
    .join("\n");
}

export function writeVtt(segments: TlSegment[]): string {
  const body = segments
    .map(
      (s, i) =>
        `${i + 1}\n${vttTimestamp(s.start)} --> ${vttTimestamp(s.end)}\n${s.text_tl}\n`
    )
    .join("\n");
  return `WEBVTT\n\n${body}`;
}
