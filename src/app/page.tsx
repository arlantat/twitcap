"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import JobForm from "@/components/JobForm";
import JobCard from "@/components/JobCard";
import DoctorPanel, { type DoctorReport } from "@/components/DoctorPanel";
import type { Job } from "@/lib/types";

const POLL_MS = 2500;

export default function Home() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [origin, setOrigin] = useState("");
  const [lanUrl, setLanUrl] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      if (res.ok) setJobs(await res.json());
    } catch {
      /* server restarting — keep last state */
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshDoctor = useCallback(async () => {
    try {
      const res = await fetch("/api/doctor", { cache: "no-store" });
      if (res.ok) setDoctor(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    void fetch("/api/lan", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { urls?: string[] } | null) => {
        const first = data?.urls?.[0];
        if (first) setLanUrl(first);
      })
      .catch(() => {});
    refresh();
    refreshDoctor();
  }, [refresh, refreshDoctor]);

  const hasActive = jobs.some((j) =>
    ["queued", "downloading", "transcribing", "translating"].includes(j.status)
  );

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (hasActive) timer.current = setInterval(refresh, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [hasActive, refresh]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-4 pb-10 pt-6 safe-bottom">
      <header className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="h-10 w-10 rounded-xl" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-tight">TwitCap</h1>
          <p className="text-xs text-zinc-400">
            VI/EN captions for Japanese streams — TwitCasting, YouTube &amp; more
          </p>
          {(lanUrl || origin) && (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(lanUrl || origin);
              }}
              className="mt-1 block max-w-full truncate text-left font-mono text-[11px] text-lime-300/90 underline-offset-2 hover:underline"
              title="Copy local link"
            >
              {lanUrl || origin}
            </button>
          )}
        </div>
      </header>

      <DoctorPanel report={doctor} onRecheck={refreshDoctor} />

      <section className="rounded-2xl border border-edge bg-panel p-4">
        <JobForm onCreated={refresh} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Jobs
          </h2>
          <button
            onClick={refresh}
            className="text-xs text-zinc-500 underline-offset-2 hover:underline"
          >
            Refresh
          </button>
        </div>

        {loading && <p className="text-sm text-zinc-500">Loading…</p>}

        {!loading && jobs.length === 0 && (
          <div className="rounded-2xl border border-dashed border-edge p-6 text-center text-sm text-zinc-500">
            No jobs yet. Paste a video URL above — e.g.
            <br />
            <code className="mt-1 inline-block rounded bg-ink px-2 py-0.5 text-xs text-lime-300">
              https://twitcasting.tv/&lt;user&gt;/movie/&lt;id&gt;
            </code>
            <br />
            <code className="mt-1 inline-block rounded bg-ink px-2 py-0.5 text-xs text-lime-300">
              https://www.youtube.com/watch?v=…
            </code>
          </div>
        )}

        {jobs.map((job) => (
          <JobCard key={job.id} job={job} onChanged={refresh} />
        ))}
      </section>

      <footer className="mt-2 text-center text-[11px] leading-relaxed text-zinc-600">
        Pipeline: yt-dlp → JP transcription → JP normalize → VI/EN translation
        with domain memory → SRT/VTT. Runs on your machine.
      </footer>
    </main>
  );
}
