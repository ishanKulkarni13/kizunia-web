import { ProjectProfileEditor } from "@/modules/projects/frontend/components/editor/profile/project-profile-editor";

interface ProjectEditPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default async function ProjectEditPage({
  params,
}: ProjectEditPageProps) {
  const { projectId } = await params;

  return <ProjectProfileEditor projectId={projectId} />;
}