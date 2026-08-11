#!/usr/bin/env python3
"""Japanese ASR via Qwen3-ASR 1.7B + ForcedAligner (timed JP segments).

faster-whisper remains available separately in transcribe.py.
ForcedAligner supports up to ~5 minutes, so long VODs are chunked.

Outputs the same segments JSON + JP SRT shape as transcribe.py.
Progress: stdout lines "PROGRESS <0..1>".
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from qwen3_segments import merge_time_stamps


def srt_timestamp(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def ffprobe_duration(path: str) -> float:
    out = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        text=True,
    ).strip()
    return max(float(out), 0.001)


def extract_chunk(src: str, dest: str, start: float, duration: float) -> None:
    # Seek AFTER -i for frame-accurate cuts. Pre-input -ss is faster but can
    # drift several seconds on muxed TwitCast MP4s and desync caption timestamps.
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-i",
            src,
            "-ss",
            f"{start:.3f}",
            "-t",
            f"{duration:.3f}",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-vn",
            dest,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def pick_torch_device(requested: str) -> str:
    import torch

    req = (requested or "auto").lower()
    if req == "auto":
        if torch.cuda.is_available():
            return "cuda:0"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
        return "cpu"
    if req in ("cuda", "gpu"):
        return "cuda:0"
    return req


def pick_dtype(name: str, device: str):
    import torch

    n = (name or "auto").lower()
    if n == "auto":
        if device.startswith("cuda"):
            return torch.bfloat16
        if device == "mps":
            return torch.float16
        return torch.float32
    mapping = {
        "float16": torch.float16,
        "fp16": torch.float16,
        "bfloat16": torch.bfloat16,
        "bf16": torch.bfloat16,
        "float32": torch.float32,
        "fp32": torch.float32,
    }
    if n not in mapping:
        raise SystemExit(f"Unknown dtype: {name}")
    return mapping[n]


def main() -> int:
    p = argparse.ArgumentParser(description="JP transcription via Qwen3-ASR + ForcedAligner")
    p.add_argument("audio", help="Path to audio/video file")
    p.add_argument("--model", default="Qwen/Qwen3-ASR-1.7B")
    p.add_argument("--aligner", default="Qwen/Qwen3-ForcedAligner-0.6B")
    p.add_argument("--device", default="auto", help="auto | mps | cpu | cuda")
    p.add_argument("--dtype", default="auto")
    p.add_argument("--chunk-seconds", type=float, default=240.0)
    p.add_argument("--language", default="Japanese")
    p.add_argument(
        "--context",
        default="",
        help="Domain names/terms to bias recognition (Qwen3-ASR context string)",
    )
    p.add_argument("--max-new-tokens", type=int, default=1536)
    p.add_argument("--out-json", required=True)
    p.add_argument("--out-srt", required=True)
    args = p.parse_args()

    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        print("ERROR: ffmpeg/ffprobe required for Qwen3 chunking", file=sys.stderr)
        return 2

    try:
        import torch
        from qwen_asr import Qwen3ASRModel
    except ImportError:
        print(
            "ERROR: qwen-asr (and torch) not installed.\n"
            "Run: python3 -m pip install -r pipeline/requirements-qwen3.txt",
            file=sys.stderr,
        )
        return 2

    device = pick_torch_device(args.device)
    dtype = pick_dtype(args.dtype, device)
    print(
        f"[transcribe_qwen3] loading {args.model} + {args.aligner} on {device}/{dtype}",
        file=sys.stderr,
    )

    # device_map: transformers-style. For mps/cpu use the device string.
    model = Qwen3ASRModel.from_pretrained(
        args.model,
        dtype=dtype,
        device_map=device,
        forced_aligner=args.aligner,
        forced_aligner_kwargs=dict(
            dtype=dtype,
            device_map=device,
        ),
        max_inference_batch_size=1,
        max_new_tokens=args.max_new_tokens,
    )

    duration = ffprobe_duration(args.audio)
    chunk_len = max(30.0, min(float(args.chunk_seconds), 290.0))  # aligner limit ~5 min
    all_stamps: list[dict] = []

    with tempfile.TemporaryDirectory(prefix="qwen3asr_") as tmp:
        tmp_path = Path(tmp)
        starts = []
        t = 0.0
        while t < duration:
            starts.append(t)
            t += chunk_len

        for i, start in enumerate(starts):
            this_dur = min(chunk_len, duration - start)
            if this_dur < 0.05:
                continue
            chunk_wav = str(tmp_path / f"chunk_{i:04d}.wav")
            print(
                f"[transcribe_qwen3] chunk {i + 1}/{len(starts)} "
                f"@ {start:.1f}s ({this_dur:.1f}s)",
                file=sys.stderr,
            )
            extract_chunk(args.audio, chunk_wav, start, this_dur)

            results = model.transcribe(
                audio=chunk_wav,
                context=args.context or None,
                language=args.language,
                return_time_stamps=True,
            )
            r0 = results[0]
            stamps = r0.time_stamps or []
            for ts in stamps:
                text = getattr(ts, "text", "") or ""
                all_stamps.append(
                    {
                        "text": text,
                        "start": float(ts.start_time) + start,
                        "end": float(ts.end_time) + start,
                    }
                )

            # Progress across chunks (leave headroom for merge/write).
            print(f"PROGRESS {min((i + 1) / max(len(starts), 1), 0.99):.4f}", flush=True)

    segments = merge_time_stamps(all_stamps)
    from cue_split import normalize_cues

    segments = normalize_cues(segments, max_duration=8.0, max_chars=42)
    with open(args.out_json, "w", encoding="utf-8") as f:
        json.dump(
            {
                "language": "ja",
                "duration": duration,
                "model": args.model,
                "aligner": args.aligner,
                "backend": "qwen3",
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

    print(
        f"[transcribe_qwen3] {len(segments)} cues from {len(all_stamps)} tokens "
        f"-> {args.out_json}, {args.out_srt}",
        file=sys.stderr,
    )
    print("PROGRESS 1.0", flush=True)
    return 0


if __name__ == "__main__":
    # Avoid accidental HF telemetry surprises in offline tools.
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    sys.exit(main())
