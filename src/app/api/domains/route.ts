import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { createDomainPackFromTitle, listDomainPacks } from "@/lib/domainPacks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const packs = listDomainPacks(config.domainDir);
  return NextResponse.json({
    packs,
    defaultPack: config.domainPack,
    defaultLang: config.targetLang,
    enabled: config.domainEnabled,
  });
}

export async function POST(request: Request) {
  let body: { title?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const title = (body.title || "").trim();
  if (!title) {
    return NextResponse.json({ error: "A name is required" }, { status: 400 });
  }
  try {
    const pack = createDomainPackFromTitle(
      config.domainDir,
      title,
      body.notes || ""
    );
    return NextResponse.json(pack, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create domain" },
      { status: 400 }
    );
  }
}
