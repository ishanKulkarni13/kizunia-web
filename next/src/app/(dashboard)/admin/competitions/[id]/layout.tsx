import { CompetitionFacade } from "@/modules/competitions/backend/facade";
import { CompetitionEditorShell } from "@/components/admin/competition-editor/competition-editor-shell";
import PageWrapper from "@/components/page-wrapper";

export default async function CompetitionEditorLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;

  const competition = await CompetitionFacade.adminGetForEdit(id);

  return (
    <PageWrapper
      breadcrumbs={[
        { label: "Competitions", href: "/admin/competitions" },
        {
          label: competition.title,
          href: `/admin/competitions/${competition.id}`,
        },
      ]}
    >
      <CompetitionEditorShell competition={competition}>
        {children}
      </CompetitionEditorShell>
    </PageWrapper>
  );
}
