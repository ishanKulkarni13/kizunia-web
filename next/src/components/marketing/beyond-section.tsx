import Link from "next/link";
import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/ssr/FolderSimple";
import { UserCircleIcon } from "@phosphor-icons/react/dist/ssr/UserCircle";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowUpRight";

const ITEMS = [
  {
    icon: FolderSimpleIcon,
    title: "Projects",
    body: "See what people are building for the competitions on Kizunia.",
    href: "/projects",
  },
  {
    icon: UserCircleIcon,
    title: "Portfolio",
    body: "Your projects and competition history, collected into one public profile.",
    href: "/portfolio",
  },
];

export function BeyondSection() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-20">
      <ScrollReveal>
        <p className="text-sm font-medium text-muted-foreground">
          Also on Kizunia
        </p>
      </ScrollReveal>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {ITEMS.map((item, i) => (
          <ScrollReveal key={item.title} delay={i * 0.08}>
            <Link
              href={item.href}
              className="group flex items-start gap-4 rounded-xl border border-border p-5 transition-colors duration-300 hover:bg-muted/60"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <item.icon className="size-4" weight="bold" />
              </div>
              <div className="flex-1">
                <h3 className="flex items-center gap-1.5 text-base font-medium">
                  {item.title}
                  <ArrowUpRightIcon
                    className="size-3.5 text-muted-foreground opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    weight="bold"
                  />
                </h3>
                <p className="mt-1 text-pretty text-sm leading-relaxed text-muted-foreground">
                  {item.body}
                </p>
              </div>
            </Link>
          </ScrollReveal>
        ))}
      </div>
    </section>
  );
}
