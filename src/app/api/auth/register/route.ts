import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { handle, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { createToken } from "@/lib/tokens";
import { appUrl, sendEmail } from "@/lib/email";
import { createDefaultWorkspace } from "@/lib/workspaces";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, "Use at least 8 characters.").max(128),
});

export const POST = handle(async (req: Request) => {
  rateLimit(req, "register", 5);
  const { name, email, password } = schema.parse(await readJson(req));
  const requireVerify = getEnv().REQUIRE_EMAIL_VERIFICATION === "true";

  // Same response whether or not the email is already registered (no account enumeration).
  const generic = Response.json({
    ok: true,
    message: requireVerify
      ? "Check your inbox to verify your email, then sign in."
      : "Account created. You can sign in now.",
  });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return generic;

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await bcrypt.hash(password, 12),
      emailVerified: requireVerify ? null : new Date(),
    },
  });
  await createDefaultWorkspace(user.id, name);

  if (requireVerify) {
    const token = await createToken(user.id, "EMAIL_VERIFY");
    await sendEmail({
      to: email,
      subject: "Verify your Clipnova email",
      text: `Welcome to Clipnova!\n\nConfirm your email: ${appUrl(`/api/auth/verify?token=${token}`)}\n\nThis link expires in 24 hours.`,
    });
  }
  return generic;
});
