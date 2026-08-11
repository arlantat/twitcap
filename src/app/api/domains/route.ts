import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { listDomainPacks } from "@/lib/domainPacks";

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
