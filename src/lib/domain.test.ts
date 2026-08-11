#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyInterviewChoice,
  classifyAndMergeProposals,
  formatDomainBlock,
  loadDomainPack,
  normalizeJpKey,
  type GlossaryTerm,
  type PendingTerm,
  type TermProposal,
} from "./domain";
import { buildTranslatePrompt } from "./subtitleTranslate";
import { LANGS } from "./lang";

function term(
  jp: string,
  translations: Record<string, string>,
  source: GlossaryTerm["source"] = "seed",
  count = 1
): GlossaryTerm {
  return { jp, translations, source, count };
}

test("normalizeJpKey strips whitespace", () => {
  assert.equal(normalizeJpKey("  まつりす\n"), "まつりす");
});

test("formatDomainBlock renders terms for the requested language", () => {
  const block = formatDomainBlock({
    profile: "Matsuri livestreams.\nKeep playful tone.",
    terms: [
      term("まつりす", { en: "Matsurisu", vi: "Matsurisu" }),
      term("ホロライブ", { en: "Hololive" }), // no vi entry → skipped for vi
    ],
    lang: "vi",
  });
  assert.match(block, /DOMAIN:/);
  assert.match(block, /Matsuri livestreams/);
  assert.match(block, /まつりす → Matsurisu/);
  assert.doesNotMatch(block, /ホロライブ/);
});

test("formatDomainBlock caps glossary by count", () => {
  const terms: GlossaryTerm[] = [];
  for (let i = 0; i < 60; i++) {
    terms.push(term(`語${i}`, { vi: `Từ${i}` }, "learned", i));
  }
  const block = formatDomainBlock({ profile: "x", terms, lang: "vi", maxTerms: 40 });
  const lines = block.split("\n").filter((l) => l.includes("→"));
  assert.equal(lines.length, 40);
  assert.match(block, /語59 → Từ59/);
});

test("buildTranslatePrompt injects domain block and language spec", () => {
  const domain = formatDomainBlock({
    profile: "Natsuiro Matsuri.",
    terms: [term("まつり", { vi: "Matsuri" })],
    lang: "vi",
  });
  const prompt = buildTranslatePrompt(
    [{ id: 1, start: 0, end: 1, text: "こんにちは" }],
    [],
    domain,
    LANGS.vi
  );
  assert.match(prompt, /Vietnamese/);
  assert.match(prompt, /mình/);
  assert.match(prompt, /まつり → Matsuri/);
  assert.match(prompt, /1\. こんにちは/);
  assert.doesNotMatch(prompt, /into English captions/);
});

test("buildTranslatePrompt shows previous translations as context", () => {
  const prompt = buildTranslatePrompt(
    [{ id: 3, start: 1, end: 2, text: "こんばんは" }],
    [{ id: 2, text: "先ほどの話", tl: "Chuyện lúc nãy" }],
    "",
    LANGS.vi
  );
  assert.match(prompt, /先ほどの話/);
  assert.match(prompt, /Chuyện lúc nãy/);
});

test("classifyAndMergeProposals auto-adds new high-confidence terms per lang", () => {
  const proposals: TermProposal[] = [
    { jp: "こんまつりー", tl: "Konmatsuri!", confidence: "high", alternatives: [] },
  ];
  const result = classifyAndMergeProposals([], [], proposals, {
    lang: "vi",
    jobId: "abc",
  });
  assert.equal(result.glossary.length, 1);
  assert.equal(result.glossary[0].translations.vi, "Konmatsuri!");
  assert.equal(result.glossary[0].source, "learned");
  assert.equal(result.autoAdded, 1);
});

test("classifyAndMergeProposals fills a missing language on an existing term", () => {
  const glossary = [term("まつりす", { en: "Matsurisu" }, "seed", 2)];
  const result = classifyAndMergeProposals(
    glossary,
    [],
    [{ jp: "まつりす", tl: "Matsurisu", confidence: "high", alternatives: [] }],
    { lang: "vi", jobId: "j1" }
  );
  assert.equal(result.glossary[0].translations.vi, "Matsurisu");
  assert.equal(result.glossary[0].translations.en, "Matsurisu");
  assert.equal(result.pending.length, 0);
});

test("classifyAndMergeProposals bumps count for same translation", () => {
  const glossary = [term("まつりす", { vi: "Matsurisu" }, "seed", 2)];
  const result = classifyAndMergeProposals(
    glossary,
    [],
    [{ jp: "まつりす", tl: "Matsurisu", confidence: "high", alternatives: [] }],
    { lang: "vi", jobId: "j1" }
  );
  assert.equal(result.glossary[0].count, 3);
});

test("classifyAndMergeProposals enqueues conflicts instead of overwriting", () => {
  const glossary = [term("はあと", { vi: "Haato" }, "seed", 3)];
  const result = classifyAndMergeProposals(
    glossary,
    [],
    [{ jp: "はあと", tl: "Haachama", confidence: "high", alternatives: [] }],
    { lang: "vi", jobId: "j2" }
  );
  assert.equal(result.glossary[0].translations.vi, "Haato");
  assert.equal(result.pending.length, 1);
  assert.equal(result.pending[0].lang, "vi");
  assert.ok(result.pending[0].candidates.includes("Haachama"));
  assert.ok(result.pending[0].candidates.includes("Haato"));
});

test("classifyAndMergeProposals enqueues low-confidence proposals", () => {
  const result = classifyAndMergeProposals(
    [],
    [],
    [
      {
        jp: "お茶わんか",
        tl: "Ochawanka",
        confidence: "low",
        alternatives: ["Ocha Wanka"],
      },
    ],
    { lang: "vi", jobId: "j3" }
  );
  assert.equal(result.glossary.length, 0);
  assert.equal(result.pending.length, 1);
});

test("applyInterviewChoice writes the pending language and clears the queue", () => {
  const glossary = [term("まつり", { vi: "Matsuri" })];
  const pending: PendingTerm[] = [
    {
      id: "p1",
      jp: "はあと",
      lang: "vi",
      candidates: ["Haato", "Haachama"],
      jobId: "j",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const result = applyInterviewChoice(glossary, pending, "p1", "Haachama");
  assert.equal(result.pending.length, 0);
  const t = result.glossary.find((x) => x.jp === "はあと");
  assert.ok(t);
  assert.equal(t!.translations.vi, "Haachama");
  assert.equal(t!.source, "interview");
});

test("loadDomainPack migrates legacy en-field glossaries", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "twitcap-domain-"));
  fs.writeFileSync(path.join(dir, "profile.md"), "Hello Matsuri.\n", "utf8");
  fs.writeFileSync(
    path.join(dir, "glossary.json"),
    JSON.stringify({
      terms: [{ jp: "まつり", en: "Matsuri", source: "seed", count: 1 }],
    }),
    "utf8"
  );
  const pack = loadDomainPack(dir);
  assert.equal(pack.terms.length, 1);
  assert.equal(pack.terms[0].translations.en, "Matsuri");
  assert.equal(pack.pending.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
