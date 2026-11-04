// Shared, dependency-free types for rendering. A RenderSpec is a snapshot of a clip
// taken when the render is queued, so later edits never change a render in flight.

export const ASPECTS = {
  "9:16": { width: 1080, height: 1920 },
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
} as const;

export type Aspect = keyof typeof ASPECTS;

export type CaptionStyle = {
  captionPosition: "top" | "middle" | "bottom";
  fontSize: number;
  fontColor: string;
  highlightColor: string;
  background: "none" | "box" | "shadow";
  cropMode: "center" | "manual" | "blur-pillarbox";
  cropPosition: number;
  aspect: Aspect;
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  captionPosition: "bottom",
  fontSize: 56,
  fontColor: "#ffffff",
  highlightColor: "#fbbf24",
  background: "box",
  cropMode: "center",
  cropPosition: 50,
  aspect: "9:16",
};

export type RenderSpec = {
  startSec: number;
  endSec: number;
  hook: string;
  captionText: string | null;
  style: CaptionStyle;
};

export type TimedWord = { word: string; start: number; end: number };
export type TimedSegment = { start: number; end: number; text: string };

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Merge stored (possibly partial or malformed) style JSON onto the defaults. */
export function resolveStyle(raw: unknown): CaptionStyle {
  const s = { ...DEFAULT_CAPTION_STYLE };
  if (!raw || typeof raw !== "object") return s;
  const r = raw as Record<string, unknown>;
  if (r.captionPosition === "top" || r.captionPosition === "middle" || r.captionPosition === "bottom") s.captionPosition = r.captionPosition;
  if (typeof r.fontSize === "number" && r.fontSize >= 16 && r.fontSize <= 120) s.fontSize = Math.round(r.fontSize);
  if (typeof r.fontColor === "string" && HEX.test(r.fontColor)) s.fontColor = r.fontColor;
  if (typeof r.highlightColor === "string" && HEX.test(r.highlightColor)) s.highlightColor = r.highlightColor;
  if (r.background === "none" || r.background === "box" || r.background === "shadow") s.background = r.background;
  if (r.cropMode === "center" || r.cropMode === "manual" || r.cropMode === "blur-pillarbox") s.cropMode = r.cropMode;
  if (typeof r.cropPosition === "number" && r.cropPosition >= 0 && r.cropPosition <= 100) s.cropPosition = r.cropPosition;
  if (r.aspect === "9:16" || r.aspect === "4:5" || r.aspect === "1:1") s.aspect = r.aspect;
  return s;
}
