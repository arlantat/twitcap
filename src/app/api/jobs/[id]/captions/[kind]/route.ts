import fsp from "fs/promises";
import { NextResponse } from "next/server";
import { artifactPath, getJob } from "@/lib/jobs";
import type { Job } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KIND_RE = /^([a-z]{2})\.(srt|vtt)$/;

function resolveArtifact(job: Job, lang: string, ext: "srt" | "vtt"): string | undefined {
  const a = job.artifacts || {};
  if (lang === "jp") {
    return ext === "srt" ? a.jpSrt : undefined;
  }
  const jobLang = job.targetLang || "en";
  if (lang === jobLang) {
    const modern = ext === "srt" ? a.subSrt : a.subVtt;
    if (modern) return modern;
  }
  if (lang === "en") {
    // Legacy EN-only jobs.
    return ext === "srt" ? a.enSrt : a.enVtt;
  }
  return undefined;
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string; kind: string } }
) {
  const m = KIND_RE.exec(params.kind || "");
  if (!m) {
    return NextResponse.json({ error: "Unknown caption kind" }, { status: 404 });
  }
  const [, lang, ext] = m as unknown as [string, string, "srt" | "vtt"];

  const job = await getJob(params.id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  const filename = resolveArtifact(job, lang, ext);
  if (!filename) {
    return NextResponse.json({ error: "Captions not ready" }, { status: 404 });
  }
  const filePath = artifactPath(params.id, filename);
  if (!filePath) {
    return NextResponse.json({ error: "Captions missing" }, { status: 404 });
  }
  const text = await fsp.readFile(filePath, "utf8");
  return new Response(text, {
    headers: {
      "Content-Type":
        ext === "vtt"
          ? "text/vtt; charset=utf-8"
          : "application/x-subrip; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
