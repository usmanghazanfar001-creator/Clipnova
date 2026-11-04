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
    // A project that has sat in QUEUED for a couple of minutes never reached the worker
    // (for example Redis was down when it was uploaded), so it can be queued again.
    const stalled = project.status === "QUEUED" && Date.now() - project.updatedAt.getTime() > 2 * 60_000;
    if ((project.status !== "FAILED" && !stalled) || !project.sourceExt) {
      throw new HttpError(409, "Only failed or stalled projects with an uploaded video can be re-queued.");
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
