import { test } from "node:test";
import assert from "node:assert/strict";
import { assColor, assTime, buildAss, escapeAss } from "./captions";
import { DEFAULT_CAPTION_STYLE, resolveStyle, type RenderSpec } from "./spec";

const spec = (over: Partial<RenderSpec> = {}): RenderSpec => ({
  startSec: 100,
  endSec: 120,
  hook: "Wait for it",
  captionText: null,
  style: { ...DEFAULT_CAPTION_STYLE },
  ...over,
});

test("colour and time formatting", () => {
  assert.equal(assColor("#ff8000"), "&H000080FF");
  assert.equal(assColor("#000000", "A0"), "&HA0000000");
  assert.equal(assTime(0), "0:00:00.00");
  assert.equal(assTime(75.456), "0:01:15.46");
  assert.equal(assTime(3661.5), "1:01:01.50");
});

test("escapeAss strips markup characters and keeps line breaks", () => {
  assert.equal(escapeAss("a {\\an8}b \\ c"), "a an8b  c");
  assert.equal(escapeAss("one\ntwo"), "one\\Ntwo");
});

test("word timestamps become relative, highlighted events inside the clip only", () => {
  const words = [
    { word: "before", start: 90, end: 91 },
    { word: " Hello", start: 100.5, end: 101 },
    { word: "brave", start: 101, end: 101.6 },
    { word: "world.", start: 101.6, end: 102.4 },
    { word: "after", start: 130, end: 131 },
  ];
  const ass = buildAss(spec(), words, []);
  const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:") && l.includes(",Cap,"));
  assert.equal(dialogues.length, 3); // one event per word of the single line
  assert.match(dialogues[0], /0:00:00\.50/); // 100.5 -> 0.5s into the clip
  assert.ok(!ass.includes("before") && !ass.includes("after"));
  assert.match(dialogues[0], /\{\\c&H[0-9A-F]{6}&\}Hello/); // active word highlighted
});

test("falls back to transcript segments when there are no words", () => {
  const ass = buildAss(spec({ hook: "" }), [], [{ start: 98, end: 104, text: "Segment text" }]);
  const d = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.equal(d.length, 1);
  assert.match(d[0], /0:00:00\.00,0:00:04\.00/); // clamped to clip start
});

test("custom caption text replaces transcript captions for the whole clip", () => {
  const ass = buildAss(spec({ captionText: "My own caption" }), [{ word: "x", start: 101, end: 102 }], []);
  const caps = ass.split("\n").filter((l) => l.includes(",Cap,"));
  assert.equal(caps.length, 1);
  assert.match(caps[0], /My own caption/);
  assert.match(caps[0], /0:00:20\.00/);
});

test("hook is shown at the top for at most 3 seconds", () => {
  const ass = buildAss(spec(), [], []);
  const hook = ass.split("\n").find((l) => l.includes(",Hook,"))!;
  assert.match(hook, /0:00:00\.20,0:00:03\.20/);
});

test("resolveStyle ignores malformed stored style", () => {
  assert.deepEqual(resolveStyle(null), DEFAULT_CAPTION_STYLE);
  const s = resolveStyle({ fontSize: 9999, fontColor: "red", aspect: "1:1", cropPosition: 30, background: "evil" });
  assert.equal(s.fontSize, DEFAULT_CAPTION_STYLE.fontSize);
  assert.equal(s.fontColor, DEFAULT_CAPTION_STYLE.fontColor);
  assert.equal(s.aspect, "1:1");
  assert.equal(s.cropPosition, 30);
  assert.equal(s.background, DEFAULT_CAPTION_STYLE.background);
});
