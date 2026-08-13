import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { applyPackPendingChoice, readPackDetail } from "@/lib/domainPacks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: { slug: string } }
) {
  let body: { id?: string; rendering?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = (body.id || "").trim();
  const rendering = (body.rendering || "").trim();
  if (!id || !rendering) {
    return NextResponse.json(
      { error: "Term id and spelling are required" },
      { status: 400 }
    );
  }
  const result = applyPackPendingChoice(
    config.domainDir,
    params.slug,
    id,
    rendering
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(readPackDetail(config.domainDir, params.slug));
}
