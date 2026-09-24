import { describe, expect, it } from "vitest";

import { resetSessionScopedState } from "./reset-registry";

import type { PortfolioEditorDto } from "@/modules/portfolio/dtos";
import { usePortfolioStore } from "@/modules/portfolio/frontend/store/portfolio.store";
import { usePortfolioProfileStore } from "@/modules/portfolio/frontend/store/portfolio-profile.store";
import { usePortfolioProjectsStore } from "@/modules/portfolio/frontend/store/portfolio-projects.store";
import { usePortfolioTechnologiesStore } from "@/modules/portfolio/frontend/store/portfolio-technologies.store";
import { usePortfolioTestimonialsStore } from "@/modules/portfolio/frontend/store/portfolio-testimonials.store";
import { useProjectLinksStore } from "@/modules/projects/frontend/store/project-links.store";
import { useProjectTechnologiesStore } from "@/modules/projects/frontend/store/project-technologies.store";
import { useProjectTestimonialsStore } from "@/modules/projects/frontend/store/project-testimonials.store";

/**
 * The real stores, registered by importing them — the same way they register
 * in the app — then reset the way a session change does. A store that holds
 * an account's data but never registered would keep it across an account
 * switch, which is exactly what this guards.
 */
const ACCOUNT_A_PORTFOLIO: PortfolioEditorDto = {
  id: "portfolio-of-a",
  displayName: "Account A",
  headline: "A's headline",
  bio: null,
  phone: "+1 555 0100",
  publicContactEmail: "a@example.test",
  location: null,
  visibility: "PUBLIC",
  user: { username: "account_a" },
  resumeAsset: null,
};

describe("session change resets account-scoped stores", () => {
  it("clears the Portfolio snapshot and every section store", () => {
    usePortfolioStore.getState().setPortfolio(ACCOUNT_A_PORTFOLIO);
    usePortfolioProfileStore.getState().initialize(ACCOUNT_A_PORTFOLIO);
    usePortfolioProfileStore.getState().setField("headline", "edited by A");
    usePortfolioProjectsStore.setState({
      initializedPortfolioId: "portfolio-of-a",
    });
    usePortfolioTechnologiesStore.setState({
      initializedPortfolioId: "portfolio-of-a",
    });
    usePortfolioTestimonialsStore.setState({
      initializedPortfolioId: "portfolio-of-a",
    });

    resetSessionScopedState();

    expect(usePortfolioStore.getState().portfolio).toBeNull();
    expect(usePortfolioStore.getState().isDeleted).toBe(false);

    const profile = usePortfolioProfileStore.getState();
    expect(profile.initializedPortfolioId).toBeNull();
    expect(profile.form.displayName).toBe("");
    expect(profile.form.headline).toBeNull();
    expect(profile.isDirty()).toBe(false);

    expect(usePortfolioProjectsStore.getState().initializedPortfolioId).toBeNull();
    expect(
      usePortfolioTechnologiesStore.getState().initializedPortfolioId,
    ).toBeNull();
    expect(
      usePortfolioTestimonialsStore.getState().initializedPortfolioId,
    ).toBeNull();
  });

  it("lets the next account initialise from scratch instead of inheriting the previous form", () => {
    usePortfolioProfileStore.getState().initialize(ACCOUNT_A_PORTFOLIO);

    resetSessionScopedState();

    // `initialize` short-circuits when the id matches what it last saw; after
    // a reset it must accept a different account's portfolio.
    usePortfolioProfileStore.getState().initialize({
      ...ACCOUNT_A_PORTFOLIO,
      id: "portfolio-of-b",
      displayName: "Account B",
      headline: null,
      phone: null,
      publicContactEmail: null,
    });

    const form = usePortfolioProfileStore.getState().form;
    expect(form.displayName).toBe("Account B");
    expect(form.phone).toBeNull();
    expect(form.publicContactEmail).toBeNull();
  });

  it("clears the Project section stores too (the pattern is application-wide)", () => {
    useProjectLinksStore.setState({
      links: [{ id: "l1" } as never],
      initializedProjectId: "project-of-a",
    });
    useProjectTechnologiesStore.setState({
      technologies: [{ id: "t1" } as never],
      initializedProjectId: "project-of-a",
    });
    useProjectTestimonialsStore.setState({
      testimonials: [{ id: "x1" } as never],
      initializedProjectId: "project-of-a",
    });

    resetSessionScopedState();

    expect(useProjectLinksStore.getState()).toMatchObject({
      links: [],
      initializedProjectId: null,
    });
    expect(useProjectTechnologiesStore.getState()).toMatchObject({
      technologies: [],
      initializedProjectId: null,
    });
    expect(useProjectTestimonialsStore.getState()).toMatchObject({
      testimonials: [],
      initializedProjectId: null,
    });
  });
});
