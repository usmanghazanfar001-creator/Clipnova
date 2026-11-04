import { ASPECTS, type CaptionStyle } from "./spec";

/**
 * Filter graph that reframes the source to the target size and burns captions.
 * The ASS file is referenced by a fixed relative name (the process runs with that
 * directory as cwd), so no user-controlled string is ever embedded in the graph.
 */
export function buildFilterGraph(style: CaptionStyle, assFile = "captions.ass"): string {
  const { width: W, height: H } = ASPECTS[style.aspect];
  const pos = Math.min(100, Math.max(0, style.cropPosition));
  const tail = `setsar=1,ass=${assFile}[v]`;

  if (style.cropMode === "blur-pillarbox") {
    return [
      "[0:v]split=2[a][b]",
      `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=25:5[bg]`,
      `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg]`,
      `[bg][fg]overlay=(${W}-w)/2:(${H}-h)/2,${tail}`,
    ].join(";");
  }
  // "center" is a manual crop pinned at 50%.
  const x = style.cropMode === "center" ? 50 : pos;
  return `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})*${x}/100:(ih-${H})/2,${tail}`;
}

export function buildRenderArgs(opts: {
  input: string;
  output: string;
  startSec: number;
  endSec: number;
  style: CaptionStyle;
}): string[] {
  const dur = opts.endSec - opts.startSec;
  return [
    "-y",
    "-ss", opts.startSec.toFixed(3),
    "-i", opts.input,
    "-t", dur.toFixed(3),
    "-filter_complex", buildFilterGraph(opts.style),
    "-map", "[v]",
    "-map", "0:a:0?",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    opts.output,
  ];
}
