import { ProjectTechnologiesTab } from "@/modules/projects/frontend/components/editor/technologies/project-technologies-tab";

interface ProjectTechnologiesPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default async function ProjectTechnologiesPage({
  params,
}: ProjectTechnologiesPageProps) {
  const { projectId } = await params;

  return <ProjectTechnologiesTab projectId={projectId} />;
}
