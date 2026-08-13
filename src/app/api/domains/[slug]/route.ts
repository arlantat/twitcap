import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import {
  composeProfile,
  readPackDetail,
  resolvePackDir,
  updatePackProfile,
} from "@/lib/domainPacks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { slug: string } }
) {
  const pack = readPackDetail(config.domainDir, params.slug);
  if (!pack) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }
  return NextResponse.json(pack);
}

export async function PATCH(
  request: Request,
  { params }: { params: { slug: string } }
) {
  const dir = resolvePackDir(config.domainDir, params.slug);
  if (!dir) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }
  let body: { title?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const current = readPackDetail(config.domainDir, params.slug);
  if (!current) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }
  const title = (body.title ?? current.title).trim();
  if (!title) {
    return NextResponse.json({ error: "A name is required" }, { status: 400 });
  }
  const notes = body.notes ?? current.notes;
  updatePackProfile(dir, composeProfile(title, notes));
  return NextResponse.json(readPackDetail(config.domainDir, params.slug));
}
