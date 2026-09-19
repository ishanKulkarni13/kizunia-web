import PageWrapper from "@/components/page-wrapper";
import { PortfolioEditorLayout } from "@/modules/portfolio/frontend/components/editor/portfolio-editor-layout";

export default function PortfolioEditLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageWrapper
      breadcrumbs={[
        { label: "Portfolio", href: "/portfolio" },
        { label: "Edit", href: "#" },
      ]}
    >
      <PortfolioEditorLayout>{children}</PortfolioEditorLayout>
    </PageWrapper>
  );
}
