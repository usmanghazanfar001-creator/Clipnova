import { getServerSession } from "next-auth";
import type { Role } from "@prisma/client";
import { authOptions } from "./auth";
import { prisma } from "./db";
import { HttpError } from "./http";

export type Ctx = {
  userId: string;
  email: string;
  name: string | null;
  workspaceId: string;
  workspaceName: string;
  credits: number;
  role: Role;
  isPlatformAdmin: boolean;
};

/** Resolves the signed-in user and their (default) workspace membership, or null. */
export async function getCtx(): Promise<Ctx | null> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { memberships: { orderBy: { createdAt: "asc" }, take: 1, include: { workspace: true } } },
  });
  const m = user?.memberships[0];
  if (!user || !m) return null;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    workspaceId: m.workspaceId,
    workspaceName: m.workspace.name,
    credits: m.workspace.credits,
    role: m.role,
    isPlatformAdmin: user.isPlatformAdmin,
  };
}

export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) throw new HttpError(401, "Please sign in.");
  return ctx;
}

/** Platform admins pass every role check. */
export function requireRole(ctx: Ctx, ...allowed: Role[]) {
  if (ctx.isPlatformAdmin || allowed.includes(ctx.role)) return;
  throw new HttpError(403, "You do not have permission to do that.");
}

export const CAN_EDIT: Role[] = ["OWNER", "EDITOR"];

/** Loads a project strictly inside the caller's workspace; 404 otherwise (no existence leak). */
export async function getScopedProject(ctx: Ctx, id: string) {
  const project = await prisma.project.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!project) throw new HttpError(404, "Project not found.");
  return project;
}
