import Link from "next/link";
import type { ReactNode } from "react";
import { legalConfig } from "@/constants/legal";

export type LegalSectionDefinition = {
  id: string;
  title: string;
  content: ReactNode;
};

type LegalPageProps = {
  title: string;
  description: string;
  sections: readonly LegalSectionDefinition[];
  children: ReactNode;
};

export function LegalPage({ title, description, sections, children }: LegalPageProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-5 lg:px-10">
          <Link href="/" className="text-lg font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4">
            Kizunia
          </Link>
          <nav aria-label="Legal navigation" className="flex items-center gap-5 text-sm text-muted-foreground">
            <Link href="/legal/terms" className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Terms</Link>
            <Link href="/legal/privacy" className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Privacy</Link>
          </nav>
        </div>
      </header>

      <main>
        <div className="mx-auto w-full max-w-7xl px-6 pb-20 pt-16 lg:px-10 lg:pb-28 lg:pt-24">
          <div className="max-w-3xl">
            <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-primary">Legal</p>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">{description}</p>
            <p className="mt-6 text-sm text-muted-foreground">
              Last updated: <time dateTime={legalConfig.lastUpdatedDate}>{legalConfig.lastUpdated}</time>
            </p>
          </div>

          <div className="mt-14 grid gap-12 lg:grid-cols-[14rem_minmax(0,46rem)] lg:items-start lg:gap-20">
            <nav aria-label={`${title} contents`} className="lg:sticky lg:top-8">
              <p className="text-sm font-semibold text-foreground">Contents</p>
              <ol className="mt-4 grid gap-2 border-l border-border pl-4 text-sm text-muted-foreground">
                {sections.map((section, index) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`} className="block py-1 leading-5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="mr-2 font-mono text-xs text-primary">{String(index + 1).padStart(2, "0")}</span>
                      {section.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            <article className="min-w-0 space-y-12">{children}</article>
          </div>
        </div>
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-10">
          <p>Questions about these policies? Contact information is maintained in the legal configuration.</p>
          <nav aria-label="Legal documents" className="flex gap-5">
            <Link href="/legal/terms" className="font-medium text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Terms of Service</Link>
            <Link href="/legal/privacy" className="font-medium text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Privacy Policy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
