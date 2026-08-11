/** Target caption languages. Vietnamese is the product default. */

export type TargetLang = "vi" | "en";

export type LangSpec = {
  code: TargetLang;
  name: string;
  /** Prompt style guide lines — quality rules specific to this language. */
  styleLines: string[];
};

export const LANGS: Record<TargetLang, LangSpec> = {
  vi: {
    code: "vi",
    name: "Vietnamese",
    styleLines: [
      "- Write natural spoken Vietnamese a young VN viewer reads at a glance — never word-by-word translation.",
      '- The streamer refers to herself as "mình" and the audience as "mọi người"; keep this consistent in every line.',
      "- Keep Japanese names romanized (Matsuri, Hololive…); do not translate proper nouns into Vietnamese.",
      "- Use everyday Vietnamese slang where the Japanese is casual (kiểu, luôn, nha, đó…), but never invent content.",
      "- No Japanese characters and no English filler words in the output.",
    ],
  },
  en: {
    code: "en",
    name: "English",
    styleLines: [
      "- Each line must be a fully coherent standard English sentence a native speaker would say.",
      "- Prefer natural meaning over word-for-word Japanese when ASR is fragmented or noisy.",
      "- Smooth fillers and glue fragments into clear speech; drop empty uh/um equivalents.",
      "- No Japanese characters in the output.",
    ],
  },
};

const ALIASES: Record<string, TargetLang> = {
  vi: "vi",
  vie: "vi",
  vietnamese: "vi",
  "tiếng việt": "vi",
  en: "en",
  eng: "en",
  english: "en",
};

/** Unknown/empty input falls back to the Vietnamese default. */
export function resolveTargetLang(raw: string | undefined | null): TargetLang {
  const key = (raw || "").trim().toLowerCase();
  return ALIASES[key] || "vi";
}
