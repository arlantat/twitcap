#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { resolveTranslateBackend } from "./translateBackend";

test("explicit TRANSLATE_BACKEND wins over keys", () => {
  assert.equal(
    resolveTranslateBackend({
      TRANSLATE_BACKEND: "openai",
      CURSOR_API_KEY: "ck",
      OPENAI_API_KEY: "ok",
    }),
    "openai"
  );
  assert.equal(
    resolveTranslateBackend({
      TRANSLATE_BACKEND: "cursor",
      OPENAI_API_KEY: "ok",
    }),
    "cursor"
  );
  assert.equal(
    resolveTranslateBackend({
      TRANSLATE_BACKEND: "ollama",
      CURSOR_API_KEY: "ck",
      OPENAI_API_KEY: "ok",
    }),
    "ollama"
  );
});

test("auto uses Cursor key, else OpenAI key, else Ollama", () => {
  assert.equal(
    resolveTranslateBackend({
      CURSOR_API_KEY: "ck",
      OPENAI_API_KEY: "ok",
    }),
    "cursor"
  );
  assert.equal(
    resolveTranslateBackend({
      OPENAI_API_KEY: "ok",
    }),
    "openai"
  );
  assert.equal(resolveTranslateBackend({}), "ollama");
  assert.equal(
    resolveTranslateBackend({ TRANSLATE_BACKEND: "auto", OPENAI_API_KEY: "ok" }),
    "openai"
  );
});
