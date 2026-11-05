import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, readJson } from "@/lib/http";
import { CAN_EDIT, getScopedProject, requireCtx, requireRole } from "@/lib/rbac";
import { serializeClip, serializeProject } from "@/lib/serialize";
import { removeProjectFiles } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Params) => {
  const ctx = await requireCtx();
  const { id } = await params;
  await getScopedProject(ctx, id);
  const project = await prisma.project.findUniqueOrThrow({
    where: { id },
    include: { clips: { orderBy: { startSec: "asc" } }, transcript: true },
  });
  return Response.json({
    project: serializeProject(project),
    clips: project.clips.map(serializeClip),
    transcript: project.transcript
      ? { language: project.transcript.language, segments: project.transcript.segments }
      : null,
    canEdit: CAN_EDIT.includes(ctx.role) || ctx.isPlatformAdmin,
  });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  archived: z.boolean().optional(),
});

export const PATCH = handle(async (req: Request, { params }: Params) => {
  const ctx = await requireCtx();
  requireRole(ctx, ...CAN_EDIT);
  const { id } = await params;
  await getScopedProject(ctx, id);
  const body = patchSchema.parse(await readJson(req));
  const project = await prisma.project.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.archived !== undefined && { archivedAt: body.archived ? new Date() : null }),
    },
  });
  return Response.json({ project: serializeProject(project) });
});

export const DELETE = handle(async (_req: Request, { params }: Params) => {
  const ctx = await requireCtx();
  requireRole(ctx, "OWNER");
  const { id } = await params;
  await getScopedProject(ctx, id);
  await prisma.project.delete({ where: { id } });
  // Files live on the machine that ran the upload; failing to remove them must not fail the delete.
  await removeProjectFiles(id).catch((e) => console.error("[delete] file cleanup failed", e));
  return Response.json({ ok: true });
});
