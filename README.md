# TwitCap

Paste a **Japanese VOD link**. Get **Vietnamese** (default) or **English**
captions on your laptop or phone. Audio is transcribed locally; translation
uses Cursor Composer 2.5, OpenAI `gpt-5-nano`, or local Ollama.

Works with TwitCasting archives, YouTube, and most
[yt-dlp sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md).
MIT licensed.

## Setup

**12 GB RAM is enough** on the default installer path (faster-whisper +
`qwen3:8b` for Japanese cleanup; translation via OpenAI). 16 GB is more
comfortable. The heavy Qwen ASR stack is optional and wants more RAM.

After clone:

```bash
git clone https://github.com/arlantat/twitcap.git
cd twitcap
npm run setup
```

That installs Node/Python/ffmpeg/yt-dlp/Ollama when it can (Homebrew on macOS,
apt on Debian/Ubuntu), creates a Python venv, installs faster-whisper, writes
`.env.local` for this machine's RAM, pulls the matching Ollama model, and
prompts for an OpenAI API key.

Then:

```bash
npm run dev:lan
```

TwitCasting archives need a logged-in browser. In `.env.local`:

```
YTDLP_EXTRA_ARGS=--cookies-from-browser "chrome:Profile 1"
```

YouTube usually works without cookies. Open the LAN address on a phone on the
same Wi-Fi. The setup doctor lists anything still missing.

To try denser Japanese ASR later (16 GB+): `npm run setup:qwen3` and
`ASR_BACKEND=qwen3` (Apple Silicon: `QWEN_ASR_DEVICE=mps`).

## Pipeline

```
Video URL
   │  yt-dlp (best audio)
   ▼
JP ASR (faster-whisper or Qwen3-ASR) → never Whisper-translate
   ▼
JP normalize (Ollama) — merge sentences, drop junk, repair known names
   ▼
JP→VI/EN (Cursor / OpenAI / Ollama) — sentence-level, then re-flow onto cues
   ▼
Player + captions.vi.srt / .vtt
```

## Domains

A **domain** is one streamer or topic. Pick it before **Caption it**. Use
**New** for another VTuber; **Edit** for name, notes, and saved spellings.

After a job finishes, names the app is sure about are stored automatically.
If it is unsure, a **Needs a spelling** card appears: choose a suggestion or
type one, then **Use**. Later jobs on that domain reuse those captions.

Keep one domain per streamer or topic. File layout: `domain/README.md`.

## Environment variables (`.env.local`)

| Var | Default | Notes |
| --- | --- | --- |
| `YTDLP_BIN` | `yt-dlp` | binary name/path |
| `YTDLP_EXTRA_ARGS` | _(empty)_ | e.g. `--cookies-from-browser "chrome:Profile 1"` |
| `PYTHON_BIN` | `python3` | |
| `ASR_BACKEND` | `qwen3` | `faster-whisper` for easier first run |
| `WHISPER_MODEL` | `large-v3-turbo` | used when `ASR_BACKEND=faster-whisper` |
| `WHISPER_DEVICE` | `auto` | `cpu` / `cuda` |
| `WHISPER_COMPUTE_TYPE` | `int8` | `float16` on GPU |
| `WHISPER_MAX_CUE_SECONDS` / `CHARS` | `8` / `42` | subtitle-sized JP cues |
| `QWEN_ASR_MODEL` | `Qwen/Qwen3-ASR-1.7B` | used when `ASR_BACKEND=qwen3` |
| `QWEN_ALIGNER_MODEL` | `Qwen/Qwen3-ForcedAligner-0.6B` | timestamps (≤~5 min / chunk) |
| `QWEN_ASR_DEVICE` | `auto` | `mps` / `cpu` / `cuda` |
| `QWEN_ASR_CHUNK_SECONDS` | `240` | chunk length for long VODs |
| `TARGET_LANG` | `vi` | default caption language (`vi` / `en`); per-job override in UI |
| `TRANSLATE_BACKEND` | `auto` | Cursor key → Composer; else OpenAI key → `gpt-5-nano`; else Ollama. Force: `cursor` / `openai` / `ollama` |
| `CURSOR_API_KEY` | _(optional)_ | [Integrations](https://cursor.com/dashboard/integrations) — Composer 2.5 |
| `CURSOR_TRANSLATE_MODEL` | `composer-2.5` | non-fast Composer |
| `OPENAI_API_KEY` | _(optional)_ | [API keys](https://platform.openai.com/api-keys) |
| `OPENAI_TRANSLATE_MODEL` | `gpt-5-nano` | cheapest OpenAI chat model |
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
- **TwitCasting download fails** — set `YTDLP_EXTRA_ARGS` cookies from a logged-in Chrome profile.
- **faster-whisper install fails** — Python ≥3.10; some systems need ffmpeg dev headers for `av`.
- **qwen3-asr import fails** — `npm run setup:qwen3`. First job downloads Hugging Face weights.
- **Translation step fails immediately** — missing key, or Ollama not running.
  Set `OPENAI_API_KEY` or `CURSOR_API_KEY`, or `TRANSLATE_BACKEND=ollama` plus
  `ollama serve` + `ollama pull $TRANSLATE_MODEL`.
- **Very slow on CPU** — try `ASR_BACKEND=faster-whisper` and `WHISPER_MODEL=medium`.
- **Phone can't reach the app** — `npm run dev:lan`, same Wi-Fi, allow port 3000.
- **No captions in the player** — the app draws its own overlay (CC toggle).

## Design notes

See `docs/twitcasting-vod-decision-summary.md`. Short version: transcribe
Japanese first (never Whisper `task=translate`), translate whole sentences,
then re-flow onto cue timings. Live / locked-cast overlays are out of scope.
