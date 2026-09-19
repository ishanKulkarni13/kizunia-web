import { ProjectLinksTab } from "@/modules/projects/frontend/components/editor/links/project-links-tab";

interface ProjectLinksPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default async function ProjectLinksPage({
  params,
}: ProjectLinksPageProps) {
  const { projectId } = await params;

  return <ProjectLinksTab projectId={projectId} />;
}
