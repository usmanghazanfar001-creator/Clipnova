import fs from "node:fs/promises";
import { Worker, type Job } from "bullmq";
import { prisma } from "../src/lib/db";
import { getEnv } from "../src/lib/env";
import {
  createConnection,
  JOB_ATTEMPTS,
  QUEUE_NAME,
  RENDER_ATTEMPTS,
  RENDER_QUEUE_NAME,
  type ProcessingJob,
  type RenderJob,
} from "../src/lib/queue";
import { audioPath, projectDir, renderPath, sourcePath } from "../src/lib/storage";
import { downloadBlob } from "../src/lib/blob";
import { renderClip } from "../src/lib/render/run";
import { resolveStyle, type RenderSpec, type TimedSegment, type TimedWord } from "../src/lib/render/spec";
import path from "node:path";
import { extractAudio, probe, UserFacingError } from "../src/lib/ffmpeg";
import { suggestClips, transcribeAudio } from "../src/lib/groq";
import type { ProjectStatus } from "@prisma/client";

async function setStatus(projectId: string, status: ProjectStatus, errorMessage: string | null = null) {
  await prisma.project.update({ where: { id: projectId }, data: { status, errorMessage } });
}

/** Returns the local path of the source video, downloading it from Blob storage first if needed. */
async function ensureSource(project: { id: string; sourceExt: string | null; sourceBlob: string | null }) {
  if (!project.sourceExt) throw new UserFacingError("The source video is missing.");
  const file = sourcePath(project.id, project.sourceExt);
  if (await fs.stat(file).then(() => true, () => false)) return file;
  if (!project.sourceBlob) throw new UserFacingError("The source video is missing.");
  await downloadBlob(project.sourceBlob, file);
  return file;
}

async function process_(job: Job<ProcessingJob>) {
  const env = getEnv();
  const { projectId, mode } = job.data;
  const project = await prisma.project.findUnique({ where: { id: projectId }, include: { transcript: true } });
  if (!project || !project.sourceExt) return; // deleted or never uploaded

  let durationSec = project.durationSec;

  // 1. Probe + extract audio
  if (!durationSec || (mode === "full" && !project.transcript)) {
    await setStatus(projectId, "PROCESSING");
    const src = await ensureSource(project);
    const info = await probe(src);
    if (info.durationSec > env.MAX_VIDEO_MINUTES * 60) {
      throw new UserFacingError(`Videos can be at most ${env.MAX_VIDEO_MINUTES} minutes long.`);
    }
    if (!info.hasAudio) throw new UserFacingError("This video has no audio track to transcribe.");
    durationSec = info.durationSec;
    await prisma.project.update({ where: { id: projectId }, data: { durationSec } });
  }

  // 2. Transcribe (skipped when a transcript already exists, e.g. on re-analysis or retry)
  let segments = project.transcript?.segments as { id: number; start: number; end: number; text: string }[] | undefined;
  if (!project.transcript) {
    await extractAudio(await ensureSource(project), audioPath(projectId));
    await setStatus(projectId, "TRANSCRIBING");
    const model = project.whisperModel ?? env.WHISPER_MODEL;
    const t = await transcribeAudio(audioPath(projectId), model);
    await prisma.transcript.upsert({
      where: { projectId },
      create: {
        projectId,
        language: t.language,
        durationSec: t.durationSec,
        text: t.text,
        segments: t.segments,
        words: t.words,
      },
      update: { language: t.language, durationSec: t.durationSec, text: t.text, segments: t.segments, words: t.words },
    });
    segments = t.segments;
    await fs.rm(audioPath(projectId), { force: true });
  }

  // 3. Analyze
  await setStatus(projectId, "ANALYZING");
  const clips = await suggestClips(segments ?? [], durationSec!, project.desiredClips);
  await prisma.$transaction([
    prisma.clip.deleteMany({ where: { projectId } }),
    prisma.clip.createMany({
      data: clips.map((c) => ({ ...c, projectId, captionText: null })),
    }),
  ]);
  await setStatus(projectId, "READY_FOR_REVIEW");
}

const worker = new Worker<ProcessingJob>(
  QUEUE_NAME,
  async (job) => {
    try {
      await process_(job);
    } catch (e) {
      const known = e instanceof UserFacingError ? e : null;
      const lastAttempt = job.attemptsMade + 1 >= JOB_ATTEMPTS;
      // Non-retryable errors fail immediately; transient ones are retried by BullMQ with backoff.
      if (known && !known.retryable) {
        await setStatus(job.data.projectId, "FAILED", known.message).catch(() => undefined);
        return; // handled: don't retry
      }
      if (lastAttempt) {
        await setStatus(
          job.data.projectId,
          "FAILED",
          known?.message ?? "Something went wrong while processing your video. Please retry.",
        ).catch(() => undefined);
      } else {
        console.warn(`[worker] attempt ${job.attemptsMade + 1} failed for ${job.data.projectId}`, e);
      }
      throw e;
    }
  },
  { connection: createConnection(), concurrency: 2 },
);

worker.on("ready", () => console.log("[worker] ready"));
worker.on("failed", (job, err) => console.error(`[worker] job ${job?.id} failed:`, err.message));

// ---------------------------------------------------------------------------
// Rendering: one job per clip. Snapshot spec in Render.spec drives everything.
// ---------------------------------------------------------------------------

/** When no renders are pending for a project, move it out of RENDERING. */
async function finalizeProject(projectId: string) {
  const pending = await prisma.render.count({ where: { projectId, status: { in: ["QUEUED", "RENDERING"] } } });
  if (pending > 0) return;
  const done = await prisma.render.count({ where: { projectId, status: "DONE" } });
  await prisma.project.updateMany({
    where: { id: projectId, status: "RENDERING" },
    data: { status: done > 0 ? "COMPLETED" : "READY_FOR_REVIEW" },
  });
}

async function failRender(renderId: string, projectId: string, message: string) {
  await prisma.render.update({ where: { id: renderId }, data: { status: "FAILED", error: message } }).catch(() => undefined);
  await finalizeProject(projectId).catch(() => undefined);
}

async function processRender(job: Job<RenderJob>) {
  const env = getEnv();
  const render = await prisma.render.findUnique({
    where: { id: job.data.renderId },
    include: { project: { include: { transcript: true } } },
  });
  if (!render || render.status === "DONE") return; // deleted or already finished
  const { project } = render;
  if (!project.sourceExt) throw new UserFacingError("The source video is missing.");

  await prisma.render.update({ where: { id: render.id }, data: { status: "RENDERING", error: null } });

  const raw = render.spec as unknown as RenderSpec;
  const spec: RenderSpec = { ...raw, style: resolveStyle(raw.style) };
  const words = ((project.transcript?.words as TimedWord[] | null) ?? []).filter((w) => typeof w?.word === "string");
  const segments = ((project.transcript?.segments as TimedSegment[] | null) ?? []).filter((s) => typeof s?.text === "string");

  const output = renderPath(project.id, render.id);
  await renderClip({
    input: await ensureSource(project),
    output,
    workDir: path.join(projectDir(project.id), `work-${render.id}`),
    spec,
    words,
    segments,
  });

  const stat = await fs.stat(output);
  await prisma.render.update({
    where: { id: render.id },
    data: {
      status: "DONE",
      sizeBytes: BigInt(stat.size),
      expiresAt: new Date(Date.now() + env.RENDER_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  await finalizeProject(project.id);
}

const renderWorker = new Worker<RenderJob>(
  RENDER_QUEUE_NAME,
  async (job) => {
    const render = await prisma.render.findUnique({ where: { id: job.data.renderId }, select: { projectId: true } });
    try {
      await processRender(job);
    } catch (e) {
      const known = e instanceof UserFacingError ? e : null;
      const lastAttempt = job.attemptsMade + 1 >= RENDER_ATTEMPTS;
      if (render && (known || lastAttempt)) {
        await failRender(job.data.renderId, render.projectId, known?.message ?? "Rendering failed. Please try again.");
        if (known) return; // handled: no retry for deterministic failures
      }
      throw e;
    }
  },
  { connection: createConnection(), concurrency: 1 },
);

renderWorker.on("ready", () => console.log("[render-worker] ready"));
renderWorker.on("failed", (job, err) => console.error(`[render-worker] job ${job?.id} failed:`, err.message));

// Hourly: delete expired render files (rows stay so the UI can show "expired").
async function purgeExpiredRenders() {
  const expired = await prisma.render.findMany({
    where: { status: "DONE", expiresAt: { lt: new Date() }, sizeBytes: { not: null } },
    select: { id: true, projectId: true },
    take: 200,
  });
  for (const r of expired) {
    await fs.rm(renderPath(r.projectId, r.id), { force: true });
    await prisma.render.update({ where: { id: r.id }, data: { sizeBytes: null } });
  }
}
const purgeTimer = setInterval(() => void purgeExpiredRenders().catch((e) => console.error("[purge]", e)), 60 * 60 * 1000);

const shutdown = async () => {
  clearInterval(purgeTimer);
  await worker.close();
  await renderWorker.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
