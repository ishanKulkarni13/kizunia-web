import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RateLimitPolicyId } from "@/lib/rate-limit/policies";

const ACTOR = { id: "user-1", role: "USER", banned: false } as const;

const { enforce, getStrictActor, order, services } = vi.hoisted(() => {
  const order: string[] = [];

  const track = (name: string) =>
    vi.fn(async () => {
      order.push(`service:${name}`);
      return {};
    });

  const services = {
    portfolio: {
      findMine: track("findMine"),
      create: track("create"),
      updateProfile: track("updateProfile"),
      changeVisibility: track("changeVisibility"),
      delete: track("delete"),
      restore: track("restore"),
    },
    project: {
      list: track("listProjects"),
      add: track("addProject"),
      reorder: track("reorderProjects"),
      setFeatured: track("updateProject"),
      remove: track("removeProject"),
    },
    testimonial: {
      list: track("listTestimonials"),
      add: track("addTestimonial"),
      reorder: track("reorderTestimonials"),
      update: track("updateTestimonial"),
      remove: track("removeTestimonial"),
    },
    technology: {
      list: track("listTechnologies"),
      add: track("addTechnology"),
      reorder: track("reorderTechnologies"),
      updateMetadata: track("updateTechnology"),
      remove: track("removeTechnology"),
    },
  };

  return {
    order,
    services,
    enforce: vi.fn(async () => {
      order.push("enforce");
    }),
    getStrictActor: vi.fn(async () => ACTOR),
  };
});

vi.mock("@/lib/rate-limit/service", () => ({
  rateLimitService: { enforce },
}));

vi.mock("@/lib/auth/session", () => ({
  SessionService: { getStrictActor },
}));

vi.mock("./service", () => ({ portfolioService: services.portfolio }));
vi.mock("./portfolio-project.service", () => ({
  portfolioProjectService: services.project,
}));
vi.mock("./portfolio-testimonial.service", () => ({
  portfolioTestimonialService: services.testimonial,
}));
vi.mock("./portfolio-technology.service", () => ({
  portfolioTechnologyService: services.technology,
}));

import { PortfolioController } from "./controller";

function request(method: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/portfolio", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const VISIBILITY = { visibility: "PRIVATE" };
const PROFILE = { displayName: "Ada" };
const PROJECT = { projectId: "project-1" };
const REORDER_PROJECTS = { projectIds: ["project-1"] };
const FEATURED = { featured: true };
const TESTIMONIAL = { name: "Grace", message: "Great" };
const REORDER_TESTIMONIALS = { testimonialIds: ["t-1"] };
const TECHNOLOGY = { technologyId: "tech-1" };
const REORDER_TECHNOLOGIES = { technologyIds: ["tech-1"] };

interface Case {
  name: string;
  policy: RateLimitPolicyId;
  service: string;
  run: () => Promise<Response>;
}

const CASES: Case[] = [
  // Reads
  {
    name: "findMine",
    policy: RateLimitPolicyId.PORTFOLIO_READ_OWN,
    service: "findMine",
    run: () => PortfolioController.findMine(request("GET")),
  },
  {
    name: "listProjects",
    policy: RateLimitPolicyId.PORTFOLIO_READ_OWN,
    service: "listProjects",
    run: () => PortfolioController.listProjects(request("GET")),
  },
  {
    name: "listTestimonials",
    policy: RateLimitPolicyId.PORTFOLIO_READ_OWN,
    service: "listTestimonials",
    run: () => PortfolioController.listTestimonials(request("GET")),
  },
  {
    name: "listTechnologies",
    policy: RateLimitPolicyId.PORTFOLIO_READ_OWN,
    service: "listTechnologies",
    run: () => PortfolioController.listTechnologies(request("GET")),
  },

  // Create / profile / lifecycle
  {
    name: "create",
    policy: RateLimitPolicyId.PORTFOLIO_CREATE,
    service: "create",
    run: () => PortfolioController.create(request("POST")),
  },
  {
    name: "updateProfile",
    policy: RateLimitPolicyId.PORTFOLIO_PROFILE_WRITE,
    service: "updateProfile",
    run: () => PortfolioController.updateProfile(request("PATCH", PROFILE)),
  },
  {
    name: "changeVisibility",
    policy: RateLimitPolicyId.PORTFOLIO_LIFECYCLE_WRITE,
    service: "changeVisibility",
    run: () =>
      PortfolioController.changeVisibility(request("PATCH", VISIBILITY)),
  },
  {
    name: "delete",
    policy: RateLimitPolicyId.PORTFOLIO_LIFECYCLE_WRITE,
    service: "delete",
    run: () => PortfolioController.delete(request("DELETE")),
  },
  {
    name: "restore",
    policy: RateLimitPolicyId.PORTFOLIO_LIFECYCLE_WRITE,
    service: "restore",
    run: () => PortfolioController.restore(request("POST")),
  },

  // Projects
  {
    name: "addProject",
    policy: RateLimitPolicyId.PORTFOLIO_PROJECTS_WRITE,
    service: "addProject",
    run: () => PortfolioController.addProject(request("POST", PROJECT)),
  },
  {
    name: "reorderProjects",
    policy: RateLimitPolicyId.PORTFOLIO_PROJECTS_WRITE,
    service: "reorderProjects",
    run: () =>
      PortfolioController.reorderProjects(request("PATCH", REORDER_PROJECTS)),
  },
  {
    name: "updateProject",
    policy: RateLimitPolicyId.PORTFOLIO_PROJECTS_WRITE,
    service: "updateProject",
    run: () =>
      PortfolioController.updateProject(request("PATCH", FEATURED), "p-1"),
  },
  {
    name: "removeProject",
    policy: RateLimitPolicyId.PORTFOLIO_PROJECTS_WRITE,
    service: "removeProject",
    run: () => PortfolioController.removeProject(request("DELETE"), "p-1"),
  },

  // Testimonials
  {
    name: "addTestimonial",
    policy: RateLimitPolicyId.PORTFOLIO_TESTIMONIALS_WRITE,
    service: "addTestimonial",
    run: () =>
      PortfolioController.addTestimonial(request("POST", TESTIMONIAL)),
  },
  {
    name: "reorderTestimonials",
    policy: RateLimitPolicyId.PORTFOLIO_TESTIMONIALS_WRITE,
    service: "reorderTestimonials",
    run: () =>
      PortfolioController.reorderTestimonials(
        request("PATCH", REORDER_TESTIMONIALS),
      ),
  },
  {
    name: "updateTestimonial",
    policy: RateLimitPolicyId.PORTFOLIO_TESTIMONIALS_WRITE,
    service: "updateTestimonial",
    run: () =>
      PortfolioController.updateTestimonial(
        request("PATCH", { name: "Grace" }),
        "t-1",
      ),
  },
  {
    name: "removeTestimonial",
    policy: RateLimitPolicyId.PORTFOLIO_TESTIMONIALS_WRITE,
    service: "removeTestimonial",
    run: () => PortfolioController.removeTestimonial(request("DELETE"), "t-1"),
  },

  // Technologies
  {
    name: "addTechnology",
    policy: RateLimitPolicyId.PORTFOLIO_TECHNOLOGIES_WRITE,
    service: "addTechnology",
    run: () =>
      PortfolioController.addTechnology(request("POST", TECHNOLOGY)),
  },
  {
    name: "reorderTechnologies",
    policy: RateLimitPolicyId.PORTFOLIO_TECHNOLOGIES_WRITE,
    service: "reorderTechnologies",
    run: () =>
      PortfolioController.reorderTechnologies(
        request("PATCH", REORDER_TECHNOLOGIES),
      ),
  },
  {
    name: "updateTechnology",
    policy: RateLimitPolicyId.PORTFOLIO_TECHNOLOGIES_WRITE,
    service: "updateTechnology",
    run: () =>
      PortfolioController.updateTechnology(
        request("PATCH", { description: "x" }),
        "tech-1",
      ),
  },
  {
    name: "removeTechnology",
    policy: RateLimitPolicyId.PORTFOLIO_TECHNOLOGIES_WRITE,
    service: "removeTechnology",
    run: () =>
      PortfolioController.removeTechnology(request("DELETE"), "tech-1"),
  },
];

beforeEach(() => {
  order.length = 0;
  vi.clearAllMocks();
  enforce.mockImplementation(async () => {
    order.push("enforce");
  });
});

describe("PortfolioController — rate limiting", () => {
  it("covers every authenticated handler", () => {
    // Guards the table itself: a handler added to the controller without a
    // case here (and so without a policy) fails this instead of slipping by.
    const handlers = Object.getOwnPropertyNames(PortfolioController).filter(
      (name) =>
        typeof (PortfolioController as unknown as Record<string, unknown>)[
          name
        ] === "function" && name !== "findPublicByUsername",
    );

    expect(CASES.map((testCase) => testCase.name).sort()).toEqual(
      handlers.sort(),
    );
  });

  it.each(CASES)(
    "$name enforces $policy for the session user, before the service runs",
    async ({ policy, service, run }) => {
      await run();

      expect(enforce).toHaveBeenCalledTimes(1);
      expect(enforce).toHaveBeenCalledWith(
        expect.objectContaining({ policyId: policy, actor: ACTOR }),
      );

      expect(order).toEqual(["enforce", `service:${service}`]);
    },
  );

  it.each(CASES)(
    "$name stops at the limiter: no service call when rate limited",
    async ({ run }) => {
      enforce.mockRejectedValueOnce(new Error("rate limited"));

      await run();

      expect(order).toEqual([]);
    },
  );
});
