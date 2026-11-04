import { z } from "zod";
import { prisma } from "@/lib/db";
import { HttpError, handle, readJson } from "@/lib/http";
import { CAN_EDIT, getScopedProject, requireCtx, requireRole } from "@/lib/rbac";
import { checkClipTimes } from "@/lib/clips/validate";
import { resolveStyle, type RenderSpec } from "@/lib/render/spec";
import { enqueueRender } from "@/lib/queue";
import { renderDownloadPath, signDownload, zipDownloadPath } from "@/lib/downloads";

type Params = { params: Promise<{ id: string }> };

/** Latest render per clip, with short-lived signed download links for finished files. */
export const GET = handle(async (_req: Request, { params }: Params) => {
  const ctx = await requireCtx();
  const { id } = await params;
  await getScopedProject(ctx, id);

  const rows = await prisma.render.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" } });
  const now = new Date();
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.clipId)) latest.set(r.clipId, r);

  const renders = [...latest.values()].map((r) => {
    const expired = r.status === "DONE" && (r.sizeBytes === null || (r.expiresAt !== null && r.expiresAt < now));
    return {
      id: r.id,
      clipId: r.clipId,
      status: expired ? "EXPIRED" : r.status,
      error: r.error,
      aspect: r.aspect,
      sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes),
      downloadUrl: r.status === "DONE" && !expired ? signDownload(renderDownloadPath(r.id)) : null,
    };
  });
  const downloadable = renders.filter((r) => r.downloadUrl).length;
  return Response.json({
    renders,
    zipUrl: downloadable > 0 ? signDownload(zipDownloadPath(id)) : null,
  });
});

const schema = z.object({ clipIds: z.array(z.string().min(1).max(40)).min(1).max(8).optional() });

/** Queue renders for the given clips (default: all selected clips). */
export const POST = handle(async (req: Request, { params }: Params) => {
  const ctx = await requireCtx();
  requireRole(ctx, ...CAN_EDIT);
  const { id } = await params;
  const project = await getScopedProject(ctx, id);
  const { clipIds } = schema.parse(await readJson(req));

  if (!["READY_FOR_REVIEW", "COMPLETED", "RENDERING"].includes(project.status) || !project.sourceExt) {
    throw new HttpError(409, "This project isn't ready to render yet.");
  }
  if (project.durationSec === null) throw new HttpError(409, "Video details aren't ready yet.");

  const clips = await prisma.clip.findMany({
    where: { projectId: id, ...(clipIds ? { id: { in: clipIds } } : { selected: true }) },
    orderBy: { startSec: "asc" },
  });
  if (clips.length === 0) throw new HttpError(400, "Select at least one clip to render.");

  // Re-validate against the clip's current times; never render something the editor would reject.
  for (const c of clips) {
    const check = checkClipTimes(c.startSec, c.endSec, project.durationSec);
    if (!check.ok) throw new HttpError(400, `"${c.title}": ${check.reason}`);
  }

  const inFlight = await prisma.render.findMany({
    where: { projectId: id, clipId: { in: clips.map((c) => c.id) }, status: { in: ["QUEUED", "RENDERING"] } },
    select: { clipId: true },
  });
  const busy = new Set(inFlight.map((r) => r.clipId));
  const todo = clips.filter((c) => !busy.has(c.id));
  if (todo.length === 0) throw new HttpError(409, "Those clips are already rendering.");

  const created = await prisma.$transaction(async (tx) => {
    const rows = [];
    for (const c of todo) {
      const style = resolveStyle(c.style);
      const spec: RenderSpec = { startSec: c.startSec, endSec: c.endSec, hook: c.hook, captionText: c.captionText, style };
      rows.push(await tx.render.create({ data: { projectId: id, clipId: c.id, aspect: style.aspect, spec: spec as object } }));
    }
    await tx.project.update({ where: { id }, data: { status: "RENDERING", errorMessage: null } });
    return rows;
  });

  try {
    for (const r of created) await enqueueRender({ renderId: r.id });
  } catch (e) {
    console.error("[render] enqueue failed", e);
    await prisma.render.updateMany({
      where: { id: { in: created.map((r) => r.id) }, status: "QUEUED" },
      data: { status: "FAILED", error: "We couldn't start rendering. Please try again." },
    });
    await prisma.project.update({ where: { id }, data: { status: project.status === "RENDERING" ? "RENDERING" : project.status } });
    throw new HttpError(503, "We couldn't start rendering. Please try again.");
  }
  return Response.json({ queued: created.length, skipped: clips.length - todo.length }, { status: 202 });
});
