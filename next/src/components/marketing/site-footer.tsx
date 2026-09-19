import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-border px-6 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4 text-sm text-muted-foreground sm:flex-row sm:justify-between">
        <p>&copy; {new Date().getFullYear()} Kizunia</p>
        <nav className="flex items-center gap-6">
          <Link href="/competitions" className="transition-colors hover:text-foreground">
            Competitions
          </Link>
          <Link href="/projects" className="transition-colors hover:text-foreground">
            Projects
          </Link>
          <Link href="/legal/privacy" className="transition-colors hover:text-foreground">
            Privacy
          </Link>
          <Link href="/legal/terms" className="transition-colors hover:text-foreground">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
