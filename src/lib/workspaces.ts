import { prisma } from "./db";
import { getEnv } from "./env";

/** Every user gets one default workspace on sign-up; they are its Owner. */
export async function createDefaultWorkspace(userId: string, displayName: string) {
  return prisma.workspace.create({
    data: {
      name: `${displayName}'s workspace`,
      credits: getEnv().DEFAULT_CREDITS,
      memberships: { create: { userId, role: "OWNER" } },
    },
  });
}
