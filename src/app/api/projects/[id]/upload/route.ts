import fs from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { HttpError, handle } from "@/lib/http";
import { CAN_EDIT, getScopedProject, requireCtx, requireRole } from "@/lib/rbac";
import { serializeProject } from "@/lib/serialize";
import { ensureProjectDir, extensionOf, removeProjectFiles, sourcePath } from "@/lib/storage";
import { enqueueProcessing } from "@/lib/queue";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/**
 * Raw-body upload (the browser sends the File itself, which gives real progress events).
 * Headers: x-filename (URL-encoded original name). Size is enforced while streaming.
 */
export const POST = handle(async (req: Request, { params }: Params) => {
  const ctx = await requireCtx();
  requireRole(ctx, ...CAN_EDIT);
  const { id } = await params;
  const project = await getScopedProject(ctx, id);
  const env = getEnv();

  const uploadable = project.status === "DRAFT" || (project.status === "FAILED" && !project.sourceExt);
  if (!uploadable) throw new HttpError(409, "This project already has a video.");
  if (ctx.credits < 1) throw new HttpError(402, "You're out of credits.");

  let filename = "";
  try {
    filename = decodeURIComponent(req.headers.get("x-filename") ?? "");
  } catch {
    /* fall through to the extension check */
  }
  const ext = extensionOf(filename);
  if (!ext) throw new HttpError(415, "Unsupported file type. Use MP4, MOV, WEBM or MKV.");

  const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new HttpError(413, `Files can be at most ${env.MAX_UPLOAD_MB} MB.`);
  if (!req.body) throw new HttpError(400, "No file received.");

  await prisma.project.update({ where: { id }, data: { status: "UPLOADING", errorMessage: null } });
  await ensureProjectDir(id);
  const dest = sourcePath(id, ext);

  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      if (received > maxBytes) cb(new HttpError(413, `Files can be at most ${env.MAX_UPLOAD_MB} MB.`));
      else cb(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(req.body as never), limiter, fs.createWriteStream(dest));
  } catch (e) {
    await removeProjectFiles(id);
    const message = e instanceof HttpError ? e.message : "The upload was interrupted. Please try again.";
    await prisma.project.update({ where: { id }, data: { status: "FAILED", errorMessage: message } });
    throw e instanceof HttpError ? e : new HttpError(400, message);
  }
  if (received === 0) {
    await removeProjectFiles(id);
    await prisma.project.update({ where: { id }, data: { status: "DRAFT" } });
    throw new HttpError(400, "The file was empty.");
  }

  // Charge one credit atomically; refuse if another upload used the last one meanwhile.
  const charged = await prisma.workspace.updateMany({
    where: { id: ctx.workspaceId, credits: { gte: 1 } },
    data: { credits: { decrement: 1 } },
  });
  if (charged.count === 0) {
    await removeProjectFiles(id);
    await prisma.project.update({ where: { id }, data: { status: "DRAFT" } });
    throw new HttpError(402, "You're out of credits.");
  }

  const safeName = filename.split(/[\\/]/).pop()!.slice(0, 200);
  const updated = await prisma.project.update({
    where: { id },
    data: {
      sourceExt: ext,
      originalFilename: safeName,
      sizeBytes: BigInt(received),
      durationSec: null,
      status: "QUEUED",
      errorMessage: null,
    },
  });

  try {
    await enqueueProcessing({ projectId: id, mode: "full" });
  } catch (e) {
    console.error("[upload] enqueue failed", e);
    await prisma.workspace.update({ where: { id: ctx.workspaceId }, data: { credits: { increment: 1 } } });
    await prisma.project.update({
      where: { id },
      data: { status: "FAILED", errorMessage: "We couldn't start processing. Please retry." },
    });
    throw new HttpError(503, "We couldn't start processing. Please retry.");
  }
  return Response.json({ project: serializeProject(updated) });
});
