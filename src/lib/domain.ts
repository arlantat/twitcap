/** Domain pack: profile + per-language glossary load/format/merge/pending. */

import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";

export type TermSource = "seed" | "learned" | "interview" | "manual";

export type GlossaryTerm = {
  jp: string;
  /** Preferred rendering per target language, e.g. { en: "Matsurisu", vi: "Matsurisu" }. */
  translations: Record<string, string>;
  source: TermSource;
  count: number;
};

export type PendingTerm = {
  id: string;
  jp: string;
  /** Target language this question is about. */
  lang: string;
  candidates: string[];
  context?: string;
  jobId?: string;
  createdAt: string;
};

export type TermProposal = {
  jp: string;
  /** Proposed rendering in the mined target language. */
  tl: string;
  confidence: "high" | "low";
  alternatives?: string[];
  context?: string;
};

export type DomainPack = {
  profile: string;
  terms: GlossaryTerm[];
  pending: PendingTerm[];
  dir: string;
};

const LOCKED_SOURCES: TermSource[] = ["interview", "manual"];

export function normalizeJpKey(jp: string): string {
  return String(jp || "")
    .replace(/\s+/g, "")
    .trim();
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function formatDomainBlock(opts: {
  profile: string;
  terms: GlossaryTerm[];
  lang: string;
  maxTerms?: number;
  maxChars?: number;
}): string {
  const maxTerms = opts.maxTerms ?? 40;
  const maxChars = opts.maxChars ?? 1500;
  const profile = (opts.profile || "").trim();
  const sorted = [...opts.terms].sort(
    (a, b) => b.count - a.count || a.jp.localeCompare(b.jp)
  );
  const glossLines: string[] = [];
  let glossChars = 0;
  for (const t of sorted) {
    const tl = (t.translations[opts.lang] || "").trim();
    if (!tl) continue;
    if (glossLines.length >= maxTerms) break;
    const line = `${t.jp} → ${tl}`;
    if (glossChars + line.length + 1 > maxChars && glossLines.length > 0) break;
    glossLines.push(line);
    glossChars += line.length + 1;
  }

  const parts = ["DOMAIN:", profile || "(no profile)", ""];
  if (glossLines.length) {
    parts.push(
      "GLOSSARY (prefer these renderings when the Japanese matches):"
    );
    parts.push(...glossLines);
    parts.push("");
  }
  return parts.join("\n");
}

type RawTerm = {
  jp?: string;
  en?: string;
  translations?: Record<string, string>;
  source?: string;
  count?: number;
};

function normalizeTerm(t: RawTerm): GlossaryTerm | null {
  const jp = normalizeJpKey(t.jp || "");
  if (!jp) return null;
  const translations: Record<string, string> = {};
  for (const [lang, value] of Object.entries(t.translations || {})) {
    const v = String(value || "").trim();
    if (v) translations[lang] = v;
  }
  // Legacy shape: { en: "..." } at the top level.
  if (t.en && !translations.en) {
    const v = String(t.en).trim();
    if (v) translations.en = v;
  }
  if (!Object.keys(translations).length) return null;
  return {
    jp,
    translations,
    source: (t.source || "learned") as TermSource,
    count: typeof t.count === "number" ? t.count : 1,
  };
}

export function loadDomainPack(dir: string): DomainPack {
  const profilePath = path.join(dir, "profile.md");
  const glossaryPath = path.join(dir, "glossary.json");
  const pendingPath = path.join(dir, "pending.json");

  let profile = "";
  if (fs.existsSync(profilePath)) {
    profile = fs.readFileSync(profilePath, "utf8");
  }

  let terms: GlossaryTerm[] = [];
  if (fs.existsSync(glossaryPath)) {
    const raw = JSON.parse(fs.readFileSync(glossaryPath, "utf8")) as {
      terms?: RawTerm[];
    };
    terms = (raw.terms || [])
      .map(normalizeTerm)
      .filter((t): t is GlossaryTerm => t !== null);
  }

  let pending: PendingTerm[] = [];
  if (fs.existsSync(pendingPath)) {
    const raw = JSON.parse(fs.readFileSync(pendingPath, "utf8")) as {
      pending?: Array<PendingTerm & { lang?: string }>;
    };
    pending = (raw.pending || []).map((p) => ({
      ...p,
      lang: p.lang || "en", // pre-multilang queues were EN
    }));
  }

  return { profile, terms, pending, dir };
}

export function saveGlossary(dir: string, terms: GlossaryTerm[]): void {
  const out = {
    terms: terms.map((t) => ({
      jp: t.jp,
      translations: t.translations,
      source: t.source,
      count: t.count,
    })),
  };
  fs.writeFileSync(
    path.join(dir, "glossary.json"),
    JSON.stringify(out, null, 2) + "\n",
    "utf8"
  );
}

export function savePending(dir: string, pending: PendingTerm[]): void {
  fs.writeFileSync(
    path.join(dir, "pending.json"),
    JSON.stringify({ pending }, null, 2) + "\n",
    "utf8"
  );
}

function enqueuePending(
  pending: PendingTerm[],
  item: Omit<PendingTerm, "id" | "createdAt"> & {
    id?: string;
    createdAt?: string;
  }
): PendingTerm[] {
  const jp = normalizeJpKey(item.jp);
  const existing = pending.find(
    (p) => normalizeJpKey(p.jp) === jp && p.lang === item.lang
  );
  const candidates = Array.from(
    new Set(
      [...(existing?.candidates || []), ...(item.candidates || [])]
        .map((c) => c.trim())
        .filter(Boolean)
    )
  );
  if (existing) {
    return pending.map((p) =>
      p.id === existing.id
        ? {
            ...p,
            candidates,
            context: item.context || p.context,
            jobId: item.jobId || p.jobId,
          }
        : p
    );
  }
  return [
    ...pending,
    {
      id: item.id || randomBytes(4).toString("hex"),
      jp,
      lang: item.lang,
      candidates,
      context: item.context,
      jobId: item.jobId,
      createdAt: item.createdAt || new Date().toISOString(),
    },
  ];
}

export function classifyAndMergeProposals(
  glossary: GlossaryTerm[],
  pending: PendingTerm[],
  proposals: TermProposal[],
  meta: { lang: string; jobId?: string; context?: string }
): {
  glossary: GlossaryTerm[];
  pending: PendingTerm[];
  autoAdded: number;
  bumped: number;
  enqueued: number;
} {
  const lang = meta.lang;
  const byJp = new Map<string, GlossaryTerm>();
  for (const t of glossary) {
    byJp.set(normalizeJpKey(t.jp), {
      ...t,
      jp: normalizeJpKey(t.jp),
      translations: { ...t.translations },
    });
  }
  let nextPending = [...pending];
  let autoAdded = 0;
  let bumped = 0;
  let enqueued = 0;

  for (const prop of proposals) {
    const jp = normalizeJpKey(prop.jp);
    const tl = String(prop.tl || "").trim();
    if (!jp || !tl) continue;
    if (jp.length > 20) continue; // sentences, not terms
    if (jp === tl) continue;

    const alts = (prop.alternatives || [])
      .map((a) => a.trim())
      .filter((a) => a && !sameText(a, tl));
    const ambiguous = prop.confidence === "low" || alts.length > 0;

    const existing = byJp.get(jp);
    if (!existing) {
      if (ambiguous) {
        nextPending = enqueuePending(nextPending, {
          jp,
          lang,
          candidates: [tl, ...alts],
          context: prop.context || meta.context,
          jobId: meta.jobId,
        });
        enqueued += 1;
        continue;
      }
      byJp.set(jp, {
        jp,
        translations: { [lang]: tl },
        source: "learned",
        count: 1,
      });
      autoAdded += 1;
      continue;
    }

    const current = (existing.translations[lang] || "").trim();
    if (!current) {
      // Term known in another language; extend it — unless ambiguous.
      if (ambiguous) {
        nextPending = enqueuePending(nextPending, {
          jp,
          lang,
          candidates: [tl, ...alts],
          context: prop.context || meta.context,
          jobId: meta.jobId,
        });
        enqueued += 1;
        continue;
      }
      existing.translations[lang] = tl;
      existing.count += 1;
      autoAdded += 1;
      continue;
    }

    if (sameText(current, tl)) {
      existing.count += 1;
      bumped += 1;
      continue;
    }

    // Conflict: never auto-overwrite.
    nextPending = enqueuePending(nextPending, {
      jp,
      lang,
      candidates: [current, tl, ...alts],
      context: prop.context || meta.context,
      jobId: meta.jobId,
    });
    enqueued += 1;
  }

  return {
    glossary: Array.from(byJp.values()).sort(
      (a, b) => b.count - a.count || a.jp.localeCompare(b.jp)
    ),
    pending: nextPending,
    autoAdded,
    bumped,
    enqueued,
  };
}

export function applyInterviewChoice(
  glossary: GlossaryTerm[],
  pending: PendingTerm[],
  pendingId: string,
  chosen: string
): { glossary: GlossaryTerm[]; pending: PendingTerm[] } {
  const item = pending.find((p) => p.id === pendingId);
  if (!item) return { glossary, pending };
  const tl = chosen.trim();
  if (!tl) return { glossary, pending };

  const jp = normalizeJpKey(item.jp);
  const byJp = new Map(
    glossary.map((t) => [
      normalizeJpKey(t.jp),
      { ...t, translations: { ...t.translations } },
    ])
  );
  const existing = byJp.get(jp);
  if (existing) {
    existing.translations[item.lang] = tl;
    existing.source = "interview";
    existing.count = Math.max(existing.count, 1) + 1;
  } else {
    byJp.set(jp, {
      jp,
      translations: { [item.lang]: tl },
      source: "interview",
      count: 1,
    });
  }
  return {
    glossary: Array.from(byJp.values()),
    pending: pending.filter((p) => p.id !== pendingId),
  };
}

/** Locked terms are never auto-overwritten (interview/manual). */
export function isLockedSource(source: TermSource): boolean {
  return LOCKED_SOURCES.includes(source);
}
