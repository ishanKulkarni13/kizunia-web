"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { useProjectStore } from "../../store/project.store";

interface ProjectEditorNavigationProps {
  projectId: string;
}

const tabs = [
  {
    label: "Overview",
    segment: "",
  },
  {
    label: "Content",
    segment: "content",
  },
  {
    label: "Links",
    segment: "links",
  },
  {
    label: "Technologies",
    segment: "technologies",
  },
  {
    label: "Categories",
    segment: "categories",
  },
  {
    label: "Team",
    segment: "team",
  },
  {
    label: "Testimonials",
    segment: "testimonials",
  },
  {
    label: "Danger Zone",
    segment: "danger",
  },
] as const;

export function ProjectEditorNavigation({
  projectId,
}: ProjectEditorNavigationProps) {
  const pathname = usePathname();

  const canDelete = useProjectStore(
    (state) => state.project?.permissions.canDelete ?? false,
  );

  const basePath = `/projects/${projectId}/edit`;

  const visibleTabs = tabs.filter(
    (tab) => tab.segment !== "danger" || canDelete,
  );

  return (
    <nav className="border-b" >
      <div className="flex items-center gap-1 overflow-x-auto">
        {visibleTabs.map((tab) => {
          const href = tab.segment
            ? `${basePath}/${tab.segment}`
            : basePath;

          const isActive = tab.segment
            ? pathname === href || pathname.startsWith(`${href}/`)
            : pathname === basePath;

          const isDanger = tab.segment === "danger";

          return (
            <Link
              key={tab.label}
              href={href}
              className={cn(
                "relative shrink-0 whitespace-nowrap px-4 py-3 text-sm font-medium text-muted-foreground transition-colors",
                isDanger ? "hover:text-destructive" : "hover:text-foreground",
                isActive && (isDanger ? "text-destructive" : "text-foreground"),
                isActive &&
                  cn(
                    "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5",
                    isDanger ? "after:bg-destructive" : "after:bg-foreground",
                  ),
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