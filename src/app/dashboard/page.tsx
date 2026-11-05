import { blobConfigured } from "@/lib/blob";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getCtx } from "@/lib/rbac";
import { serializeProject } from "@/lib/serialize";
import { AppNav } from "@/components/AppNav";
import { Dashboard } from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  const projects = await prisma.project.findMany({
    where: { workspaceId: ctx.workspaceId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const env = getEnv();
  return (
    <>
      <AppNav name={ctx.name ?? ctx.email} workspace={ctx.workspaceName} credits={ctx.credits} />
      <main className="container" style={{ padding: "28px 20px 80px" }}>
        <Dashboard
          initialProjects={projects.map(serializeProject)}
          canEdit={ctx.role !== "VIEWER" || ctx.isPlatformAdmin}
          canDelete={ctx.role === "OWNER" || ctx.isPlatformAdmin}
          maxUploadMb={env.MAX_UPLOAD_MB}
          blobUploads={blobConfigured()}
          maxMinutes={env.MAX_VIDEO_MINUTES}
        />
      </main>
    </>
  );
}
