#!/usr/bin/env npx tsx
/**
 * Drain pending glossary terms across domain packs via interview choices.
 *
 * Interactive (TTY): prompts for each pending term.
 * Agent / CI: pass --pack <slug> --choose <id>=<rendering> (repeatable).
 *
 * After a job mines ambiguous terms, run:
 *   npm run domain:resolve
 * Or have the Cursor agent AskQuestion, then:
 *   npx tsx scripts/resolve-pending-glossary.ts --pack matsuri --choose abc123=Matsurisu
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import {
  applyInterviewChoice,
  loadDomainPack,
  saveGlossary,
  savePending,
  type PendingTerm,
} from "../src/lib/domain";
import { listDomainPacks, resolvePackDir } from "../src/lib/domainPacks";

function domainRoot(): string {
  const raw = process.env.DOMAIN_DIR || "./domain";
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function parseChooses(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--choose" && argv[i + 1]) {
      const raw = argv[++i];
      const eq = raw.indexOf("=");
      if (eq > 0) out.set(raw.slice(0, eq), raw.slice(eq + 1));
    }
  }
  return out;
}

async function askLine(q: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(q, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function interviewOne(item: PendingTerm): Promise<string | null> {
  console.log("\n--- Pending glossary term ---");
  console.log(`id: ${item.id}  lang: ${item.lang}`);
  console.log(`JP: ${item.jp}`);
  if (item.context) console.log(`context: ${item.context}`);
  if (item.jobId) console.log(`job: ${item.jobId}`);
  item.candidates.forEach((c, i) => console.log(`  [${i + 1}] ${c}`));
  console.log(`  [0] skip`);
  console.log(`  or type a custom rendering`);

  if (!process.stdin.isTTY) {
    console.error(
      `[domain:resolve] non-TTY: use --choose ${item.id}=<rendering> (candidates: ${item.candidates.join(" | ")})`
    );
    return null;
  }

  const ans = await askLine("Choice: ");
  if (!ans || ans === "0" || ans.toLowerCase() === "skip") return null;
  const n = parseInt(ans, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= item.candidates.length) {
    return item.candidates[n - 1];
  }
  return ans;
}

async function resolvePack(dir: string, slug: string, chooses: Map<string, string>) {
  const pack = loadDomainPack(dir);
  if (!pack.pending.length) return 0;

  console.log(`\n=== Pack "${slug}" — ${pack.pending.length} pending term(s) ===`);
  let glossary = pack.terms;
  let pending = pack.pending;

  if (chooses.size) {
    for (const [id, tl] of Array.from(chooses.entries())) {
      if (!pending.some((p) => p.id === id)) continue;
      const result = applyInterviewChoice(glossary, pending, id, tl);
      glossary = result.glossary;
      pending = result.pending;
      console.log(`Applied ${id} → ${tl}`);
    }
  } else {
    for (const item of [...pending]) {
      const tl = await interviewOne(item);
      if (!tl) {
        console.log(`Skipped ${item.id}`);
        continue;
      }
      const result = applyInterviewChoice(glossary, pending, item.id, tl);
      glossary = result.glossary;
      pending = result.pending;
      console.log(`Locked ${item.jp} → ${tl} (${item.lang}, interview)`);
    }
  }

  saveGlossary(dir, glossary);
  savePending(dir, pending);
  console.log(`Saved pack "${slug}". Remaining pending: ${pending.length}`);
  return pending.length;
}

async function main() {
  const root = domainRoot();
  const chooses = parseChooses(process.argv.slice(2));
  const onlyPack = argValue("--pack");

  const packs = onlyPack
    ? [{ slug: onlyPack }]
    : listDomainPacks(root).map((p) => ({ slug: p.slug }));
  if (!packs.length) {
    console.log(`No domain packs found under ${path.join(root, "packs")}`);
    return;
  }

  let remaining = 0;
  let sawPending = false;
  for (const { slug } of packs) {
    const dir = resolvePackDir(root, slug);
    if (!dir) {
      console.error(`Pack not found: ${slug}`);
      continue;
    }
    const before = loadDomainPack(dir).pending.length;
    if (before > 0) sawPending = true;
    remaining += await resolvePack(dir, slug, chooses);
  }

  if (!sawPending) {
    console.log("No pending glossary terms in any pack.");
  } else if (remaining > 0) {
    console.log(
      "\nTip: Cursor agent can AskQuestion for each remaining term, then re-run with --pack <slug> --choose <id>=<rendering>."
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
