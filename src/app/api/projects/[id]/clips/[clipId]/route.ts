import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { HttpError, handle, readJson } from "@/lib/http";
import { CAN_EDIT, getScopedProject, requireCtx, requireRole } from "@/lib/rbac";
import { serializeClip } from "@/lib/serialize";
import { checkClipTimes } from "@/lib/clips/validate";

type Params = { params: Promise<{ id: string; clipId: string }> };

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const styleSchema = z
  .object({
    captionPosition: z.enum(["top", "middle", "bottom"]),
    fontSize: z.number().int().min(16).max(120),
    fontColor: hex,
    highlightColor: hex,
    background: z.enum(["none", "box", "shadow"]),
    cropMode: z.enum(["center", "manual", "blur-pillarbox"]),
    cropPosition: z.number().min(0).max(100), // horizontal focus point, % of source width
    aspect: z.enum(["9:16", "4:5", "1:1"]),
  })
  .partial()
  .strict();

const schema = z.object({
  startSec: z.number().optional(),
  endSec: z.number().optional(),
  title: z.string().trim().min(1).max(120).optional(),
  hook: z.string().trim().min(1).max(200).optional(),
  captionText: z.string().max(2000).nullable().optional(),
  selected: z.boolean().optional(),
  style: styleSchema.optional(),
});

export const PATCH = handle(async (req: Request, { params }: Params) => {
  const ctx = await requireCtx();
  requireRole(ctx, ...CAN_EDIT);
  const { id, clipId } = await params;
  const project = await getScopedProject(ctx, id);
  const clip = await prisma.clip.findFirst({ where: { id: clipId, projectId: id } });
  if (!clip) throw new HttpError(404, "Clip not found.");

  const body = schema.parse(await readJson(req));
  const start = body.startSec ?? clip.startSec;
  const end = body.endSec ?? clip.endSec;
  if (body.startSec !== undefined || body.endSec !== undefined) {
    if (project.durationSec === null) throw new HttpError(409, "Video details aren't ready yet.");
    const check = checkClipTimes(start, end, project.durationSec);
    if (!check.ok) throw new HttpError(400, check.reason);
  }

  const mergedStyle = body.style
    ? ({ ...((clip.style as Record<string, unknown> | null) ?? {}), ...body.style } as Prisma.InputJsonValue)
    : undefined;

  const updated = await prisma.clip.update({
    where: { id: clipId },
    data: {
      startSec: start,
      endSec: end,
      ...(body.title !== undefined && { title: body.title }),
      ...(body.hook !== undefined && { hook: body.hook }),
      ...(body.captionText !== undefined && { captionText: body.captionText }),
      ...(body.selected !== undefined && { selected: body.selected }),
      ...(mergedStyle !== undefined && { style: mergedStyle }),
    },
  });
  return Response.json({ clip: serializeClip(updated) });
});
