"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cueAtTime } from "@/lib/captionTiming";

type Cue = { start: number; end: number; text: string };

const OFFSET_KEY = "twitcap.captionOffset";

function parseTime(t: string): number {
  // "MM:SS.mmm" or "HH:MM:SS.mmm"
  const parts = t.trim().split(":");
  let h = 0,
    m = 0,
    s = 0;
  if (parts.length === 3) {
    h = parseFloat(parts[0]);
    m = parseFloat(parts[1]);
    s = parseFloat(parts[2]);
  } else {
    m = parseFloat(parts[0]);
    s = parseFloat(parts[1]);
  }
  return h * 3600 + m * 60 + s;
}

export function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = vtt.replace(/\r/g, "").split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    const timeLineIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeLineIdx === -1) continue;
    const [startRaw, endRaw] = lines[timeLineIdx].split("-->");
    const start = parseTime(startRaw);
    const end = parseTime(endRaw.trim().split(" ")[0]);
    const text = lines.slice(timeLineIdx + 1).join("\n");
    if (text) cues.push({ start, end, text });
  }
  return cues;
}

/** True when the video (or its page) is in native fullscreen — including iOS. */
export function isVideoFullscreen(video: HTMLVideoElement | null): boolean {
  if (!video) return false;
  const fs = document.fullscreenElement;
  if (fs === video) return true;
  const webkit = video as HTMLVideoElement & {
    webkitDisplayingFullscreen?: boolean;
  };
  return !!webkit.webkitDisplayingFullscreen;
}

function loadOffset(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(OFFSET_KEY);
  const n = raw == null ? 0 : parseFloat(raw);
  if (!isFinite(n)) return 0;
  return Math.max(-2, Math.min(2, n));
}

/**
 * Inline: custom overlay (styled) with optional delay offset.
 * Fullscreen (incl. iOS): native WebVTT track — overlays are clipped away when
 * the browser fullscreens only the <video> element.
 */
export default function CaptionPlayer({
  jobId,
  lang = "en",
}: {
  jobId: string;
  /** Caption language code served by the captions API (vi/en). */
  lang?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [current, setCurrent] = useState<string>("");
  const [showCaptions, setShowCaptions] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [offsetSec, setOffsetSec] = useState(0);

  const vttSrc = `/api/jobs/${jobId}/captions/${lang}.vtt`;

  useEffect(() => {
    setOffsetSec(loadOffset());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(vttSrc, { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((text) => {
        if (!cancelled) setCues(parseVtt(text));
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [vttSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const syncFs = () => setFullscreen(isVideoFullscreen(video));
    syncFs();

    document.addEventListener("fullscreenchange", syncFs);
    // iOS Safari native video fullscreen
    video.addEventListener("webkitbeginfullscreen", syncFs);
    video.addEventListener("webkitendfullscreen", syncFs);
    return () => {
      document.removeEventListener("fullscreenchange", syncFs);
      video.removeEventListener("webkitbeginfullscreen", syncFs);
      video.removeEventListener("webkitendfullscreen", syncFs);
    };
  }, [jobId]);

  // Native track for fullscreen; hidden inline so it doesn't duplicate the overlay.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const apply = () => {
      const tracks = video.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        if (t.kind !== "captions" && t.kind !== "subtitles") continue;
        if (!showCaptions) {
          t.mode = "disabled";
        } else if (fullscreen) {
          t.mode = "showing";
        } else {
          t.mode = "hidden";
        }
      }
    };

    apply();
    video.addEventListener("loadedmetadata", apply);
    // Some browsers populate TextTracks asynchronously after <track> loads.
    const id = window.setInterval(apply, 500);
    const stop = window.setTimeout(() => window.clearInterval(id), 5000);
    return () => {
      video.removeEventListener("loadedmetadata", apply);
      window.clearInterval(id);
      window.clearTimeout(stop);
    };
  }, [showCaptions, fullscreen, jobId]);

  const sorted = useMemo(() => [...cues].sort((a, b) => a.start - b.start), [cues]);

  function onTimeUpdate() {
    const t = videoRef.current?.currentTime ?? 0;
    setCurrent(cueAtTime(sorted, t, offsetSec));
  }

  useEffect(() => {
    onTimeUpdate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when offset/cues change
  }, [offsetSec, sorted]);

  function onOffsetChange(v: number) {
    const clamped = Math.max(-2, Math.min(2, Math.round(v * 10) / 10));
    setOffsetSec(clamped);
    try {
      window.localStorage.setItem(OFFSET_KEY, String(clamped));
    } catch {
      /* ignore */
    }
  }

  const showOverlay = showCaptions && !fullscreen && !!current;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          onTimeUpdate={onTimeUpdate}
          onSeeked={onTimeUpdate}
          onPlay={onTimeUpdate}
          className="w-full"
          src={`/api/jobs/${jobId}/media`}
        >
          <track
            kind="captions"
            srcLang={lang}
            label={lang === "vi" ? "Tiếng Việt" : lang.toUpperCase()}
            src={vttSrc}
            default
          />
        </video>
        {showOverlay && (
          <div className="pointer-events-none absolute inset-x-0 bottom-10 flex justify-center px-3">
            <p className="caption-line max-w-full rounded bg-black/70 px-2 py-1 text-center text-sm font-medium leading-snug text-white">
              {current}
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">
          {loadError
            ? "Captions failed to load — use the download buttons below."
            : `${cues.length} caption cues`}
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            Delay
            <input
              type="range"
              min={-2}
              max={2}
              step={0.1}
              value={offsetSec}
              onChange={(e) => onOffsetChange(parseFloat(e.target.value))}
              className="w-28 accent-lime-400"
            />
            <span className="w-10 tabular-nums text-zinc-300">
              {offsetSec > 0 ? "+" : ""}
              {offsetSec.toFixed(1)}s
            </span>
          </label>
          <button
            onClick={() => setShowCaptions((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
              showCaptions
                ? "border-lime-400 bg-lime-400/10 text-lime-300"
                : "border-edge bg-ink text-zinc-400"
            }`}
          >
            CC {showCaptions ? "ON" : "OFF"}
          </button>
        </div>
      </div>
    </div>
  );
}
