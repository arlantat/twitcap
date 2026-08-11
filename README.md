# TwitCap — VOD captions for Japanese streams (VI / EN)

Timed **Vietnamese (default) or English** captions for **Japanese spoken
audio** on TwitCasting archives, YouTube videos, and any other
[yt-dlp-supported](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)
URL. Mobile-first web app wrapping a fully local pipeline:

```
Video URL (TwitCasting / YouTube / any yt-dlp site)
   │  yt-dlp (best audio)
   ▼
audio.m4a
   │  JP ASR (Qwen3-ASR default; faster-whisper via ASR_BACKEND)
   │  language=ja / Japanese, task=transcribe — never Whisper-translate
   ▼
timed JP segments
   │  JP normalize (Ollama) — merge/clean into clear Japanese sentences
   ▼
captions.jp.srt
   │  JP→VI/EN via Cursor Composer 2.5 (default) or local Ollama
   │  + domain pack (streamer context + per-language glossary)
   ▼
captions.<lang>.srt / .vtt / segments.<lang>.json
   ▼
Mobile player with caption overlay + SRT/VTT download buttons
```

Design rules honored (see `docs/twitcasting-vod-decision-summary.md`):

- **Transcribe Japanese first, then translate** — Whisper `task=translate` is
  never used; Composer (or local LLM) translates timed JP segments.
- **Vietnamese-first** — `TARGET_LANG=vi` is the default; per-job language
  picker in the UI (VI/EN). Prompts carry language-specific style guides
  (consistent pronouns, natural spoken register) plus rolling bilingual
  context for cross-batch consistency.
- **Cursor SDK MT** — default `TRANSLATE_BACKEND=cursor` uses Composer 2.5
  non-fast via `@cursor/sdk` (requires a **Pro+** `CURSOR_API_KEY`; Hobby/free
  keys fail with `plan_required`). Set `TRANSLATE_BACKEND=ollama` to fall back.
- **No coding agents in the ASR hot path** — ASR stays local; only MT uses
  Cursor SDK when enabled.
- **VOD/archive only** — live floating captions are out of scope for this MVP.
- **ASR** — `qwen3` is the default (denser mid-stream recall); set
  `ASR_BACKEND=faster-whisper` for speed/cleaner openings.
- **Domain memory packs** — per-domain context + glossary in
  `domain/packs/<slug>` (ships with `matsuri`; create your own with
  `npm run domain:new -- <slug>`). Injected into every MT batch; an Ollama
  miner auto-grows the glossary per language after each job; ambiguous terms
  queue for `npm run domain:resolve` (Cursor interview / interactive
  choices). You do not edit glossary files by hand — see `domain/README.md`.
- **Caption sync** — ASR timing repair prefers speech anchors; the player has
  a Delay slider (−2s…+2s) for residual A/V offset.

---

## Prerequisites

| Tool | Why | Install |
| --- | --- | --- |
| Node.js ≥ 18.17 | web app + job runner | https://nodejs.org |
| Python ≥ 3.10 | ASR + translate scripts | https://www.python.org |
| yt-dlp | TwitCasting download | `pipx install yt-dlp` or `brew install yt-dlp` |
| Ollama | local JP→EN translation + polish | https://ollama.com then `ollama pull qwen3:14b` |
| ffmpeg | (recommended) some yt-dlp formats | `brew install ffmpeg` / apt |

GPU optional but recommended for ASR speed. On pure CPU, `large-v3-turbo`
with `int8` is workable; drop to `medium` in `.env.local` if it's too slow.

## Setup

```bash
# 1. app deps
npm install

# 2. python deps (faster-whisper)
python3 -m pip install -r pipeline/requirements.txt   # or: npm run setup:pipeline

# 2b. Qwen3-ASR (default backend)
python3 -m pip install -r pipeline/requirements-qwen3.txt   # or: npm run setup:qwen3

# 3. translation / normalize model
ollama pull qwen3:14b         # recommended; lighter: qwen3:8b

# 4. env
cp .env.example .env.local    # defaults work for most setups

# 5. run — LAN mode so your phone can reach it
npm run dev:lan               # binds 0.0.0.0, port 3000
```

The home screen shows a **setup doctor** card until every dependency checks out
(yt-dlp, Python, faster-whisper, Ollama + model).

## Use it on your phone

1. Find your computer's LAN IP (`ipconfig getifaddr en0` on macOS,
   `hostname -I` on Linux).
2. On your phone (same Wi-Fi): open `http://<LAN-IP>:3000`.
3. Optional PWA install: iOS Safari → Share → *Add to Home Screen*;
   Android Chrome → ⋮ → *Install app / Add to Home screen*.
4. Paste a TwitCasting archive URL
   (`https://twitcasting.tv/<user>/movie/<id>`) → **Caption it**.
5. Watch progress (download → JP ASR → JP normalize → EN translation), then play
   with the English caption overlay and grab the **EN .srt / .vtt** files.

Jobs run **serially** (one at a time) since ASR/MT are heavy; new submissions
queue up. State lives in `data/jobs/<id>/` (audio, segments JSON, SRT/VTT,
`job.json`), so reloads don't lose anything.

## Environment variables (`.env.local`)

| Var | Default | Notes |
| --- | --- | --- |
| `YTDLP_BIN` | `yt-dlp` | binary name/path |
| `YTDLP_EXTRA_ARGS` | _(empty)_ | e.g. `--cookies-from-browser "chrome:Profile 1"` |
| `PYTHON_BIN` | `python3` | |
| `ASR_BACKEND` | `qwen3` | `faster-whisper` for speed/cleaner openings |
| `WHISPER_MODEL` | `large-v3-turbo` | used when `ASR_BACKEND=faster-whisper` |
| `WHISPER_DEVICE` | `auto` | `cpu` / `cuda` |
| `WHISPER_COMPUTE_TYPE` | `int8` | `float16` on GPU |
| `WHISPER_MAX_CUE_SECONDS` / `CHARS` | `8` / `42` | subtitle-sized JP cues |
| `QWEN_ASR_MODEL` | `Qwen/Qwen3-ASR-1.7B` | used when `ASR_BACKEND=qwen3` |
| `QWEN_ALIGNER_MODEL` | `Qwen/Qwen3-ForcedAligner-0.6B` | timestamps (≤~5 min / chunk) |
| `QWEN_ASR_DEVICE` | `auto` | `mps` / `cpu` / `cuda` |
| `QWEN_ASR_CHUNK_SECONDS` | `240` | chunk length for long VODs |
| `TARGET_LANG` | `vi` | default caption language (`vi` / `en`); per-job override in UI |
| `TRANSLATE_BACKEND` | `cursor` | `ollama` for local MT |
| `CURSOR_API_KEY` | _(required for cursor)_ | from [Integrations](https://cursor.com/dashboard/integrations) |
| `CURSOR_TRANSLATE_MODEL` | `composer-2.5` | non-fast Composer |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | JP normalize (+ ollama MT) |
| `TRANSLATE_MODEL` | `qwen3:14b` | when `TRANSLATE_BACKEND=ollama` |
| `TRANSLATE_CHUNK_LINES` / `TRANSLATE_CHUNK_CHARS` | `15` / `1200` | translation batching |
| `POLISH_JP` | `1` | `0` disables JP normalize before MT |
| `NORMALIZE_JP_MODEL` | `qwen3:14b` | JP merge/clean model |
| `NORMALIZE_JP_CHUNK_LINES` / `CHARS` | `20` / `1800` | JP normalize batching |
| `POLISH_EN` | `0` | `1` enables optional EN polish after MT |
| `POLISH_MODEL` | `qwen3:14b` | EN rewrite model when polish enabled |
| `DOMAIN_ENABLED` | `1` | `0` disables domain packs + post-job mining |
| `DOMAIN_DIR` | `./domain` | packs live in `<dir>/packs/<slug>` |
| `DOMAIN_PACK` | `matsuri` | default pack for new jobs (UI can override) |
| `DOMAIN_MINE_MODEL` | `qwen3:14b` | Ollama model for glossary mining |
| `JOBS_DIR` | `./data/jobs` | artifact storage |

## Troubleshooting

- **"Could not start yt-dlp"** — install it / fix `YTDLP_BIN`.
- **faster-whisper install fails** — Python ≥3.10 required; on some systems
  `pip install av` wheels need ffmpeg dev headers.
- **qwen3-asr import fails** — `npm run setup:qwen3` (torch + qwen-asr). First
  job downloads model weights from Hugging Face.
- **Translation step fails immediately** — Ollama not running or model not
  pulled: `ollama serve` + `ollama pull $TRANSLATE_MODEL`.
- **Very slow on CPU** — expected for long casts; Whisper: try `WHISPER_MODEL=medium`;
  Qwen3: prefer `QWEN_ASR_DEVICE=mps` on Apple Silicon.
- **Phone can't reach the app** — use `npm run dev:lan`, same Wi-Fi, and allow
  port 3000 through the OS firewall.
- **No captions visible in player** — the app renders its own caption overlay
  (CC toggle).
- **Duplicate caption lines** — refresh after updates; only the overlay should show.

## Deferred (per the decision doc)

Live floating captions, native overlay capture, locked/passcode casts
(cookies via `YTDLP_EXTRA_ARGS` are the escape hatch), chat translation.
