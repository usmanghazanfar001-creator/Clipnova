import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { copy, del, get } from "@vercel/blob";

/** True when a Vercel Blob store is configured (BLOB_READ_WRITE_TOKEN is present). */
export function blobConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/** Where a project's source video lives in the (private) Blob store. */
export function sourceBlobPath(projectId: string, ext: string) {
  if (!/^[a-z0-9]+$/i.test(projectId)) throw new Error("Invalid project id");
  if (!/^\.[a-z0-9]{2,5}$/i.test(ext)) throw new Error("Invalid extension");
  return `projects/${projectId}/source${ext.toLowerCase()}`;
}

/** Streams a private blob to a local file (via a .part file so a crash never leaves a half file). */
export async function downloadBlob(pathname: string, dest: string) {
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error("The uploaded video could not be found in storage.");
  }
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(result.stream as never), createWriteStream(tmp));
    await rename(tmp, dest);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export async function copyBlob(from: string, to: string, contentType?: string) {
  await copy(from, to, { access: "private", contentType, addRandomSuffix: false });
}

export async function deleteBlob(pathname: string | null | undefined) {
  if (!pathname || !blobConfigured()) return;
  await del(pathname);
}
