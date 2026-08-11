"use client";

import { useEffect, useState } from "react";

type PackInfo = {
  slug: string;
  title: string;
  termCount: number;
  pendingCount: number;
};

export default function JobForm({ onCreated }: { onCreated: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetLang, setTargetLang] = useState("vi");
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [domainPack, setDomainPack] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/domains", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (data: {
          packs?: PackInfo[];
          defaultPack?: string;
          defaultLang?: string;
        } | null) => {
          if (cancelled || !data) return;
          setPacks(data.packs || []);
          if (data.defaultLang) setTargetLang(data.defaultLang);
          const fallback = data.packs?.[0]?.slug || "";
          setDomainPack(
            data.packs?.some((p) => p.slug === data.defaultPack)
              ? data.defaultPack!
              : fallback
          );
        }
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = url.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed, targetLang, domainPack }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to start job");
      } else {
        setUrl("");
        onCreated();
      }
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label htmlFor="vod-url" className="text-sm font-medium text-zinc-300">
        Video URL
      </label>
      <input
        id="vod-url"
        type="url"
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="TwitCasting, YouTube, or any yt-dlp link…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="w-full rounded-xl border border-edge bg-ink px-3 py-3 text-zinc-100 placeholder-zinc-600 outline-none focus:border-lime-400"
      />
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Caption language
          <select
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            className="rounded-xl border border-edge bg-ink px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-lime-400"
          >
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Domain memory
          <select
            value={domainPack}
            onChange={(e) => setDomainPack(e.target.value)}
            className="rounded-xl border border-edge bg-ink px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-lime-400"
          >
            {packs.length === 0 && <option value="">(none)</option>}
            {packs.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || !url.trim()}
        className="w-full rounded-xl bg-lime-400 py-3 font-semibold text-black transition active:scale-[0.98] disabled:opacity-40"
      >
        {busy ? "Starting…" : "Caption it"}
      </button>
      <p className="text-xs text-zinc-500">
        Downloads audio, transcribes the Japanese speech, then translates to
        timed captions. Long videos can take a while on CPU.
      </p>
    </form>
  );
}
