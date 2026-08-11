#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { LANGS, resolveTargetLang } from "./lang";

test("resolveTargetLang defaults to Vietnamese", () => {
  assert.equal(resolveTargetLang(undefined), "vi");
  assert.equal(resolveTargetLang(""), "vi");
  assert.equal(resolveTargetLang("xx"), "vi");
});

test("resolveTargetLang accepts vi and en aliases", () => {
  assert.equal(resolveTargetLang("vi"), "vi");
  assert.equal(resolveTargetLang("VI"), "vi");
  assert.equal(resolveTargetLang("vietnamese"), "vi");
  assert.equal(resolveTargetLang("en"), "en");
  assert.equal(resolveTargetLang("english"), "en");
});

test("LANGS carries name and style guide per language", () => {
  assert.equal(LANGS.vi.name, "Vietnamese");
  assert.equal(LANGS.en.name, "English");
  assert.ok(LANGS.vi.styleLines.length >= 3);
  assert.ok(LANGS.en.styleLines.length >= 3);
  // VI style must pin pronouns so the voice stays consistent across batches.
  assert.match(LANGS.vi.styleLines.join("\n"), /mình/);
});
