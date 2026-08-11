"use client";

export type DoctorCheck = {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
};

export type DoctorReport = {
  ok: boolean;
  checks: DoctorCheck[];
};

export default function DoctorPanel({
  report,
  onRecheck,
}: {
  report: DoctorReport | null;
  onRecheck: () => void;
}) {
  if (!report) return null;
  if (report.ok) return null; // everything fine: stay out of the way

  return (
    <section className="rounded-2xl border border-amber-800/60 bg-amber-950/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-amber-300">
          Pipeline setup incomplete
        </h2>
        <button
          onClick={onRecheck}
          className="text-xs text-amber-200 underline-offset-2 hover:underline"
        >
          Re-check
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {report.checks.map((c) => (
          <li key={c.name} className="text-sm">
            <span className={c.ok ? "text-lime-400" : "text-red-400"}>
              {c.ok ? "✓" : "✗"}
            </span>{" "}
            <span className="font-medium text-zinc-200">{c.name}</span>{" "}
            <span className="text-zinc-400">— {c.detail}</span>
            {!c.ok && c.fix && (
              <div className="mt-0.5 rounded bg-ink px-2 py-1 font-mono text-xs text-amber-200">
                {c.fix}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
