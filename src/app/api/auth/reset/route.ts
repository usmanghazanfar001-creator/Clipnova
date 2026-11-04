import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { HttpError, handle, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { consumeToken } from "@/lib/tokens";

const schema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(8, "Use at least 8 characters.").max(128),
});

export const POST = handle(async (req: Request) => {
  rateLimit(req, "reset", 8);
  const { token, password } = schema.parse(await readJson(req));
  const userId = await consumeToken(token, "PASSWORD_RESET");
  if (!userId) throw new HttpError(400, "This reset link is invalid or has expired.");
  await prisma.user.update({
    where: { id: userId },
    // A successful reset also proves control of the inbox.
    data: { passwordHash: await bcrypt.hash(password, 12), emailVerified: new Date() },
  });
  return Response.json({ ok: true });
});
