import crypto from "node:crypto";

// Dependency-free HMAC signing for expiring URLs. The signature covers the exact path and
// expiry, so a link for one render can't be reused for another or extended.

function mac(path: string, exp: number, secret: string) {
  if (!secret || secret.length < 16) throw new Error("A signing secret of 16+ characters is required");
  return crypto.createHmac("sha256", secret).update(`${path}:${exp}`).digest("base64url");
}

/** Returns `${path}?exp=<unix seconds>&sig=<hmac>`. */
export function signedPath(path: string, ttlSec: number, secret: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + ttlSec;
  return `${path}?exp=${exp}&sig=${mac(path, exp, secret)}`;
}

export function verifySigned(
  path: string,
  exp: string | null,
  sig: string | null,
  secret: string,
  now = Date.now(),
): boolean {
  const e = Number(exp);
  if (!sig || !exp || !Number.isInteger(e) || e * 1000 < now) return false;
  const expected = Buffer.from(mac(path, e, secret));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
