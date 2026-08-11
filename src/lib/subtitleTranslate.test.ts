#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBatchTranslations,
  buildTranslatePrompt,
  makeBatches,
  parseNumberedLines,
} from "./subtitleTranslate";

test("parseNumberedLines accepts dotted and ranged-looking single ids", () => {
  const parsed = parseNumberedLines(
    "12. Hello there.\n13) Good night.\n14: See you.\nnot a line\n15.  Still ok"
  );
  assert.deepEqual(parsed, {
    12: "Hello there.",
    13: "Good night.",
    14: "See you.",
    15: "Still ok",
  });
});

test("makeBatches splits on lines and chars", () => {
  const segs = [
    { id: 0, start: 0, end: 1, text: "あ".repeat(10) },
    { id: 1, start: 1, end: 2, text: "い".repeat(10) },
    { id: 2, start: 2, end: 3, text: "う".repeat(10) },
  ];
  const batches = [...makeBatches(segs, 2, 1000)];
  assert.equal(batches.length, 2);
  assert.equal(batches[0].length, 2);
  assert.equal(batches[1].length, 1);
});

test("buildTranslatePrompt asks for coherent English numbered lines", () => {
  const prompt = buildTranslatePrompt(
    [{ id: 3, start: 1, end: 2, text: "こんばんは" }],
    [{ id: 2, text: "先ほどの話" }]
  );
  assert.match(prompt, /coherent/i);
  assert.match(prompt, /3\. こんばんは/);
  assert.match(prompt, /Context/);
  assert.match(prompt, /Do NOT use tools/i);
});

test("buildTranslatePrompt includes optional domain block", () => {
  const prompt = buildTranslatePrompt(
    [{ id: 1, start: 0, end: 1, text: "はい" }],
    [],
    "DOMAIN:\nMatsuri\n\nGLOSSARY:\nまつり → Matsuri\n"
  );
  assert.match(prompt, /DOMAIN:/);
  assert.match(prompt, /まつり → Matsuri/);
});

test("applyBatchTranslations keeps JP when model omits a line", () => {
  const batch = [
    { id: 1, start: 0, end: 1, text: "はい" },
    { id: 2, start: 1, end: 2, text: "ね" },
  ];
  const out = applyBatchTranslations(batch, { 1: "Yes." });
  assert.equal(out[1], "Yes.");
  assert.equal(out[2], "ね");
});
