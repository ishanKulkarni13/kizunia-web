import { ProjectContentEditor } from "@/modules/projects/frontend/components/editor/content/project-content-editor";

interface ProjectContentPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default async function ProjectContentPage({
  params,
}: ProjectContentPageProps) {
  const { projectId } = await params;

  return <ProjectContentEditor projectId={projectId} />;
}
