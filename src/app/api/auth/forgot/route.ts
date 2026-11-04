import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { createToken } from "@/lib/tokens";
import { appUrl, sendEmail } from "@/lib/email";

const schema = z.object({ email: z.string().trim().toLowerCase().email() });

export const POST = handle(async (req: Request) => {
  rateLimit(req, "forgot", 5);
  const { email } = schema.parse(await readJson(req));
  const user = await prisma.user.findUnique({ where: { email } });
  if (user?.passwordHash) {
    const token = await createToken(user.id, "PASSWORD_RESET");
    await sendEmail({
      to: email,
      subject: "Reset your Clipnova password",
      text: `Reset your password: ${appUrl(`/reset-password?token=${token}`)}\n\nThis link expires in 1 hour. If you didn't ask for it, ignore this email.`,
    });
  }
  return Response.json({ ok: true, message: "If that email has an account, a reset link is on its way." });
});
