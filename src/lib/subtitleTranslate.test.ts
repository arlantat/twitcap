#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBatchTranslations,
  buildTranslatePrompt,
  makeBatches,
  parseNumberedLines,
  reflowSentence,
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

test("reflowSentence splits translation across cues by JP weight", () => {
  const pieces = reflowSentence("Mọi người bình tĩnh ăn bánh mì đi nha nhé", [
    { jpLen: 10 },
    { jpLen: 10 },
  ]);
  assert.equal(pieces.length, 2);
  assert.ok(pieces[0].length > 0 && pieces[1].length > 0);
  assert.equal(pieces.join(" "), "Mọi người bình tĩnh ăn bánh mì đi nha nhé");
  // roughly balanced: neither side takes almost everything
  assert.ok(pieces[0].split(" ").length >= 3);
  assert.ok(pieces[1].split(" ").length >= 3);
});

test("reflowSentence single cue gets whole sentence", () => {
  const pieces = reflowSentence("Xin chào.", [{ jpLen: 5 }]);
  assert.deepEqual(pieces, ["Xin chào."]);
});

test("reflowSentence never returns empty pieces when words are scarce", () => {
  const pieces = reflowSentence("Ừ.", [{ jpLen: 4 }, { jpLen: 4 }, { jpLen: 4 }]);
  assert.equal(pieces.length, 3);
  assert.equal(pieces[0], "Ừ.");
  // Trailing cues without words repeat nothing — empty string means "hide cue".
  assert.equal(pieces[1], "");
  assert.equal(pieces[2], "");
});

test("reflowSentence respects uneven JP weights", () => {
  const long = "một hai ba bốn năm sáu bảy tám chín mười";
  const pieces = reflowSentence(long, [{ jpLen: 30 }, { jpLen: 10 }]);
  assert.equal(pieces.length, 2);
  assert.ok(
    pieces[0].split(" ").length > pieces[1].split(" ").length,
    `expected first piece longer: ${JSON.stringify(pieces)}`
  );
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
