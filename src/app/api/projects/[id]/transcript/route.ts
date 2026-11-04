import { z } from "zod";
import { prisma } from "@/lib/db";
import { HttpError, handle, readJson } from "@/lib/http";
import { CAN_EDIT, getScopedProject, requireCtx, requireRole } from "@/lib/rbac";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  segments: z.array(z.object({ id: z.number().int().min(0), text: z.string().max(2000) })).min(1).max(5000),
});

/** Edit segment text only; timestamps stay as transcribed. */
export const PATCH = handle(async (req: Request, { params }: Params) => {
  const ctx = await requireCtx();
  requireRole(ctx, ...CAN_EDIT);
  const { id } = await params;
  await getScopedProject(ctx, id);
  const { segments: edits } = schema.parse(await readJson(req));

  const transcript = await prisma.transcript.findUnique({ where: { projectId: id } });
  if (!transcript) throw new HttpError(404, "No transcript yet.");

  const editById = new Map(edits.map((e) => [e.id, e.text.trim()]));
  const current = transcript.segments as { id: number; start: number; end: number; text: string }[];
  const next = current.map((s) => (editById.has(s.id) ? { ...s, text: editById.get(s.id)! } : s));

  await prisma.transcript.update({
    where: { projectId: id },
    data: { segments: next, text: next.map((s) => s.text).join(" ") },
  });
  return Response.json({ segments: next });
});
