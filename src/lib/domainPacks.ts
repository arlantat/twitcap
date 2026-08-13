/** Multiple domain packs: domain/packs/<slug>/{profile.md,glossary.json,pending.json}. */

import fs from "fs";
import path from "path";
import {
  applyInterviewChoice,
  loadDomainPack,
  saveGlossary,
  savePending,
  type PendingTerm,
} from "./domain";

const SLUG_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

export type DomainPackInfo = {
  slug: string;
  title: string;
  termCount: number;
  pendingCount: number;
};

export type DomainName = {
  jp: string;
  captions: Record<string, string>;
};

export type DomainPackDetail = DomainPackInfo & {
  profile: string;
  notes: string;
  pending: PendingTerm[];
  names: DomainName[];
};

export function packsDir(root: string): string {
  return path.join(root, "packs");
}

/** Null when slug is unsafe or the pack doesn't exist. */
export function resolvePackDir(root: string, slug: string): string | null {
  if (!SLUG_RE.test(slug)) return null;
  const dir = path.join(packsDir(root), slug);
  return fs.existsSync(path.join(dir, "profile.md")) ||
    fs.existsSync(path.join(dir, "glossary.json"))
    ? dir
    : null;
}

function titleFromProfile(profile: string, fallback: string): string {
  for (const line of profile.split("\n")) {
    const m = line.match(/^#\s+(?:Domain:\s*)?(.+)$/);
    if (m) return m[1].trim();
  }
  return fallback;
}

export function slugFromTitle(title: string): string {
  const ascii = String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return ascii || "pack";
}

export function uniquePackSlug(root: string, title: string): string {
  const base = slugFromTitle(title);
  if (!resolvePackDir(root, base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`.slice(0, 64);
    if (!resolvePackDir(root, candidate)) return candidate;
  }
  throw new Error("Could not allocate a domain id");
}

export function notesFromProfile(profile: string): string {
  const lines = String(profile || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  if (/^#\s+/.test(lines[0] || "")) {
    const rest = lines.slice(1);
    if (rest[0] === "") rest.shift();
    return rest.join("\n").replace(/\s+$/, "");
  }
  return String(profile || "").replace(/\s+$/, "");
}

export function composeProfile(title: string, notes: string): string {
  const heading = `# Domain: ${title.trim() || "Untitled"}`;
  const body = (notes || "").trim();
  return body ? `${heading}\n\n${body}\n` : `${heading}\n`;
}

export function listDomainPacks(root: string): DomainPackInfo[] {
  const dir = packsDir(root);
  if (!fs.existsSync(dir)) return [];
  const out: DomainPackInfo[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SLUG_RE.test(entry.name)) continue;
    const packDir = path.join(dir, entry.name);
    try {
      const pack = loadDomainPack(packDir);
      out.push({
        slug: entry.name,
        title: titleFromProfile(pack.profile, entry.name),
        termCount: pack.terms.length,
        pendingCount: pack.pending.length,
      });
    } catch {
      /* skip broken packs */
    }
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function readPackDetail(
  root: string,
  slug: string
): DomainPackDetail | null {
  const dir = resolvePackDir(root, slug);
  if (!dir) return null;
  const pack = loadDomainPack(dir);
  return {
    slug,
    title: titleFromProfile(pack.profile, slug),
    termCount: pack.terms.length,
    pendingCount: pack.pending.length,
    profile: pack.profile,
    notes: notesFromProfile(pack.profile),
    pending: pack.pending,
    names: pack.terms.map((t) => ({ jp: t.jp, captions: t.translations })),
  };
}

export function updatePackProfile(dir: string, profile: string): void {
  fs.writeFileSync(path.join(dir, "profile.md"), profile, "utf8");
}

export function applyPackPendingChoice(
  root: string,
  slug: string,
  pendingId: string,
  rendering: string
): { ok: true; pendingCount: number } | { ok: false; error: string } {
  const dir = resolvePackDir(root, slug);
  if (!dir) return { ok: false, error: "Domain not found" };
  const chosen = rendering.trim();
  if (!chosen) return { ok: false, error: "Caption spelling is required" };
  const pack = loadDomainPack(dir);
  if (!pack.pending.some((p) => p.id === pendingId)) {
    return { ok: false, error: "That term is no longer pending" };
  }
  const next = applyInterviewChoice(pack.terms, pack.pending, pendingId, chosen);
  saveGlossary(dir, next.glossary);
  savePending(dir, next.pending);
  return { ok: true, pendingCount: next.pending.length };
}

export function createDomainPackFromTitle(
  root: string,
  title: string,
  notes?: string
): DomainPackDetail {
  const heading = title.trim();
  if (!heading) throw new Error("A name is required");
  const slug = uniquePackSlug(root, heading);
  const dir = createDomainPack(root, slug, heading);
  updatePackProfile(dir, composeProfile(heading, notes || ""));
  const detail = readPackDetail(root, slug);
  if (!detail) throw new Error("Failed to create domain");
  return detail;
}

export function createDomainPack(
  root: string,
  slug: string,
  title?: string
): string {
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `Invalid pack slug "${slug}" — use lowercase letters, digits, - or _`
    );
  }
  const dir = path.join(packsDir(root), slug);
  if (fs.existsSync(path.join(dir, "profile.md"))) {
    throw new Error(`Pack "${slug}" already exists`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const heading = title || slug;
  fs.writeFileSync(
    path.join(dir, "profile.md"),
    composeProfile(
      heading,
      [
        "Who speaks, the tone, the audience, recurring topics.",
        "",
        "Names:",
        "- Speaker and fan nicknames, and how they should appear in captions.",
        "",
        "Style:",
        "- Tone and voice for translations.",
      ].join("\n")
    ),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "glossary.json"),
    JSON.stringify({ terms: [] }, null, 2) + "\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "pending.json"),
    JSON.stringify({ pending: [] }, null, 2) + "\n",
    "utf8"
  );
  return dir;
}
