import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import { prisma } from "@/lib/db";
import { HttpError, handle } from "@/lib/http";
import { downloadSecret } from "@/lib/downloads";
import { verifySigned } from "@/lib/signing";
import { renderPath } from "@/lib/storage";
import { slugify } from "@/lib/zip";

export const runtime = "nodejs";

type Params = { params: Promise<{ renderId: string }> };

/**
 * Signed, expiring download. The signature is the credential (like an S3 presigned URL),
 * so this works from a plain <a href> and is bound to this exact render id.
 */
export const GET = handle(async (req: Request, { params }: Params) => {
  const { renderId } = await params;
  const url = new URL(req.url);
  if (!verifySigned(url.pathname, url.searchParams.get("exp"), url.searchParams.get("sig"), downloadSecret())) {
    throw new HttpError(403, "This download link is invalid or has expired.");
  }

  const render = await prisma.render.findUnique({ where: { id: renderId }, include: { clip: true } });
  if (!render || render.status !== "DONE" || (render.expiresAt && render.expiresAt < new Date())) {
    throw new HttpError(404, "This render is no longer available.");
  }
  const file = renderPath(render.projectId, render.id);
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat) throw new HttpError(404, "This render is no longer available.");

  const name = `${slugify(render.clip.title)}-${render.aspect.replace(":", "x")}.mp4`;
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
