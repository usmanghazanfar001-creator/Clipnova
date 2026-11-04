import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { consumeToken } from "@/lib/tokens";
import { appUrl } from "@/lib/email";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const userId = await consumeToken(token, "EMAIL_VERIFY");
  if (!userId) return NextResponse.redirect(appUrl("/login?error=invalid_link"));
  await prisma.user.update({ where: { id: userId }, data: { emailVerified: new Date() } });
  return NextResponse.redirect(appUrl("/login?verified=1"));
}
