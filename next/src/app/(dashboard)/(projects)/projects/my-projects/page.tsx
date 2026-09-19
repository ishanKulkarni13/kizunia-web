import PageWrapper from "@/components/page-wrapper";
import { MyProjectsPage } from "@/modules/projects/frontend/components/my-projects/my-projects-page";

export default function ProjectsMinePage() {
  return (
    <PageWrapper breadcrumbs={[{label: "My Projects", href: "#"}]}>
      <MyProjectsPage />
    </PageWrapper>
  );
}
