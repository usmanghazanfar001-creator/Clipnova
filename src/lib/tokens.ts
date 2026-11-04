import crypto from "node:crypto";
import type { TokenType } from "@prisma/client";
import { prisma } from "./db";

const hash = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

const TTL_MS: Record<TokenType, number> = {
  EMAIL_VERIFY: 24 * 60 * 60 * 1000,
  PASSWORD_RESET: 60 * 60 * 1000,
};

/** Creates a single-use token. Only its hash is stored; the raw value goes in the email. */
export async function createToken(userId: string, type: TokenType): Promise<string> {
  const raw = crypto.randomBytes(32).toString("base64url");
  await prisma.authToken.deleteMany({ where: { userId, type } });
  await prisma.authToken.create({
    data: { userId, type, tokenHash: hash(raw), expiresAt: new Date(Date.now() + TTL_MS[type]) },
  });
  return raw;
}

/** Validates and consumes a token. Returns the user id, or null if invalid/expired. */
export async function consumeToken(raw: string, type: TokenType): Promise<string | null> {
  if (!raw || raw.length > 200) return null;
  const row = await prisma.authToken.findUnique({ where: { tokenHash: hash(raw) } });
  if (!row || row.type !== type) return null;
  await prisma.authToken.delete({ where: { id: row.id } }).catch(() => undefined);
  if (row.expiresAt < new Date()) return null;
  return row.userId;
}
