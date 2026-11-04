import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { UserFacingError } from "../ffmpeg";
import { buildAss } from "./captions";
import { buildRenderArgs } from "./ffmpeg-args";
import type { RenderSpec, TimedSegment, TimedWord } from "./spec";

const run = promisify(execFile);

/** Renders one clip to `output`. ffmpeg runs with the work dir as cwd so the ASS file needs no path escaping. */
export async function renderClip(opts: {
  input: string;
  output: string;
  workDir: string;
  spec: RenderSpec;
  words: TimedWord[];
  segments: TimedSegment[];
}): Promise<void> {
  await fs.mkdir(opts.workDir, { recursive: true });
  await fs.mkdir(path.dirname(opts.output), { recursive: true });
  await fs.writeFile(path.join(opts.workDir, "captions.ass"), buildAss(opts.spec, opts.words, opts.segments));
  const tmpOut = `${opts.output}.part.mp4`;
  try {
    await run(
      "ffmpeg",
      ["-loglevel", "error", ...buildRenderArgs({ input: opts.input, output: tmpOut, ...opts.spec })],
      { cwd: opts.workDir, timeout: 15 * 60_000, maxBuffer: 10 * 1024 * 1024 },
    );
    await fs.rename(tmpOut, opts.output); // never expose a half-written file
  } catch (e) {
    await fs.rm(tmpOut, { force: true });
    console.error("[render] ffmpeg failed", (e as { stderr?: string }).stderr?.slice(-500) ?? e);
    throw new UserFacingError("We couldn't render this clip. Please try again.");
  } finally {
    await fs.rm(opts.workDir, { recursive: true, force: true });
  }
}
