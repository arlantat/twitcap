import { NextResponse } from "next/server";
import { getJob, removeJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const job = await getJob(params.id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json(job);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const ok = await removeJob(params.id);
  if (!ok) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
