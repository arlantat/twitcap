"use client";

import { useEffect, useState } from "react";

export type PackInfo = {
  slug: string;
  title: string;
  termCount: number;
  pendingCount: number;
};

type PendingItem = {
  id: string;
  jp: string;
  lang: string;
  candidates: string[];
};

type SavedName = {
  jp: string;
  captions: Record<string, string>;
};

type PackDetail = PackInfo & {
  notes: string;
  pending: PendingItem[];
  names: SavedName[];
};

const fieldClass =
  "w-full rounded-xl border border-edge bg-ink px-3 py-2.5 text-zinc-100 placeholder-zinc-600 outline-none focus:border-lime-400";

const LANG_LABEL: Record<string, string> = {
  vi: "Vietnamese",
  en: "English",
};

function captionLine(name: SavedName): string {
  const parts = Object.entries(name.captions)
    .filter(([, v]) => v.trim())
    .map(([lang, v]) => `${LANG_LABEL[lang] || lang}: ${v}`);
  return parts.length ? `${name.jp} → ${parts.join(" · ")}` : name.jp;
}

export default function DomainPackPicker({
  packs,
  value,
  onChange,
  onPacksChange,
}: {
  packs: PackInfo[];
  value: string;
  onChange: (slug: string) => void;
  onPacksChange: (packs: PackInfo[]) => void;
}) {
  const [mode, setMode] = useState<null | "new" | "edit">(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [names, setNames] = useState<SavedName[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyDetail(data: PackDetail) {
    setTitle(data.title);
    setNotes(data.notes || "");
    setPending(data.pending || []);
    setNames(data.names || []);
    const next: Record<string, string> = {};
    for (const p of data.pending || []) {
      next[p.id] = p.candidates[0] || "";
    }
    setChoices(next);
  }

  useEffect(() => {
    if (!value) {
      setPending([]);
      setNames([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/domains/${encodeURIComponent(value)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PackDetail | null) => {
        if (cancelled || !data) return;
        applyDetail(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [value, packs]);

  async function refreshList(selectSlug?: string) {
    const res = await fetch("/api/domains", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { packs?: PackInfo[] };
    const next = data.packs || [];
    onPacksChange(next);
    if (selectSlug) onChange(selectSlug);
  }

  async function createPack() {
    setError(null);
    const name = title.trim();
    if (!name) {
      setError("A name is required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name, notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not create domain");
        return;
      }
      await refreshList(data.slug);
      setMode(null);
      setTitle("");
      setNotes("");
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function savePack() {
    if (!value) return;
    setError(null);
    const name = title.trim();
    if (!name) {
      setError("A name is required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/domains/${encodeURIComponent(value)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name, notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not save domain");
        return;
      }
      applyDetail(data as PackDetail);
      await refreshList(value);
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function keepSpelling(id: string) {
    if (!value) return;
    const rendering = (choices[id] || "").trim();
    if (!rendering) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/domains/${encodeURIComponent(value)}/pending`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, rendering }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as PackDetail & {
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || "Could not save spelling");
        return;
      }
      applyDetail(data);
      await refreshList(value);
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  const showSpelling = mode !== "new" && pending.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-zinc-400">
          Domain
          <select
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setMode(null);
            }}
            className={fieldClass}
          >
            {packs.length === 0 && <option value="">None</option>}
            {packs.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setTitle("");
            setNotes("");
            setPending([]);
            setNames([]);
            setMode("new");
          }}
          className="shrink-0 rounded-xl border border-edge px-3 py-2.5 text-sm text-zinc-200 active:bg-zinc-800"
        >
          New
        </button>
        <button
          type="button"
          disabled={!value}
          onClick={() => {
            setError(null);
            setMode("edit");
          }}
          className="shrink-0 rounded-xl border border-edge px-3 py-2.5 text-sm text-zinc-200 enabled:active:bg-zinc-800 disabled:opacity-40"
        >
          Edit
        </button>
      </div>

      {showSpelling && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-800/60 bg-amber-950/30 p-3">
          <p className="text-xs font-medium text-amber-200">Needs a spelling</p>
          {pending.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-1.5 rounded-lg border border-edge bg-ink/50 p-2"
            >
              <p className="text-sm text-zinc-200">
                {item.jp}{" "}
                <span className="text-xs text-zinc-500">
                  {LANG_LABEL[item.lang] || item.lang}
                </span>
              </p>
              <div className="flex flex-wrap gap-1">
                {item.candidates.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() =>
                      setChoices((prev) => ({ ...prev, [item.id]: c }))
                    }
                    className={`rounded-lg px-2 py-1 text-xs ${
                      choices[item.id] === c
                        ? "bg-lime-400 text-black"
                        : "border border-edge text-zinc-300"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={choices[item.id] || ""}
                  onChange={(e) =>
                    setChoices((prev) => ({
                      ...prev,
                      [item.id]: e.target.value,
                    }))
                  }
                  placeholder="Caption spelling"
                  className={fieldClass}
                />
                <button
                  type="button"
                  disabled={busy || !(choices[item.id] || "").trim()}
                  onClick={() => keepSpelling(item.id)}
                  className="shrink-0 rounded-xl bg-lime-400 px-3 py-2 text-sm font-semibold text-black disabled:opacity-40"
                >
                  Use
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showSpelling && error && !mode && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      {mode && (
        <div className="flex flex-col gap-2 rounded-xl border border-edge bg-ink/60 p-3">
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Name
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Usada Pekora"
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Who speaks, names, and tone"
              rows={5}
              className={`${fieldClass} resize-y`}
            />
          </label>

          {mode === "edit" && names.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-zinc-300">Saved names</p>
              <ul className="max-h-40 overflow-auto rounded-lg border border-edge p-2 text-xs text-zinc-400">
                {names.map((n) => (
                  <li key={n.jp} className="py-0.5">
                    {captionLine(n)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode(null)}
              className="rounded-xl px-3 py-2 text-sm text-zinc-400"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !title.trim()}
              onClick={mode === "new" ? createPack : savePack}
              className="rounded-xl bg-lime-400 px-3 py-2 text-sm font-semibold text-black disabled:opacity-40"
            >
              {busy ? "Saving…" : mode === "new" ? "Create" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
