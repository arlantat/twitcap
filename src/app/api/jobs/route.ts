import { NextResponse } from "next/server";
import { createJob, listJobs } from "@/lib/jobs";
import { validateJobUrl } from "@/lib/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jobs = await listJobs();
  return NextResponse.json(jobs);
}

export async function POST(request: Request) {
  let body: { url?: string; targetLang?: string; domainPack?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = (body.url || "").trim();
  const check = validateJobUrl(url);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const job = await createJob(url, {
    targetLang: body.targetLang,
    domainPack: body.domainPack,
  });
  return NextResponse.json(job, { status: 201 });
}
