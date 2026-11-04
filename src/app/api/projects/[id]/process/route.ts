import { z } from "zod";
import { prisma } from "@/lib/db";
import { HttpError, handle, readJson } from "@/lib/http";
import { CAN_EDIT, getScopedProject, requireCtx, requireRole } from "@/lib/rbac";
import { serializeProject } from "@/lib/serialize";
import { enqueueProcessing } from "@/lib/queue";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  mode: z.enum(["retry", "reanalyze"]),
  clipCount: z.number().int().min(1).max(8).optional(),
});

/**
 * retry      - re-run a FAILED project (resumes after the last stored step, no extra credit)
 * reanalyze  - keep the transcript (including edits) and regenerate clip suggestions
 */
export const POST = handle(async (req: Request, { params }: Params) => {
  const ctx = await requireCtx();
  requireRole(ctx, ...CAN_EDIT);
  const { id } = await params;
  const project = await getScopedProject(ctx, id);
  const { mode, clipCount } = schema.parse(await readJson(req));

  if (mode === "retry") {
    if (project.status !== "FAILED" || !project.sourceExt) {
      throw new HttpError(409, "Only failed projects with an uploaded video can be retried.");
    }
  } else {
    const hasTranscript = await prisma.transcript.count({ where: { projectId: id } });
    if (!["READY_FOR_REVIEW", "COMPLETED"].includes(project.status) || !hasTranscript) {
      throw new HttpError(409, "Clips can only be regenerated once the transcript is ready.");
    }
  }

  const updated = await prisma.project.update({
    where: { id },
    data: { status: "QUEUED", errorMessage: null, ...(clipCount && { desiredClips: clipCount }) },
  });
  await enqueueProcessing({ projectId: id, mode: mode === "retry" ? "full" : "reanalyze" });
  return Response.json({ project: serializeProject(updated) });
});
