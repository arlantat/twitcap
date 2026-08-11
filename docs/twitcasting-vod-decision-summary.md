# TwitCasting JP→EN: How we landed on old VODs

**Date:** early August 2026  
**Decision:** Build an **archive / old-VOD pipeline** first. Defer live speech captions.

---

## Starting point

We wanted **Japanese → English** understanding for TwitCasting content (spoken audio), with a preference for **mobile** where possible.

Earlier research on YouTube JP→EN captions established a useful rule that carried over:

> Native auto-translate is often “sad” because cheap ASR + cheap NMT compound. Better pipelines **transcribe Japanese first**, then translate with a stronger model - not one-shot “ASR translate.”

That same split (JP text → EN text) became the core of the TwitCasting plan.

---

## What TwitCasting already solves (and what it doesn’t)

From the `/last30days` TwitCasting research:

| Layer | Native support? | Notes |
|-------|-----------------|--------|
| **Live chat** | Yes | Comment AI Translation → EN / KO / ZH-TW on app + web |
| **Spoken Japanese (live)** | No | No first-party EN speech captions |
| **Spoken Japanese (archives)** | No | Same gap; Language Reactor–style CC tooling doesn’t apply |

So chat was never the product. **Voice** was.

Mobile speech options that exist today (e.g. Whisperr-style floating overlays) work for *watching* live or replays, but they are rough live-ASR quality - fine for listening along, not for shipping good EN subtitle files.

---

## Build constraints we hit

You wanted to build this yourself, with Cursor / **Composer 2.5** as the available coding model.

Two hard constraints:

1. **Composer cannot do ASR.** It doesn’t take audio. Open-source Whisper-family (or Qwen3-ASR) is required for recognition.
2. **Composer is the wrong runtime for live JP→EN.** Live needs ~200–800ms per utterance. Composer is an agent coding loop (multi-second turns, tools, repo context) - useful to *scaffold* code, not to caption a stream.

That pushed the design into:

```
Composer / Cursor  →  build the product
Local ASR + local/cheap MT  →  run the product
```

---

## Two pipelines, one core

| Path | Input | Hard part | Output |
|------|--------|-----------|--------|
| **Live** | Continuous audio | Latency, chunking, mobile capture | Floating EN captions |
| **Archive (VOD)** | TwitCast URL / file | Download + long audio | EN `.srt` / `.vtt` |

Shared core: `audio → JP text → EN text → timed captions`.

**Live ≫ VOD in difficulty** (especially on mobile: Broadcast Extension / MediaProjection). So we ordered the work as:

1. Prove quality offline on old casts  
2. Only then chase live latency and mobile overlays  

---

## The decision: start with old VODs

**We chose archive / old TwitCast VODs as the MVP.**

Reasons:

- Quality is measurable offline (pick hard clips: slang, music, overlapping chat).
- No live latency budget - we can use better ASR + chunked LLM translation.
- yt-dlp already handles TwitCasting downloads (cookies later for locked casts).
- Composer can scaffold the CLI/pipeline without being in the hot path.
- Success here (good EN SRT) validates the whole product idea before live engineering.

Live and mobile remain **phase 2+**, not abandoned - just not the first ship target.

---

## Agreed VOD stack (Aug 2026)

```
TwitCast URL
  → yt-dlp (audio)
  → JP ASR (transcribe only — do not Whisper-translate)
  → timed JP segments
  → context-aware EN translation (chunked clauses, not 1s shards)
  → EN .srt / .vtt
```

**Ship-this combo:**

> **yt-dlp → faster-whisper `large-v3-turbo` (`language=ja`, `task=transcribe`) → Ollama Qwen2.5/3 (chunked SRT translate) → EN.srt**

Optional ASR upgrade later: **Qwen3-ASR 1.7B** if JP accuracy needs another step.

**Do not:**

- Use Whisper `task=translate` as the product path  
- Put Composer in the production translate loop  
- Confuse Comment AI Translation (chat) with speech captions  

---

## What we explicitly deferred

- Real-time floating captions over live TwitCast  
- Native mobile app capture (iOS/Android overlays)  
- Locked / passcode casts (cookies - phase 2)  
- Chat translation as a product feature (already mostly solved by TwitCasting)

---

## One-line summary

> TwitCasting won’t caption the voice; live speech is too hard for a first ship; Composer can build but not run ASR/live MT - so we start with **old VODs → yt-dlp → JP ASR → chunked EN translation → SRT**.
