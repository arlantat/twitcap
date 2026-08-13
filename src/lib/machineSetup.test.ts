#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { recommendMachineSetup, upsertEnvLocal } from "./machineSetup";

test("12 GB RAM uses faster-whisper and an 8B Ollama model", () => {
  const s = recommendMachineSetup(12);
  assert.equal(s.asrBackend, "faster-whisper");
  assert.equal(s.whisperModel, "large-v3-turbo");
  assert.equal(s.ollamaModel, "qwen3:8b");
  assert.equal(s.fits, true);
});

test("under 10 GB RAM steps Whisper down to medium", () => {
  const s = recommendMachineSetup(8);
  assert.equal(s.whisperModel, "medium");
  assert.equal(s.ollamaModel, "qwen3:8b");
  assert.equal(s.fits, true);
});

test("16 GB RAM may use 14B for Japanese cleanup", () => {
  const s = recommendMachineSetup(16);
  assert.equal(s.asrBackend, "faster-whisper");
  assert.equal(s.ollamaModel, "qwen3:14b");
  assert.equal(s.fits, true);
});

test("upsertEnvLocal inserts missing keys and leaves existing secrets", () => {
  const prev = "OPENAI_API_KEY=sk-keep\nASR_BACKEND=qwen3\n";
  const next = upsertEnvLocal(prev, {
    ASR_BACKEND: "faster-whisper",
    WHISPER_MODEL: "large-v3-turbo",
    TRANSLATE_MODEL: "qwen3:8b",
    NORMALIZE_JP_MODEL: "qwen3:8b",
    PYTHON_BIN: ".venv/bin/python",
  });
  assert.match(next, /OPENAI_API_KEY=sk-keep/);
  assert.match(next, /^ASR_BACKEND=faster-whisper$/m);
  assert.match(next, /^TRANSLATE_MODEL=qwen3:8b$/m);
  assert.match(next, /^PYTHON_BIN=\.venv\/bin\/python$/m);
});
