import { create } from "zustand";
import { toast } from "sonner";

import { ApiError } from "@/lib/http";
import { ProjectTechnologyApi } from "../api/project-technology-api";
import type { ProjectTechnologyDto } from "../../backend/dto/output";

interface ProjectTechnologiesStore {
  technologies: ProjectTechnologyDto[];

  /** Guards `initialize()` from re-fetching when the shared project
   * snapshot changes for an unrelated reason. */
  initializedProjectId: string | null;

  busy: boolean;

  /**
   * Unlike `useProjectLinksStore.initialize`, this fetches rather than
   * seeding from `project.technologies` on `ProjectDetailsDto` — that field
   * is the lightweight `{id, name, slug}` summary shared with the public
   * details DTO, not the full ordered `ProjectTechnologyDto` (with
   * `displayOrder`/`iconAsset`/`type`) this tab needs to render and reorder.
   */
  initialize: (params: { projectId: string }) => Promise<void>;

  attachTechnology: (params: {
    projectId: string;
    technologyId: string;
  }) => Promise<void>;

  detachTechnology: (params: {
    projectId: string;
    technologyId: string;
  }) => Promise<void>;

  reorderTechnologies: (params: {
    projectId: string;
    ids: string[];
  }) => Promise<void>;
}

/**
 * Technologies persist on every action rather than through the batched
 * Profile / Content save flow: each mutation hits its own endpoint
 * immediately, and on success the store is replaced wholesale with the
 * server-returned, authoritative ordering — never patched locally. Mirrors
 * `useProjectLinksStore`.
 */
export const useProjectTechnologiesStore = create<ProjectTechnologiesStore>(
  (set, get) => ({
    technologies: [],

    initializedProjectId: null,

    busy: false,

    initialize: async ({ projectId }) => {
      if (get().initializedProjectId === projectId) {
        return;
      }

      try {
        set({ busy: true });

        const technologies = await ProjectTechnologyApi.list(projectId);

        set({
          technologies,
          initializedProjectId: projectId,
          busy: false,
        });
      } catch (error) {
        set({ busy: false });

        toast.error(
          error instanceof ApiError ? error.message : "Unexpected error",
        );
      }
    },

    attachTechnology: async ({ projectId, technologyId }) => {
      await run(
        () => ProjectTechnologyApi.attach(projectId, { technologyId }),
        "Technology added.",
      );
    },

    detachTechnology: async ({ projectId, technologyId }) => {
      await run(
        () => ProjectTechnologyApi.detach(projectId, technologyId),
        "Technology removed.",
      );
    },

    reorderTechnologies: async ({ projectId, ids }) => {
      await run(
        () => ProjectTechnologyApi.reorder(projectId, { ids }),
        "Technologies reordered.",
      );
    },
  }),
);

async function run(
  action: () => Promise<ProjectTechnologyDto[]>,
  successMessage: string,
): Promise<void> {
  try {
    useProjectTechnologiesStore.setState({ busy: true });

    const technologies = await action();

    useProjectTechnologiesStore.setState({ technologies, busy: false });

    toast.success(successMessage);
  } catch (error) {
    useProjectTechnologiesStore.setState({ busy: false });

    if (error instanceof ApiError) {
      toast.error(error.message);
    } else {
      toast.error("Unexpected error");
    }
  }
}
