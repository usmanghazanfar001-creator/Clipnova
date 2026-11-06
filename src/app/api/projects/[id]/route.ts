import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, readJson } from "@/lib/http";
import { CAN_EDIT, requireCtx, requireRole } from "@/lib/rbac";
import { serializeProject } from "@/lib/serialize";

export const GET = handle(async (req: Request) => {
  const ctx = await requireCtx();
  const archived = new URL(req.url).searchParams.get("archived") === "1";
  const projects = await prisma.project.findMany({
    where: { workspaceId: ctx.workspaceId, archivedAt: archived ? { not: null } : null },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return Response.json({ projects: projects.map(serializeProject), credits: ctx.credits });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  desiredClips: z.number().int().min(1).max(8).default(5),
});

export const POST = handle(async (req: Request) => {
  const ctx = await requireCtx();
  requireRole(ctx, ...CAN_EDIT);
  const { name, desiredClips } = createSchema.parse(await readJson(req));
  const project = await prisma.project.create({
    data: { name, desiredClips, workspaceId: ctx.workspaceId, createdById: ctx.userId },
  });
  return Response.json({ project: serializeProject(project) }, { status: 201 });
});
