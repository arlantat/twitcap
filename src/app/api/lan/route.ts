import os from "os";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function lanIpv4s(): string[] {
  const out: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const infos of Object.values(ifaces)) {
    if (!infos) continue;
    for (const info of infos) {
      if (info.family !== "IPv4" || info.internal) continue;
      out.push(info.address);
    }
  }
  return out;
}

export async function GET(req: Request) {
  const host = req.headers.get("host") || "";
  const port =
    host.includes(":") && !host.startsWith("[")
      ? host.split(":").pop()!
      : process.env.PORT || "3000";
  const urls = lanIpv4s().map((ip) => `http://${ip}:${port}`);
  return NextResponse.json({ urls, port });
}
