import fs from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { HttpError, handle } from "@/lib/http";
import { CAN_EDIT, getScopedProject, requireCtx, requireRole } from "@/lib/rbac";
import { serializeProject } from "@/lib/serialize";
import { copyBlob, sourceBlobPath } from "@/lib/blob";
import { ensureProjectDir, removeProjectFiles, sourcePath } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

const BUSY = ["UPLOADING", "QUEUED", "PROCESSING", "TRANSCRIBING", "ANALYZING", "RENDERING"];

export const POST = handle(async (_req: Request, { params }: Params) => {
  const ctx = await requireCtx();
  requireRole(ctx, ...CAN_EDIT);
  const { id } = await params;
  const src = await getScopedProject(ctx, id);
  if (BUSY.includes(src.status)) throw new HttpError(409, "Wait for processing to finish before duplicating.");

  const full = await prisma.project.findUniqueOrThrow({ where: { id }, include: { clips: true, transcript: true } });
  const complete = !!full.sourceExt && full.status !== "FAILED" && full.status !== "EXPIRED";

  const copy = await prisma.project.create({
    data: {
      workspaceId: src.workspaceId,
      createdById: ctx.userId,
      name: `${src.name} (copy)`.slice(0, 120),
      desiredClips: src.desiredClips,
      whisperModel: src.whisperModel,
      ...(complete && {
        status: full.status,
        sourceExt: full.sourceExt,
        originalFilename: full.originalFilename,
        sizeBytes: full.sizeBytes,
        durationSec: full.durationSec,
      }),
      ...(complete &&
        full.transcript && {
          transcript: {
            create: {
              language: full.transcript.language,
              durationSec: full.transcript.durationSec,
              text: full.transcript.text,
              segments: full.transcript.segments as Prisma.InputJsonValue,
              words: (full.transcript.words ?? undefined) as Prisma.InputJsonValue | undefined,
            },
          },
        }),
      ...(complete && {
        clips: {
          create: full.clips.map((c) => ({
            startSec: c.startSec,
            endSec: c.endSec,
            title: c.title,
            hook: c.hook,
            summary: c.summary,
            reason: c.reason,
            platform: c.platform,
            confidence: c.confidence,
            captionText: c.captionText,
            selected: c.selected,
            style: (c.style ?? undefined) as Prisma.InputJsonValue | undefined,
          })),
        },
      }),
    },
  });

  if (complete) {
    try {
      if (full.sourceBlob) {
        const to = sourceBlobPath(copy.id, full.sourceExt!);
        await copyBlob(full.sourceBlob, to);
        await prisma.project.update({ where: { id: copy.id }, data: { sourceBlob: to } });
      } else {
        await ensureProjectDir(copy.id);
        await fs.copyFile(sourcePath(id, full.sourceExt!), sourcePath(copy.id, full.sourceExt!));
      }
    } catch (e) {
      console.error("[duplicate] file copy failed", e);
      await prisma.project.delete({ where: { id: copy.id } });
      await removeProjectFiles(copy.id);
      throw new HttpError(500, "Couldn't duplicate the video file. Please try again.");
    }
  }
  return Response.json({ project: serializeProject(copy) }, { status: 201 });
});
