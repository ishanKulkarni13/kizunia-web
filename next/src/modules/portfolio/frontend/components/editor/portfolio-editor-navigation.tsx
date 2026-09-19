"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const tabs = [
  { label: "Profile", segment: "profile" },
  { label: "Links", segment: "links" },
  { label: "Technologies", segment: "technologies" },
  { label: "Education", segment: "education" },
  { label: "Experience", segment: "experience" },
  { label: "Achievements", segment: "achievements" },
  { label: "Certifications", segment: "certifications" },
  { label: "Projects", segment: "projects" },
  { label: "Testimonials", segment: "testimonials" },
  { label: "Settings", segment: "settings" },
] as const;

const basePath = "/portfolio/edit";

export function PortfolioEditorNavigation() {
  const pathname = usePathname();

  return (
    <nav className="border-b">
      <div className="flex items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const href = `${basePath}/${tab.segment}`;

          const isActive = pathname === href || pathname.startsWith(`${href}/`);

          return (
            <Link
              key={tab.label}
              href={href}
              className={cn(
                "relative shrink-0 whitespace-nowrap px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                isActive &&
                  "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
