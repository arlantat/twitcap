import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { artifactPath, getJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".aac": "audio/aac",
  ".opus": "audio/ogg",
  ".ogg": "audio/ogg",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".wav": "audio/wav",
};

/**
 * File → Web ReadableStream with cancel/abort cleanup.
 * Avoids ERR_INVALID_STATE when the player seeks/cancels mid-range-request
 * (Node's Readable.toWeb keeps enqueueing after the controller closes).
 */
function fileRangeToWeb(
  filePath: string,
  start: number,
  end: number,
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const node = fs.createReadStream(filePath, { start, end });
  let closed = false;

  const closeNode = () => {
    if (!node.destroyed) node.destroy();
  };

  if (signal) {
    if (signal.aborted) closeNode();
    else signal.addEventListener("abort", closeNode, { once: true });
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      node.on("data", (chunk: string | Buffer) => {
        if (closed) return;
        try {
          const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          controller.enqueue(new Uint8Array(buf));
        } catch {
          closed = true;
          closeNode();
        }
      });
      node.on("end", () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by cancel */
        }
      });
      node.on("error", (err) => {
        if (closed) return;
        closed = true;
        try {
          controller.error(err);
        } catch {
          /* already closed */
        }
        closeNode();
      });
    },
    cancel() {
      closed = true;
      closeNode();
    },
  });
}

/** Streams the downloaded media with HTTP Range support (mobile scrubbing). */
export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const job = await getJob(params.id);
  if (!job?.artifacts?.audio) {
    return NextResponse.json({ error: "Media not ready" }, { status: 404 });
  }
  const filePath = artifactPath(params.id, job.artifacts.audio);
  if (!filePath) return NextResponse.json({ error: "Media missing" }, { status: 404 });

  const stat = await fsp.stat(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";

  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (Number.isNaN(start) || start >= stat.size) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}` },
      });
    }
    end = Math.min(end, stat.size - 1);
    return new Response(fileRangeToWeb(filePath, start, end, req.signal), {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  return new Response(fileRangeToWeb(filePath, 0, stat.size - 1, req.signal), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Content-Length": String(stat.size),
    },
  });
}
