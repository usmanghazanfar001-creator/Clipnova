import { ASPECTS, type CaptionStyle, type RenderSpec, type TimedSegment, type TimedWord } from "./spec";

/** "#RRGGBB" -> ASS "&H00BBGGRR" */
export function assColor(hex: string, alpha = "00") {
  const h = hex.replace("#", "");
  return `&H${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

/** ASS override-tag colour, e.g. "&HBBGGRR&" */
const tagColor = (hex: string) => assColor(hex).replace("&H00", "&H") + "&";

export function assTime(sec: number) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** Remove anything libass would treat as markup. Caption text is user/model/transcript supplied. */
export function escapeAss(text: string) {
  return text.replace(/[{}\\]/g, "").replace(/\r?\n/g, "\\N").trim();
}

type Line = { words: TimedWord[] };

function groupLines(words: TimedWord[]): Line[] {
  const lines: Line[] = [];
  let cur: TimedWord[] = [];
  const len = () => cur.reduce((n, w) => n + w.word.length + 1, 0);
  for (const w of words) {
    const last = cur[cur.length - 1];
    if (cur.length > 0 && (cur.length >= 4 || len() + w.word.length > 26 || w.start - last.end > 0.8)) {
      lines.push({ words: cur });
      cur = [];
    }
    cur.push(w);
    if (/[.!?]$/.test(w.word)) {
      lines.push({ words: cur });
      cur = [];
    }
  }
  if (cur.length) lines.push({ words: cur });
  return lines;
}

function styleLine(name: string, size: number, primary: string, align: number, marginV: number, bg: CaptionStyle["background"]) {
  const box = bg === "box";
  const outline = box ? 16 : bg === "shadow" ? 4 : 0;
  const shadow = bg === "shadow" ? 2 : 0;
  const outlineColour = box ? assColor("#000000", "A0") : assColor("#000000", "00");
  return `Style: ${name},Arial,${size},${primary},${primary},${outlineColour},${assColor("#000000", "80")},-1,0,0,0,100,100,0,0,${box ? 3 : 1},${outline},${shadow},${align},70,70,${marginV},1`;
}

/**
 * Build an ASS subtitle file for one clip. Times are relative to the clip start
 * (the render seeks to the clip start, so its timeline begins at zero).
 *
 * - A user-written caption text replaces transcript captions for the whole clip.
 * - Otherwise word timestamps drive short lines with the active word highlighted;
 *   without word timestamps, transcript segments are shown as-is.
 * - The hook is shown at the top for the first seconds.
 */
export function buildAss(spec: RenderSpec, words: TimedWord[], segments: TimedSegment[]): string {
  const { width: W, height: H } = ASPECTS[spec.style.aspect];
  const dur = spec.endSec - spec.startSec;
  const st = spec.style;
  const align = st.captionPosition === "top" ? 8 : st.captionPosition === "middle" ? 5 : 2;
  const hookV = Math.round(H * 0.08);
  const capV = st.captionPosition === "middle" ? 0 : Math.round(st.captionPosition === "top" ? H * 0.22 : H * 0.14);
  const primary = assColor(st.fontColor);

  const out: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    styleLine("Cap", st.fontSize, primary, align, capV, st.background),
    styleLine("Hook", Math.round(st.fontSize * 1.15), primary, 8, hookV, st.background),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const dialogue = (start: number, end: number, style: string, text: string) => {
    if (end - start < 0.02 || !text) return;
    out.push(`Dialogue: 0,${assTime(start)},${assTime(end)},${style},,0,0,0,,${text}`);
  };

  const hook = escapeAss(spec.hook);
  if (hook) dialogue(0.2, Math.min(3.2, dur), "Hook", hook);

  const custom = spec.captionText?.trim();
  if (custom) {
    dialogue(0, dur, "Cap", escapeAss(custom));
    return out.join("\n") + "\n";
  }

  const inClip = words
    .map((w) => ({ word: w.word.trim(), start: w.start - spec.startSec, end: w.end - spec.startSec }))
    .filter((w) => w.word && w.end > 0 && w.start < dur)
    .map((w) => ({ ...w, start: Math.max(0, w.start), end: Math.min(dur, w.end) }));

  if (inClip.length > 0) {
    const hi = tagColor(st.highlightColor);
    const base = tagColor(st.fontColor);
    for (const line of groupLines(inClip)) {
      const ws = line.words;
      ws.forEach((w, i) => {
        const text = ws
          .map((x, j) => (j === i ? `{\\c${hi}}${escapeAss(x.word)}{\\c${base}}` : escapeAss(x.word)))
          .join(" ");
        const end = i < ws.length - 1 ? ws[i + 1].start : w.end;
        dialogue(w.start, Math.max(end, w.start + 0.05), "Cap", text);
      });
    }
  } else {
    for (const s of segments) {
      const a = Math.max(0, s.start - spec.startSec);
      const b = Math.min(dur, s.end - spec.startSec);
      dialogue(a, b, "Cap", escapeAss(s.text));
    }
  }
  return out.join("\n") + "\n";
}
