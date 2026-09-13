"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface CompetitionEditorNavigationProps {
  competitionId: string;
}

const tabs = [
  { label: "Summary", segment: "" },
  { label: "General", segment: "general" },
  { label: "Documentation", segment: "documentation" },
  { label: "Schedule", segment: "schedule" },
  { label: "Locations", segment: "locations" },
  { label: "Technologies", segment: "technologies" },
  { label: "Eligibility", segment: "eligibility" },
  { label: "Details", segment: "details" },
  { label: "Danger", segment: "danger" },
] as const;

/**
 * Route-based tab nav, replacing the old client `useState` tab switch in
 * `competition-editor.tsx` — modeled on `project-editor-navigation.tsx`.
 * Each tab is a real route under `[id]/`, so this only ever highlights the
 * active segment via `usePathname()`; it never owns any tab state itself.
 *
 * `flex-none` on every link (overriding nothing shared, since this isn't
 * built on `ui/tabs.tsx`'s `TabsTrigger`) plus `flex-nowrap` and
 * `overflow-y-hidden` on the scroll container are deliberate: forcing every
 * item to its natural width is what makes the row overflow
 * horizontally-only instead of wrapping onto a second line inside a
 * height-constrained container, which is what produced the stray vertical
 * scroll affordance in the old `Tabs`-based nav.
 */
export function CompetitionEditorNavigation({
  competitionId,
}: CompetitionEditorNavigationProps) {
  const pathname = usePathname();

  const basePath = `/admin/competitions/${competitionId}`;

  return (
    <nav className="border-b">
      <div className="flex flex-nowrap items-center gap-1 overflow-x-auto overflow-y-hidden">
        {tabs.map((tab) => {
          const href = tab.segment ? `${basePath}/${tab.segment}` : basePath;

          const isActive = tab.segment
            ? pathname === href || pathname.startsWith(`${href}/`)
            : pathname === basePath;

          const isDanger = tab.segment === "danger";

          return (
            <Link
              key={tab.label}
              href={href}
              className={cn(
                "relative flex-none whitespace-nowrap px-4 py-3 text-sm font-medium text-muted-foreground transition-colors",
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
