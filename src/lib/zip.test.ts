import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createZipStream, slugify } from "./zip";

const hasUnzip = (() => {
  try {
    execFileSync("unzip", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("slugify produces safe names", () => {
  assert.equal(slugify("Héllo, World! 100% real"), "hello-world-100-real");
  assert.equal(slugify("../../etc/passwd"), "etcpasswd");
  assert.equal(slugify("!!!"), "clip");
});

test("zip stream is a valid archive with intact contents", { skip: !hasUnzip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zip-test-"));
  const a = path.join(dir, "a.bin");
  const b = path.join(dir, "b.txt");
  fs.writeFileSync(a, crypto.randomBytes(300_000));
  fs.writeFileSync(b, "hello clipnova\n");
  const zipPath = path.join(dir, "out.zip");

  const out = fs.createWriteStream(zipPath);
  await new Promise<void>((resolve, reject) => {
    const s = createZipStream([
      { name: "clip-1-first.mp4", path: a },
      { name: "clip-2-second.mp4", path: b },
    ]);
    s.on("error", reject);
    out.on("finish", resolve);
    s.pipe(out);
  });

  const test = execFileSync("unzip", ["-t", zipPath]).toString();
  assert.match(test, /No errors detected/);

  const ex = path.join(dir, "ex");
  execFileSync("unzip", ["-q", zipPath, "-d", ex]);
  assert.deepEqual(fs.readFileSync(path.join(ex, "clip-1-first.mp4")), fs.readFileSync(a));
  assert.equal(fs.readFileSync(path.join(ex, "clip-2-second.mp4"), "utf8"), "hello clipnova\n");
  fs.rmSync(dir, { recursive: true, force: true });
});
