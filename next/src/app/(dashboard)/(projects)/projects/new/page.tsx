import PageWrapper from "@/components/page-wrapper";
import { CreateProjectForm } from "@/modules/projects/frontend/components/create/create-project-form";

export default function CreateProjectPage() {
  return (
    <PageWrapper>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Create Project
        </h1>

        <p className="text-muted-foreground">
          Start a new project on Kizunia.
        </p>
      </div>

      <CreateProjectForm />
    </PageWrapper>
  );
}
