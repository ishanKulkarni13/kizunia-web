"use client";

import { useEffect } from "react";
import { Code2 } from "lucide-react";

import { usePortfolioStore } from "../../../store/portfolio.store";
import { usePortfolioTechnologiesStore } from "../../../store/portfolio-technologies.store";
import { AddTechnologyDialog } from "./add-technology-dialog";
import { PortfolioTechnologyCard } from "./portfolio-technology-card";

export function PortfolioTechnologiesSection() {
  const portfolio = usePortfolioStore((state) => state.portfolio);

  const technologies = usePortfolioTechnologiesStore(
    (state) => state.technologies,
  );
  const isLoading = usePortfolioTechnologiesStore((state) => state.isLoading);
  const busy = usePortfolioTechnologiesStore((state) => state.busy);
  const error = usePortfolioTechnologiesStore((state) => state.error);
  const initialize = usePortfolioTechnologiesStore(
    (state) => state.initialize,
  );
  const addTechnology = usePortfolioTechnologiesStore(
    (state) => state.addTechnology,
  );
  const updateTechnology = usePortfolioTechnologiesStore(
    (state) => state.updateTechnology,
  );
  const removeTechnology = usePortfolioTechnologiesStore(
    (state) => state.removeTechnology,
  );
  const reorderTechnologies = usePortfolioTechnologiesStore(
    (state) => state.reorderTechnologies,
  );

  useEffect(() => {
    if (!portfolio) {
      return;
    }

    void initialize({ portfolioId: portfolio.id });
  }, [portfolio, initialize]);

  if (!portfolio) {
    return (
      <div className="rounded-lg border p-6">
        <p className="text-sm text-muted-foreground">
          Portfolio data is unavailable.
        </p>
      </div>
    );
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;

    if (target < 0 || target >= technologies.length) {
      return;
    }

    const ids = technologies.map((technology) => technology.technologyId);

    [ids[index], ids[target]] = [ids[target], ids[index]];

    void reorderTechnologies(ids);
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Technologies</h2>

          <p className="text-sm text-muted-foreground">
            Curate the technologies you want to present as part of your
            professional profile. This is independent of what your projects
            use — add only what you want to showcase here.
          </p>
        </div>

        <AddTechnologyDialog
          excludedTechnologyIds={technologies.map(
            (technology) => technology.technologyId,
          )}
          busy={busy}
          onAdd={async (dto) => {
            await addTechnology(dto);
          }}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-20 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : technologies.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Code2 className="mx-auto mb-2 h-6 w-6" />
          No technologies added yet.
          <br />
          Add the technologies you want to showcase in your portfolio.
        </div>
      ) : (
        <div className="space-y-3">
          {technologies.map((technology, index) => (
            <PortfolioTechnologyCard
              key={technology.technologyId}
              technology={technology}
              busy={busy}
              canMoveUp={index > 0}
              canMoveDown={index < technologies.length - 1}
              onMoveUp={() => move(index, -1)}
              onMoveDown={() => move(index, 1)}
              onUpdate={(dto) =>
                updateTechnology(technology.technologyId, dto)
              }
              onRemove={() => void removeTechnology(technology.technologyId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
