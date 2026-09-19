import { ProjectDangerZoneTab } from "@/modules/projects/frontend/components/editor/danger/project-danger-zone-tab";

interface ProjectDangerZonePageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default async function ProjectDangerZonePage({
  params,
}: ProjectDangerZonePageProps) {
  const { projectId } = await params;

  return <ProjectDangerZoneTab projectId={projectId} />;
}
