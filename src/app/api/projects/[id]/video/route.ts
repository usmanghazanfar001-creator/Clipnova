import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import { HttpError, handle } from "@/lib/http";
import { getScopedProject, requireCtx } from "@/lib/rbac";
import { MIME_BY_EXT, sourcePath } from "@/lib/storage";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Auth-checked video stream with Range support so the editor can seek. */
export const GET = handle(async (req: Request, { params }: Params) => {
  const ctx = await requireCtx();
  const { id } = await params;
  const project = await getScopedProject(ctx, id);
  if (!project.sourceExt) throw new HttpError(404, "No video uploaded yet.");

  const file = sourcePath(id, project.sourceExt);
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat) throw new HttpError(404, "Video file not found.");

  const headers: Record<string, string> = {
    "Content-Type": MIME_BY_EXT[project.sourceExt] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0, must-revalidate",
    "X-Content-Type-Options": "nosniff",
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range) {
    let start = range[1] ? parseInt(range[1], 10) : NaN;
    let end = range[2] ? parseInt(range[2], 10) : NaN;
    if (Number.isNaN(start)) {
      // suffix range: last N bytes
      start = Math.max(0, stat.size - (Number.isNaN(end) ? 0 : end));
      end = stat.size - 1;
    } else if (Number.isNaN(end) || end >= stat.size) {
      end = stat.size - 1;
    }
    if (start > end || start >= stat.size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    }
    const stream = fs.createReadStream(file, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": String(end - start + 1) },
    });
  }

  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
    headers: { ...headers, "Content-Length": String(stat.size) },
  });
});
