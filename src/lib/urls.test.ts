#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { detectPlatform, validateJobUrl } from "./urls";

test("validateJobUrl accepts TwitCasting archive URLs", () => {
  const r = validateJobUrl("https://twitcasting.tv/user/movie/123456789");
  assert.equal(r.ok, true);
});

test("validateJobUrl accepts YouTube URLs", () => {
  assert.equal(validateJobUrl("https://www.youtube.com/watch?v=abc123").ok, true);
  assert.equal(validateJobUrl("https://youtu.be/abc123").ok, true);
});

test("validateJobUrl accepts any http(s) URL for yt-dlp", () => {
  assert.equal(validateJobUrl("https://www.nicovideo.jp/watch/sm9").ok, true);
  assert.equal(validateJobUrl("http://vimeo.com/12345").ok, true);
});

test("validateJobUrl rejects non-http schemes and garbage", () => {
  assert.equal(validateJobUrl("ftp://example.com/file").ok, false);
  assert.equal(validateJobUrl("not a url").ok, false);
  assert.equal(validateJobUrl("").ok, false);
  assert.equal(validateJobUrl("javascript:alert(1)").ok, false);
});

test("detectPlatform names common platforms", () => {
  assert.equal(detectPlatform("https://twitcasting.tv/u/movie/1"), "TwitCasting");
  assert.equal(detectPlatform("https://www.youtube.com/watch?v=x"), "YouTube");
  assert.equal(detectPlatform("https://youtu.be/x"), "YouTube");
  assert.equal(detectPlatform("https://www.twitch.tv/videos/1"), "Twitch");
  assert.equal(detectPlatform("https://www.nicovideo.jp/watch/sm9"), "niconico");
  assert.equal(detectPlatform("https://example.org/v/9"), "example.org");
});
