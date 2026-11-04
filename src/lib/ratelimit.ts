import { HttpError } from "./http";

// Simple in-memory sliding-window limiter for auth endpoints.
// Replace with a Redis-backed limiter when running more than one web instance.
const hits = new Map<string, number[]>();

export function rateLimit(req: Request, bucket: string, limit = 8, windowMs = 60_000) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) throw new HttpError(429, "Too many attempts. Please wait a minute and try again.");
  recent.push(now);
  hits.set(key, recent);
}
