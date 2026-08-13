#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDomainPack,
  listDomainPacks,
  readPackDetail,
  resolvePackDir,
  slugFromTitle,
  uniquePackSlug,
  updatePackProfile,
  applyPackPendingChoice,
} from "./domainPacks";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "twitcap-packs-"));
}

test("createDomainPack scaffolds profile/glossary/pending", () => {
  const root = tmpRoot();
  const dir = createDomainPack(root, "cooking-shows", "JP cooking streams");
  assert.ok(fs.existsSync(path.join(dir, "profile.md")));
  assert.ok(fs.existsSync(path.join(dir, "glossary.json")));
  assert.ok(fs.existsSync(path.join(dir, "pending.json")));
  const profile = fs.readFileSync(path.join(dir, "profile.md"), "utf8");
  assert.match(profile, /JP cooking streams/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("createDomainPack rejects unsafe slugs", () => {
  const root = tmpRoot();
  assert.throws(() => createDomainPack(root, "../evil"));
  assert.throws(() => createDomainPack(root, "no spaces"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("listDomainPacks returns slug, title and counts", () => {
  const root = tmpRoot();
  createDomainPack(root, "matsuri", "Natsuiro Matsuri");
  createDomainPack(root, "cooking", "Cooking");
  const packs = listDomainPacks(root);
  const slugs = packs.map((p) => p.slug).sort();
  assert.deepEqual(slugs, ["cooking", "matsuri"]);
  const m = packs.find((p) => p.slug === "matsuri")!;
  assert.match(m.title, /Natsuiro Matsuri/);
  assert.equal(typeof m.termCount, "number");
  assert.equal(typeof m.pendingCount, "number");
  fs.rmSync(root, { recursive: true, force: true });
});

test("resolvePackDir guards traversal and missing packs", () => {
  const root = tmpRoot();
  createDomainPack(root, "matsuri");
  assert.ok(resolvePackDir(root, "matsuri"));
  assert.equal(resolvePackDir(root, "../outside"), null);
  assert.equal(resolvePackDir(root, "ghost"), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test("slugFromTitle makes a safe lowercase slug", () => {
  assert.equal(slugFromTitle("Usada Pekora"), "usada-pekora");
  assert.equal(slugFromTitle("Natsuiro Matsuri!!"), "natsuiro-matsuri");
});

test("slugFromTitle falls back when the title has no latin letters", () => {
  assert.equal(slugFromTitle("夏色まつり").startsWith("pack"), true);
});

test("uniquePackSlug avoids collisions", () => {
  const root = tmpRoot();
  createDomainPack(root, "usada-pekora");
  assert.equal(uniquePackSlug(root, "Usada Pekora"), "usada-pekora-2");
  fs.rmSync(root, { recursive: true, force: true });
});

test("updatePackProfile rewrites profile.md", () => {
  const root = tmpRoot();
  const dir = createDomainPack(root, "pekora", "Usada Pekora");
  updatePackProfile(dir, "# Domain: Usada Pekora\n\nCasual JP streams.\n");
  const detail = readPackDetail(root, "pekora");
  assert.ok(detail);
  assert.match(detail.profile, /Casual JP streams/);
  assert.equal(detail.title, "Usada Pekora");
  fs.rmSync(root, { recursive: true, force: true });
});

test("readPackDetail includes saved names after a spelling choice", () => {
  const root = tmpRoot();
  const dir = createDomainPack(root, "pekora", "Pekora");
  fs.writeFileSync(
    path.join(dir, "pending.json"),
    JSON.stringify({
      pending: [
        {
          id: "abc123",
          jp: "ぺこら",
          lang: "vi",
          candidates: ["Pekora"],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
    "utf8"
  );
  applyPackPendingChoice(root, "pekora", "abc123", "Pekora");
  const detail = readPackDetail(root, "pekora")!;
  assert.equal(detail.names.length, 1);
  assert.equal(detail.names[0].jp, "ぺこら");
  assert.equal(detail.names[0].captions.vi, "Pekora");
  fs.rmSync(root, { recursive: true, force: true });
});

test("applyPackPendingChoice writes glossary and clears the item", () => {
  const root = tmpRoot();
  const dir = createDomainPack(root, "pekora", "Pekora");
  fs.writeFileSync(
    path.join(dir, "pending.json"),
    JSON.stringify({
      pending: [
        {
          id: "abc123",
          jp: "ぺこら",
          lang: "vi",
          candidates: ["Pekora"],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
    "utf8"
  );
  const result = applyPackPendingChoice(root, "pekora", "abc123", "Pekora");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pendingCount, 0);
  const detail = readPackDetail(root, "pekora")!;
  assert.equal(detail.pending.length, 0);
  assert.equal(detail.termCount, 1);
  fs.rmSync(root, { recursive: true, force: true });
});


