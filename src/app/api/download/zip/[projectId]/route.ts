import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import { prisma } from "@/lib/db";
import { HttpError, handle } from "@/lib/http";
import { downloadSecret } from "@/lib/downloads";
import { verifySigned } from "@/lib/signing";
import { renderPath } from "@/lib/storage";
import { createZipStream, slugify, type ZipEntry } from "@/lib/zip";

export const runtime = "nodejs";

type Params = { params: Promise<{ projectId: string }> };

/** Signed, expiring ZIP of the latest finished render of every clip. */
export const GET = handle(async (req: Request, { params }: Params) => {
  const { projectId } = await params;
  const url = new URL(req.url);
  if (!verifySigned(url.pathname, url.searchParams.get("exp"), url.searchParams.get("sig"), downloadSecret())) {
    throw new HttpError(403, "This download link is invalid or has expired.");
  }

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  if (!project) throw new HttpError(404, "Project not found.");

  const rows = await prisma.render.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: { clip: true },
  });
  const now = new Date();
  const seen = new Set<string>();
  const latest = rows.filter((r) => (seen.has(r.clipId) ? false : (seen.add(r.clipId), true)));

  const entries: ZipEntry[] = [];
  const usable = latest
    .filter((r) => r.status === "DONE" && (!r.expiresAt || r.expiresAt >= now))
    .sort((a, b) => a.clip.startSec - b.clip.startSec);
  for (const [i, r] of usable.entries()) {
    const file = renderPath(projectId, r.id);
    if (await fsp.stat(file).catch(() => null)) {
      entries.push({ name: `${String(i + 1).padStart(2, "0")}-${slugify(r.clip.title)}-${r.aspect.replace(":", "x")}.mp4`, path: file });
    }
  }
  if (entries.length === 0) throw new HttpError(404, "There are no finished clips to download.");

  return new Response(Readable.toWeb(createZipStream(entries)) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slugify(project.name, "clipnova")}-clips.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
});
