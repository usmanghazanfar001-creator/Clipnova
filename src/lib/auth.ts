import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { getEnv } from "./env";
import { createDefaultWorkspace } from "./workspaces";

const env = getEnv();

// Used to keep login timing similar whether or not the account exists.
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeOe0Y1kQ0q9K6u5Q8v0sQ1Y7pX3b8f5mW";

const providers: NextAuthOptions["providers"] = [
  CredentialsProvider({
    name: "Email and password",
    credentials: { email: { type: "email" }, password: { type: "password" } },
    async authorize(credentials) {
      const email = credentials?.email?.trim().toLowerCase();
      const password = credentials?.password;
      if (!email || !password) return null;
      const user = await prisma.user.findUnique({ where: { email } });
      const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !user.passwordHash || !ok) return null;
      if (env.REQUIRE_EMAIL_VERIFICATION === "true" && !user.emailVerified) {
        throw new Error("EMAIL_NOT_VERIFIED");
      }
      return { id: user.id, email: user.email, name: user.name };
    },
  }),
];

if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }),
  );
}

export const authOptions: NextAuthOptions = {
  secret: env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 14 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers,
  callbacks: {
    async signIn({ account, profile, user }) {
      if (account?.provider !== "google") return true;
      const p = profile as { email?: string; email_verified?: boolean; name?: string } | undefined;
      const email = p?.email?.toLowerCase();
      if (!email || p?.email_verified !== true) return false;
      let dbUser = await prisma.user.findUnique({ where: { email } });
      if (!dbUser) {
        dbUser = await prisma.user.create({
          data: { email, name: p?.name ?? user.name ?? null, emailVerified: new Date() },
        });
        await createDefaultWorkspace(dbUser.id, dbUser.name ?? email.split("@")[0]);
      } else if (!dbUser.emailVerified) {
        dbUser = await prisma.user.update({ where: { id: dbUser.id }, data: { emailVerified: new Date() } });
      }
      user.id = dbUser.id;
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.uid) session.user.id = token.uid as string;
      return session;
    },
  },
};
