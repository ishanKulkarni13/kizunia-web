import { CompetitionPreferencesForm } from "@/components/preferences/competition-preferences-form";
import PageWrapper from "@/components/page-wrapper";

export default function CompetitionPreferencesPage() {
  return (
    <PageWrapper breadcrumbs={[]}>
      <div className="m-2 flex flex-col justify-stretch items-stretch gap-2">
        <CompetitionPreferencesForm />
      </div>
    </PageWrapper>
  );
}
