#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { cueAtTime } from "./captionTiming";

test("cueAtTime prefers latest-starting covering cue", () => {
  const cues = [
    { start: 0, end: 2, text: "a" },
    { start: 1.5, end: 3, text: "b" },
  ];
  assert.equal(cueAtTime(cues, 1.6), "b");
  assert.equal(cueAtTime(cues, 0.5), "a");
  assert.equal(cueAtTime(cues, 4), "");
});

test("cueAtTime applies offset so positive delay shows earlier cue", () => {
  // offsetSec > 0 means captions lag voice → look earlier on the timeline
  const cues = [
    { start: 10, end: 12, text: "early" },
    { start: 12, end: 14, text: "late" },
  ];
  assert.equal(cueAtTime(cues, 12.1, 0), "late");
  assert.equal(cueAtTime(cues, 12.1, 0.5), "early");
});
