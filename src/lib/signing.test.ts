import { test } from "node:test";
import assert from "node:assert/strict";
import { signedPath, verifySigned } from "./signing";

const SECRET = "test-secret-test-secret-test-secret";
const PATH = "/api/download/render/abc123";

function parts(url: string) {
  const u = new URL(url, "http://x");
  return { path: u.pathname, exp: u.searchParams.get("exp"), sig: u.searchParams.get("sig") };
}

test("valid signed link verifies", () => {
  const { path, exp, sig } = parts(signedPath(PATH, 600, SECRET));
  assert.equal(path, PATH);
  assert.equal(verifySigned(path, exp, sig, SECRET), true);
});

test("expired link is rejected", () => {
  const { path, exp, sig } = parts(signedPath(PATH, 60, SECRET, Date.now() - 3_600_000));
  assert.equal(verifySigned(path, exp, sig, SECRET), false);
});

test("tampered path, expiry, signature or secret is rejected", () => {
  const { path, exp, sig } = parts(signedPath(PATH, 600, SECRET));
  assert.equal(verifySigned("/api/download/render/other", exp, sig, SECRET), false);
  assert.equal(verifySigned("/api/download/zip/abc123", exp, sig, SECRET), false);
  assert.equal(verifySigned(path, String(Number(exp) + 999), sig, SECRET), false);
  assert.equal(verifySigned(path, exp, sig!.slice(0, -2) + "xx", SECRET), false);
  assert.equal(verifySigned(path, exp, sig, "another-secret-another-secret"), false);
  assert.equal(verifySigned(path, null, null, SECRET), false);
  assert.equal(verifySigned(path, "abc", sig, SECRET), false);
});

test("short secrets are refused", () => {
  assert.throws(() => signedPath(PATH, 60, "short"));
});
