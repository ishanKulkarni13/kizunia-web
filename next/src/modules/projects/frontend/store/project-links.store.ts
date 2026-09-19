import { create } from "zustand";
import { toast } from "sonner";

import { ApiError } from "@/lib/http";
import { ProjectLinkApi } from "../api/project-link-api";
import type { ProjectLinkDto } from "../../backend/dto/output";
import type {
  CreateProjectLinkInput,
  UpdateProjectLinkInput,
} from "../../schemas/project-link.schema";

interface ProjectLinksStore {
  links: ProjectLinkDto[];

  /** Guards `initialize()` from clobbering an in-progress list when the
   * shared project snapshot changes for an unrelated reason. */
  initializedProjectId: string | null;

  busy: boolean;

  initialize: (params: { projectId: string; links: ProjectLinkDto[] }) => void;

  createLink: (params: {
    projectId: string;
    dto: CreateProjectLinkInput;
  }) => Promise<void>;

  updateLink: (params: {
    projectId: string;
    linkId: string;
    dto: UpdateProjectLinkInput;
  }) => Promise<void>;

  deleteLink: (params: { projectId: string; linkId: string }) => Promise<void>;

  reorderLinks: (params: { projectId: string; ids: string[] }) => Promise<void>;
}

/**
 * Links persist on every action rather than through the batched Profile /
 * Content save flow: each mutation hits its own endpoint immediately, and on
 * success the store is replaced wholesale with the server-returned,
 * authoritative ordering — never patched locally. Mirrors Competition
 * Locations' `setLocations`.
 */
export const useProjectLinksStore = create<ProjectLinksStore>((set, get) => ({
  links: [],

  initializedProjectId: null,

  busy: false,

  initialize: ({ projectId, links }) => {
    if (get().initializedProjectId === projectId) {
      return;
    }

    set({
      links,
      initializedProjectId: projectId,
    });
  },

  createLink: async ({ projectId, dto }) => {
    await run(
      () => ProjectLinkApi.create(projectId, dto),
      "Link added.",
    );
  },

  updateLink: async ({ projectId, linkId, dto }) => {
    await run(
      () => ProjectLinkApi.update(projectId, linkId, dto),
      "Link updated.",
    );
  },

  deleteLink: async ({ projectId, linkId }) => {
    await run(
      () => ProjectLinkApi.delete(projectId, linkId),
      "Link removed.",
    );
  },

  reorderLinks: async ({ projectId, ids }) => {
    await run(
      () => ProjectLinkApi.reorder(projectId, { ids }),
      "Links reordered.",
    );
  },
}));

async function run(
  action: () => Promise<ProjectLinkDto[]>,
  successMessage: string,
): Promise<void> {
  try {
    useProjectLinksStore.setState({ busy: true });

    const links = await action();

    useProjectLinksStore.setState({ links, busy: false });

    toast.success(successMessage);
  } catch (error) {
    useProjectLinksStore.setState({ busy: false });

    if (error instanceof ApiError) {
      toast.error(error.message);
    } else {
      toast.error("Unexpected error");
    }
  }
}
