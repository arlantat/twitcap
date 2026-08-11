#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDomainPack,
  listDomainPacks,
  resolvePackDir,
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
