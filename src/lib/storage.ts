import fs from "node:fs/promises";
import path from "node:path";
import { getEnv } from "./env";

export const ALLOWED_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv"] as const;

export const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
};

export function extensionOf(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}

// Paths are built only from project ids (cuid) and fixed names, never from user filenames.
export function projectDir(projectId: string) {
  if (!/^[a-z0-9]+$/i.test(projectId)) throw new Error("Invalid project id");
  return path.resolve(getEnv().STORAGE_DIR, "projects", projectId);
}

export const sourcePath = (projectId: string, ext: string) => path.join(projectDir(projectId), `source${ext}`);
export const audioPath = (projectId: string) => path.join(projectDir(projectId), "audio.mp3");

export function renderDir(projectId: string) {
  return path.join(projectDir(projectId), "renders");
}

export function renderPath(projectId: string, renderId: string) {
  if (!/^[a-z0-9]+$/i.test(renderId)) throw new Error("Invalid render id");
  return path.join(renderDir(projectId), `${renderId}.mp4`);
}

export async function ensureProjectDir(projectId: string) {
  await fs.mkdir(projectDir(projectId), { recursive: true });
}

export async function removeProjectFiles(projectId: string) {
  await fs.rm(projectDir(projectId), { recursive: true, force: true });
}
