import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export class UserFacingError extends Error {
  constructor(
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}

// Always argv arrays with execFile: no shell, and no model- or user-controlled strings in commands.

export async function probe(inputPath: string): Promise<{ durationSec: number; hasAudio: boolean }> {
  try {
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", inputPath],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
    );
    const info = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: { codec_type?: string }[];
    };
    const durationSec = Number(info.format?.duration);
    if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("no duration");
    return { durationSec, hasAudio: !!info.streams?.some((s) => s.codec_type === "audio") };
  } catch {
    throw new UserFacingError("We couldn't read this video. The file may be corrupted or in an unsupported format.");
  }
}

/** Mono 16 kHz MP3 keeps a 30-minute video well under Groq's upload size limit. */
export async function extractAudio(inputPath: string, outputPath: string): Promise<void> {
  try {
    await run(
      "ffmpeg",
      ["-y", "-i", inputPath, "-vn", "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-b:a", "48k", outputPath],
      { timeout: 10 * 60_000, maxBuffer: 10 * 1024 * 1024 },
    );
  } catch {
    throw new UserFacingError("We couldn't extract audio from this video.");
  }
}
