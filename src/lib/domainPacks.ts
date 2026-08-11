/** Multiple domain packs: domain/packs/<slug>/{profile.md,glossary.json,pending.json}. */

import fs from "fs";
import path from "path";
import { loadDomainPack } from "./domain";

const SLUG_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

export type DomainPackInfo = {
  slug: string;
  title: string;
  termCount: number;
  pendingCount: number;
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
    [
      `# Domain: ${heading}`,
      "",
      "Describe the streams this pack covers: who speaks, the tone, the audience,",
      "recurring topics. Keep it short (~15 lines) — it is injected into every",
      "translation batch.",
      "",
      "## Naming",
      "",
      "- List speaker/fan names and how to render them.",
      "",
      "## Style",
      "",
      "- Tone/voice notes for translations.",
      "",
    ].join("\n"),
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
