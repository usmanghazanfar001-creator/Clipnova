import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { HttpError, handle, readJson } from "@/lib/http";
import { sourceBlobPath } from "@/lib/blob";
import { CAN_EDIT, getScopedProject, requireCtx, requireRole } from "@/lib/rbac";
import { extensionOf } from "@/lib/storage";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * Token endpoint for direct browser-to-Blob uploads (the video never passes through this server,
 * which is what lets files bigger than Vercel's 4.5 MB request limit work).
 * The browser calls /upload/complete afterwards; that is where the credit is charged.
 */
export const POST = handle(async (req: Request, { params }: Params) => {
  const body = (await readJson(req)) as HandleUploadBody;
  const { id } = await params;

  const json = await handleUpload({
    body,
    request: req,
    // Only runs when a browser asks for an upload token; the completion webhook has no session.
    onBeforeGenerateToken: async (pathname) => {
      const ctx = await requireCtx();
      requireRole(ctx, ...CAN_EDIT);
      const project = await getScopedProject(ctx, id);
      const env = getEnv();

      const uploadable = ["DRAFT", "UPLOADING"].includes(project.status) || (project.status === "FAILED" && !project.sourceExt);
      if (!uploadable) throw new HttpError(409, "This project already has a video.");
      if (ctx.credits < 1) throw new HttpError(402, "You're out of credits.");

      const ext = extensionOf(pathname);
      if (!ext || pathname !== sourceBlobPath(id, ext)) throw new HttpError(400, "Invalid upload path.");

      await prisma.project.update({ where: { id }, data: { status: "UPLOADING", errorMessage: null } });
      return {
        allowedContentTypes: ["video/*", "application/octet-stream"],
        maximumSizeInBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
        addRandomSuffix: false,
        allowOverwrite: true, // lets a failed upload be retried at the same path
        validUntil: Date.now() + 2 * 60 * 60 * 1000,
        tokenPayload: JSON.stringify({ projectId: id }),
      };
    },
    onUploadCompleted: async () => {
      // Intentionally empty: /upload/complete (called by the browser) finalizes the project.
    },
  });
  return Response.json(json);
});
