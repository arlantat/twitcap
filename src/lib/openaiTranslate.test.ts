#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenAIChatText, promptOpenAI } from "./openaiTranslate";

test("parseOpenAIChatText reads assistant message content", () => {
  const text = parseOpenAIChatText({
    choices: [{ message: { content: "1. Xin chào\n2. Mọi người" } }],
  });
  assert.equal(text, "1. Xin chào\n2. Mọi người");
});

test("parseOpenAIChatText rejects empty completions", () => {
  assert.throws(() => parseOpenAIChatText({ choices: [] }), /empty/i);
});

test("promptOpenAI posts chat completions with the model and prompt", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "1. Hello" } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  const out = await promptOpenAI("sk-test", "gpt-5-nano", "Translate this", fetchMock);
  assert.equal(out, "1. Hello");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, "gpt-5-nano");
  assert.equal(body.messages[0].role, "user");
  assert.match(body.messages[0].content, /Translate this/);
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer sk-test");
});
