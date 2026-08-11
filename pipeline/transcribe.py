#!/usr/bin/env python3
"""Japanese ASR for TwitCasting VOD audio.

Uses faster-whisper with language=ja and task=transcribe (product rule:
NEVER task=translate — translation is a separate, stronger MT step).

Builds short subtitle cues from word timestamps, then normalizes durations
so Whisper cannot emit multi-minute mega-cues.

Outputs:
  - segments JSON: [{id, start, end, text}, ...]
  - JP .srt

Progress is reported on stdout as lines: "PROGRESS <0..1>".
"""

from __future__ import annotations

import argparse
import json
import sys

from cue_split import normalize_cues, words_to_cues


def srt_timestamp(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main() -> int:
    p = argparse.ArgumentParser(description="JP transcription via faster-whisper")
    p.add_argument("audio", help="Path to audio file")
    p.add_argument("--model", default="large-v3-turbo")
    p.add_argument("--language", default="ja")
    p.add_argument("--device", default="auto")
    p.add_argument("--compute-type", default="int8")
    p.add_argument("--max-cue-seconds", type=float, default=8.0)
    p.add_argument("--max-cue-chars", type=int, default=42)
    p.add_argument("--out-json", required=True)
    p.add_argument("--out-srt", required=True)
    args = p.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(
            "ERROR: faster-whisper is not installed.\n"
            "Run: python3 -m pip install -r pipeline/requirements.txt",
            file=sys.stderr,
        )
        return 2

    print(
        f"[transcribe] loading model {args.model} ({args.device}/{args.compute_type})",
        file=sys.stderr,
    )
    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)

    print(
        f"[transcribe] transcribing {args.audio} (language={args.language}, task=transcribe)",
        file=sys.stderr,
    )
    segments_iter, info = model.transcribe(
        args.audio,
        language=args.language,
        task="transcribe",  # product rule: JP first, translate separately
        beam_size=5,
        vad_filter=True,
        word_timestamps=True,
        condition_on_previous_text=False,  # reduces hallucination loops on streams
        no_speech_threshold=0.6,
        compression_ratio_threshold=2.4,
    )

    duration = max(getattr(info, "duration", 0.0) or 0.0, 0.001)
    words: list[dict] = []
    raw_fallback: list[dict] = []

    for seg in segments_iter:
        text = (seg.text or "").strip()
        if text:
            raw_fallback.append(
                {
                    "id": len(raw_fallback),
                    "start": float(seg.start),
                    "end": float(seg.end),
                    "text": text,
                }
            )
        seg_words = getattr(seg, "words", None) or []
        for w in seg_words:
            wtext = (getattr(w, "word", None) or getattr(w, "text", None) or "").strip()
            if not wtext:
                continue
            # Prefer keeping Japanese without forcing Latin spaces.
            words.append(
                {
                    "text": wtext if wtext.startswith((" ", "　")) else wtext,
                    "start": float(w.start),
                    "end": float(w.end),
                }
            )
        print(f"PROGRESS {min(float(seg.end) / duration, 0.95):.4f}", flush=True)

    if words:
        segments = words_to_cues(
            words,
            max_duration=args.max_cue_seconds,
            max_chars=args.max_cue_chars,
        )
        print(
            f"[transcribe] built {len(segments)} cues from {len(words)} words",
            file=sys.stderr,
        )
    else:
        segments = normalize_cues(
            raw_fallback,
            max_duration=args.max_cue_seconds,
            max_chars=args.max_cue_chars,
        )
        print(
            f"[transcribe] no word timestamps; normalized {len(raw_fallback)} segments -> {len(segments)}",
            file=sys.stderr,
        )

    with open(args.out_json, "w", encoding="utf-8") as f:
        json.dump(
            {
                "language": args.language,
                "duration": duration,
                "model": args.model,
                "backend": "faster-whisper",
                "segments": segments,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    with open(args.out_srt, "w", encoding="utf-8") as f:
        for i, s in enumerate(segments, 1):
            f.write(
                f"{i}\n{srt_timestamp(s['start'])} --> {srt_timestamp(s['end'])}\n{s['text']}\n\n"
            )

    print(f"[transcribe] {len(segments)} segments -> {args.out_json}, {args.out_srt}", file=sys.stderr)
    print("PROGRESS 1.0", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
