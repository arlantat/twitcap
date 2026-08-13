"use client";

import CaptionPlayer from "./CaptionPlayer";
import { detectPlatform } from "@/lib/urls";
import { isActiveJobStatus, type Job } from "@/lib/types";

const STATUS_LABEL: Record<Job["status"], string> = {
  queued: "Queued",
  downloading: "Downloading audio",
  transcribing: "Transcribing Japanese",
  normalizing: "Normalizing Japanese",
  translating: "Translating",
  polishing: "Polishing",
  done: "Ready",
  error: "Failed",
};

const STATUS_STYLE: Record<Job["status"], string> = {
  queued: "bg-zinc-700 text-zinc-200",
  downloading: "bg-sky-900 text-sky-200",
  transcribing: "bg-violet-900 text-violet-200",
  normalizing: "bg-indigo-900 text-indigo-200",
  translating: "bg-amber-900 text-amber-200",
  polishing: "bg-fuchsia-900 text-fuchsia-200",
  done: "bg-lime-900 text-lime-300",
  error: "bg-red-950 text-red-300",
};

function fmtDuration(sec?: number) {
  if (!sec || !isFinite(sec)) return null;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

export default function JobCard({
  job,
  onChanged,
}: {
  job: Job;
  onChanged: () => void;
}) {
  const active = isActiveJobStatus(job.status);
  const pct = Math.round((job.progress || 0) * 100);
  const dur = fmtDuration(job.duration);
  const platform = detectPlatform(job.url);
  const captionLang = job.targetLang || (job.artifacts?.enVtt ? "en" : "vi");
  const langLabel = captionLang === "vi" ? "VI" : captionLang.toUpperCase();

  async function remove() {
    if (!confirm("Delete this job and its files?")) return;
    await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-edge bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold leading-snug">
            {job.title || job.url}
          </h3>
          <p className="mt-0.5 break-all text-xs text-zinc-500">
            <span className="mr-1 inline-block rounded bg-ink px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300">
              {platform}
            </span>
            {job.url}
            {dur ? ` · ${dur}` : ""}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[job.status]}`}
        >
          {job.status === "translating"
            ? `Translating → ${
                (job.targetLang || "vi") === "vi"
                  ? "VI"
                  : (job.targetLang || "en").toUpperCase()
              }`
            : STATUS_LABEL[job.status]}
        </span>
      </div>

      {active && (
        <div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-ink">
            <div
              className="h-full rounded-full bg-lime-400 transition-[width] duration-500"
              style={{ width: `${Math.max(pct, 2)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            {job.step} · {pct}%
          </p>
        </div>
      )}

      {job.status === "error" && (
        <div className="rounded-xl border border-red-900 bg-red-950/40 p-3">
          <p className="text-sm text-red-300">{job.error || "Unknown error"}</p>
          {job.logTail && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-zinc-400">
                Show log tail
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-ink p-2 text-[11px] text-zinc-500">
                {job.logTail}
              </pre>
            </details>
          )}
        </div>
      )}

      {job.status === "done" && (
        <>
          <CaptionPlayer jobId={job.id} lang={captionLang} />
          <div className="grid grid-cols-3 gap-2">
            <a
              href={`/api/jobs/${job.id}/captions/${captionLang}.srt`}
              download
              className="rounded-lg border border-edge bg-ink py-2 text-center text-xs font-medium text-zinc-200 active:bg-zinc-800"
            >
              {langLabel} .srt
            </a>
            <a
              href={`/api/jobs/${job.id}/captions/${captionLang}.vtt`}
              download
              className="rounded-lg border border-edge bg-ink py-2 text-center text-xs font-medium text-zinc-200 active:bg-zinc-800"
            >
              {langLabel} .vtt
            </a>
            <a
              href={`/api/jobs/${job.id}/captions/jp.srt`}
              download
              className="rounded-lg border border-edge bg-ink py-2 text-center text-xs font-medium text-zinc-200 active:bg-zinc-800"
            >
              JP .srt
            </a>
          </div>
        </>
      )}

      <div className="flex justify-end">
        <button
          onClick={remove}
          className="text-xs text-zinc-500 underline-offset-2 hover:text-red-400 hover:underline"
        >
          Delete
        </button>
      </div>
    </article>
  );
}
