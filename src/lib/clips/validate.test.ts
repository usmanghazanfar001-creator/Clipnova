import { test } from "node:test";
import assert from "node:assert/strict";
import { checkClipTimes, normalizePlatform, parseHighlights } from "./validate";

const DUR = 600;
const clip = (over: Record<string, unknown> = {}) => ({
  start_time: 30,
  end_time: 60,
  title: "A title",
  hook: "A hook",
  summary: "s",
  reason: "r",
  platform: "TikTok",
  confidence: 0.8,
  ...over,
});

test("rejects negative times", () => {
  assert.equal(checkClipTimes(-1, 20, DUR).ok, false);
});
test("rejects end before or equal to start", () => {
  assert.equal(checkClipTimes(50, 40, DUR).ok, false);
  assert.equal(checkClipTimes(50, 50, DUR).ok, false);
});
test("rejects clips shorter than 10s and longer than 90s", () => {
  assert.equal(checkClipTimes(10, 19.5, DUR).ok, false);
  assert.equal(checkClipTimes(10, 20, DUR).ok, true);
  assert.equal(checkClipTimes(0, 90, DUR).ok, true);
  assert.equal(checkClipTimes(0, 90.5, DUR).ok, false);
});
test("rejects timestamps beyond video duration", () => {
  assert.equal(checkClipTimes(590, 605, DUR).ok, false);
  assert.equal(checkClipTimes(570, 600, DUR).ok, true);
});
test("rejects non-numeric and NaN input", () => {
  assert.equal(checkClipTimes("10", 30, DUR).ok, false);
  assert.equal(checkClipTimes(NaN, 30, DUR).ok, false);
  assert.equal(checkClipTimes(10, Infinity, DUR).ok, false);
});
test("normalizes platform names", () => {
  assert.equal(normalizePlatform("YouTube Shorts"), "YOUTUBE_SHORTS");
  assert.equal(normalizePlatform("instagram reels"), "INSTAGRAM_REELS");
  assert.equal(normalizePlatform("TikTok"), "TIKTOK");
  assert.equal(normalizePlatform("whatever"), "ALL");
});
test("parseHighlights drops invalid clips and keeps valid ones", () => {
  const raw = JSON.stringify({
    clips: [
      clip(),
      clip({ start_time: -5, end_time: 20 }),
      clip({ start_time: 100, end_time: 105 }),
      clip({ start_time: 100, end_time: 400 }),
      clip({ start_time: 580, end_time: 640 }),
      clip({ title: "" }),
    ],
  });
  const out = parseHighlights(raw, DUR, 8);
  assert.equal(out.length, 1);
  assert.equal(out[0].platform, "TIKTOK");
});
test("parseHighlights removes heavy overlaps, keeps the higher confidence one", () => {
  const raw = JSON.stringify({
    clips: [
      clip({ start_time: 30, end_time: 60, confidence: 0.6, title: "low" }),
      clip({ start_time: 35, end_time: 65, confidence: 0.9, title: "high" }),
      clip({ start_time: 200, end_time: 230, confidence: 0.5, title: "other" }),
    ],
  });
  const out = parseHighlights(raw, DUR, 8);
  assert.deepEqual(out.map((c) => c.title), ["high", "other"]);
});
test("parseHighlights caps the count and sorts by start time", () => {
  const clips = [100, 300, 200, 400].map((s, i) => clip({ start_time: s, end_time: s + 30, title: `c${i}`, confidence: 0.9 - i * 0.1 }));
  const out = parseHighlights(JSON.stringify({ clips }), DUR, 3);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((c) => c.startSec), [100, 200, 300]);
});
test("parseHighlights tolerates garbage and 0-100 confidence", () => {
  assert.deepEqual(parseHighlights("not json", DUR, 5), []);
  assert.deepEqual(parseHighlights('{"clips":"nope"}', DUR, 5), []);
  const out = parseHighlights(JSON.stringify([clip({ confidence: 85 })]), DUR, 5);
  assert.equal(out[0].confidence, 0.85);
});
