import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCtx } from "@/lib/rbac";
import { AppNav } from "@/components/AppNav";
import { ProjectView } from "@/components/ProjectView";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  const { id } = await params;
  const exists = await prisma.project.findFirst({ where: { id, workspaceId: ctx.workspaceId }, select: { id: true } });
  if (!exists) notFound();
  return (
    <>
      <AppNav name={ctx.name ?? ctx.email} workspace={ctx.workspaceName} credits={ctx.credits} />
      <main className="container" style={{ padding: "24px 20px 80px" }}>
        <ProjectView projectId={id} />
      </main>
    </>
  );
}
