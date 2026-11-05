import { head, BlobNotFoundError } from "@vercel/blob";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { HttpError, handle, readJson } from "@/lib/http";
import { deleteBlob, sourceBlobPath } from "@/lib/blob";
import { enqueueProcessing } from "@/lib/queue";
import { CAN_EDIT, getScopedProject, requireCtx, requireRole } from "@/lib/rbac";
import { serializeProject } from "@/lib/serialize";
import { extensionOf } from "@/lib/storage";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({ filename: z.string().min(1).max(300) });

/** Called by the browser after the direct upload finished: verifies the file, charges 1 credit, queues processing. */
export const POST = handle(async (req: Request, { params }: Params) => {
  const ctx = await requireCtx();
  requireRole(ctx, ...CAN_EDIT);
  const { id } = await params;
  const project = await getScopedProject(ctx, id);
  const env = getEnv();
  const { filename } = schema.parse(await readJson(req));

  const uploadable = ["DRAFT", "UPLOADING"].includes(project.status) || (project.status === "FAILED" && !project.sourceExt);
  if (!uploadable) throw new HttpError(409, "This project already has a video.");

  const ext = extensionOf(filename);
  if (!ext) throw new HttpError(415, "Unsupported file type. Use MP4, MOV, WEBM or MKV.");
  const pathname = sourceBlobPath(id, ext);

  let size: number;
  try {
    size = (await head(pathname)).size;
  } catch (e) {
    if (e instanceof BlobNotFoundError) throw new HttpError(400, "The upload did not finish. Please try again.");
    throw e;
  }
  if (size === 0) throw new HttpError(400, "The file was empty.");
  if (size > env.MAX_UPLOAD_MB * 1024 * 1024) {
    await deleteBlob(pathname);
    throw new HttpError(413, `Files can be at most ${env.MAX_UPLOAD_MB} MB.`);
  }

  const charged = await prisma.workspace.updateMany({
    where: { id: ctx.workspaceId, credits: { gte: 1 } },
    data: { credits: { decrement: 1 } },
  });
  if (charged.count === 0) {
    await deleteBlob(pathname);
    await prisma.project.update({ where: { id }, data: { status: "DRAFT" } });
    throw new HttpError(402, "You're out of credits.");
  }

  const safeName = filename.split(/[\\/]/).pop()!.slice(0, 200);
  const updated = await prisma.project.update({
    where: { id },
    data: {
      sourceExt: ext,
      sourceBlob: pathname,
      originalFilename: safeName,
      sizeBytes: BigInt(size),
      durationSec: null,
      status: "QUEUED",
      errorMessage: null,
    },
  });

  try {
    await enqueueProcessing({ projectId: id, mode: "full" });
  } catch (e) {
    console.error("[upload/complete] enqueue failed", e);
    await prisma.workspace.update({ where: { id: ctx.workspaceId }, data: { credits: { increment: 1 } } });
    await prisma.project.update({ where: { id }, data: { status: "FAILED", errorMessage: "We couldn't start processing. Please retry." } });
    throw new HttpError(503, "We couldn't start processing. Please retry.");
  }
  return Response.json({ project: serializeProject(updated) });
});
