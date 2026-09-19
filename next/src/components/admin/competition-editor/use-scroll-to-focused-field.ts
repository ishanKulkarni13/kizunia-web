"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  getFieldAnchorId,
  type SummaryFieldKey,
} from "@/modules/competitions/editor/field-metadata";

/**
 * Scrolls to the field named by a `?focus=<fieldKey>` query param on
 * arrival, then strips the param — used by the Summary tab's "Not
 * specified" links (`?focus=organizer` etc.), which navigate to the
 * field's actual tab route and rely on this to land the viewport on the
 * right control instead of just switching tabs. Stripping the param
 * afterward means a refresh or back-navigation to this URL doesn't
 * re-trigger the scroll.
 *
 * Mount this once in each Tab component that has fields with an anchor id
 * (`getFieldAnchorId`) — not in the shared shell, since it needs to run
 * again on every tab-route navigation, and a component mounted once at the
 * layout level wouldn't remount (or re-run this effect) on a route change
 * to a sibling tab.
 */
export function useScrollToFocusedField() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const focus = searchParams.get("focus");
    if (!focus) return;

    const el = document.getElementById(
      getFieldAnchorId(focus as SummaryFieldKey),
    );
    el?.scrollIntoView({ behavior: "smooth", block: "center" });

    router.replace(pathname, { scroll: false });
  }, [searchParams, pathname, router]);
}
