#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyProposalsToDomainDir } from "./applyDomainProposals";
import { loadDomainPack } from "./domain";

test("applyProposalsToDomainDir persists auto and pending per language", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "twitcap-apply-"));
  fs.writeFileSync(path.join(dir, "profile.md"), "x\n");
  fs.writeFileSync(
    path.join(dir, "glossary.json"),
    JSON.stringify({ terms: [] }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "pending.json"),
    JSON.stringify({ pending: [] }),
    "utf8"
  );

  const stats = applyProposalsToDomainDir(
    dir,
    [
      { jp: "まつりす", tl: "Matsurisu", confidence: "high", alternatives: [] },
      { jp: "謎語", tl: "A", confidence: "low", alternatives: ["B"] },
    ],
    { lang: "vi", jobId: "job1" }
  );

  assert.equal(stats.autoAdded, 1);
  assert.equal(stats.enqueued, 1);
  const pack = loadDomainPack(dir);
  assert.equal(pack.terms.length, 1);
  assert.equal(pack.terms[0].translations.vi, "Matsurisu");
  assert.equal(pack.pending.length, 1);
  assert.equal(pack.pending[0].lang, "vi");
  fs.rmSync(dir, { recursive: true, force: true });
});
