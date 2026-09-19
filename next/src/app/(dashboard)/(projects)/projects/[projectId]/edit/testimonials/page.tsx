import { ProjectTestimonialsTab } from "@/modules/projects/frontend/components/editor/testimonials/project-testimonials-tab";

interface ProjectTestimonialsPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default async function ProjectTestimonialsPage({
  params,
}: ProjectTestimonialsPageProps) {
  const { projectId } = await params;

  return <ProjectTestimonialsTab projectId={projectId} />;
}
