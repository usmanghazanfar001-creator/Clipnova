// Pure, dependency-free validation for AI-suggested and user-edited clips.
// The LLM only ever proposes data; nothing here (or anywhere) turns model
// output into a shell command.

export const MIN_CLIP_SEC = 10;
export const MAX_CLIP_SEC = 90;

export const PLATFORMS = ["YOUTUBE_SHORTS", "INSTAGRAM_REELS", "TIKTOK", "ALL"] as const;
export type PlatformValue = (typeof PLATFORMS)[number];

export type ClipCandidate = {
  startSec: number;
  endSec: number;
  title: string;
  hook: string;
  summary: string;
  reason: string;
  platform: PlatformValue;
  confidence: number;
};

export type TimeCheck = { ok: true } | { ok: false; reason: string };

export function checkClipTimes(start: unknown, end: unknown, durationSec: number): TimeCheck {
  if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) {
    return { ok: false, reason: "Start and end must be numbers." };
  }
  if (start < 0 || end < 0) return { ok: false, reason: "Times cannot be negative." };
  if (end <= start) return { ok: false, reason: "End must be after start." };
  if (end > durationSec + 1e-6 || start > durationSec) {
    return { ok: false, reason: "Clip extends beyond the end of the video." };
  }
  const len = end - start;
  if (len < MIN_CLIP_SEC - 1e-6) return { ok: false, reason: `Clips must be at least ${MIN_CLIP_SEC} seconds.` };
  if (len > MAX_CLIP_SEC + 1e-6) return { ok: false, reason: `Clips can be at most ${MAX_CLIP_SEC} seconds.` };
  return { ok: true };
}

export function normalizePlatform(value: unknown): PlatformValue {
  if (typeof value !== "string") return "ALL";
  const v = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if ((PLATFORMS as readonly string[]).includes(v)) return v as PlatformValue;
  if (v.includes("YOUTUBE") || v.includes("SHORTS")) return "YOUTUBE_SHORTS";
  if (v.includes("INSTAGRAM") || v.includes("REELS")) return "INSTAGRAM_REELS";
  if (v.includes("TIKTOK")) return "TIKTOK";
  return "ALL";
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Convert one raw LLM object into a clean candidate, or null if invalid. */
export function sanitizeCandidate(raw: unknown, durationSec: number): ClipCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const start = r.start_time ?? r.startSec ?? r.start;
  const end = r.end_time ?? r.endSec ?? r.end;
  if (!checkClipTimes(start, end, durationSec).ok) return null;
  const title = str(r.title, 120);
  const hook = str(r.hook, 200);
  if (!title || !hook) return null;
  let confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence) ? r.confidence : 0.5;
  if (confidence > 1 && confidence <= 100) confidence /= 100; // tolerate 0-100 scores
  confidence = Math.min(1, Math.max(0, confidence));
  return {
    startSec: start as number,
    endSec: end as number,
    title,
    hook,
    summary: str(r.summary, 600),
    reason: str(r.reason ?? r.why, 600),
    platform: normalizePlatform(r.platform),
    confidence,
  };
}

function overlapSec(a: ClipCandidate, b: ClipCandidate) {
  return Math.max(0, Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec));
}

/**
 * Parse the model's JSON text, drop invalid clips, drop heavy overlaps
 * (keeping higher-confidence ones), cap to `max`, and sort by start time.
 */
export function parseHighlights(rawText: string, durationSec: number, max: number): ClipCandidate[] {
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    return [];
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { clips?: unknown }).clips)
      ? (data as { clips: unknown[] }).clips
      : [];
  const valid = list
    .map((c) => sanitizeCandidate(c, durationSec))
    .filter((c): c is ClipCandidate => c !== null)
    .sort((a, b) => b.confidence - a.confidence);

  const accepted: ClipCandidate[] = [];
  for (const c of valid) {
    const tooSimilar = accepted.some((a) => {
      const shorter = Math.min(a.endSec - a.startSec, c.endSec - c.startSec);
      return overlapSec(a, c) > shorter * 0.5;
    });
    if (!tooSimilar) accepted.push(c);
    if (accepted.length >= max) break;
  }
  return accepted.sort((a, b) => a.startSec - b.startSec);
}
