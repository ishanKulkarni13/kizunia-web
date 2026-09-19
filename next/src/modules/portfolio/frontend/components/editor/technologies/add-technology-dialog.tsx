"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getInitials } from "@/utils/utils";
import { ApiError } from "@/lib/http";
import { TechnologyApi } from "@/modules/technologies/api/technology-api";
import type { TechnologyCatalogDTO } from "@/modules/technologies/backend/dto/technology-catalog.dto";

import type { AddPortfolioTechnologyInput } from "../../../../schemas/portfolio-technology.schema";

interface AddTechnologyDialogProps {
  /** Technology ids already attached to the portfolio, so they can be
   * excluded from the picker — client-side presentation only. The server
   * independently rejects a duplicate via the relationship's composite
   * primary key. */
  excludedTechnologyIds: string[];

  busy: boolean;

  onAdd: (dto: AddPortfolioTechnologyInput) => Promise<void>;
}

/**
 * Reuses `TechnologyApi.getCatalog()` — the same authenticated, always-
 * active-only catalog every attach picker in the app uses — rather than a
 * new discovery endpoint. The server independently re-validates that the
 * chosen Technology still exists and is not soft-deleted on submit; this
 * picker is a convenience, never an authorization boundary.
 */
export function AddTechnologyDialog({
  excludedTechnologyIds,
  busy,
  onAdd,
}: AddTechnologyDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <Plus />
          Add technology
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        {/* Mounted only while open, so search/selection state always starts
         * fresh rather than being reset via an effect. */}
        {open && (
          <AddTechnologyDialogBody
            excludedTechnologyIds={excludedTechnologyIds}
            busy={busy}
            onAdd={async (dto) => {
              await onAdd(dto);
              setOpen(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddTechnologyDialogBody({
  excludedTechnologyIds,
  busy,
  onAdd,
}: {
  excludedTechnologyIds: string[];
  busy: boolean;
  onAdd: (dto: AddPortfolioTechnologyInput) => Promise<void>;
}) {
  const [search, setSearch] = useState("");

  const [items, setItems] = useState<TechnologyCatalogDTO[]>([]);

  const [isLoading, setIsLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<TechnologyCatalogDTO | null>(null);

  const [startedUsingAt, setStartedUsingAt] = useState("");

  const [description, setDescription] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const catalog = await TechnologyApi.getCatalog();

        if (!cancelled) {
          setItems(catalog);
          setIsLoading(false);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(
            fetchError instanceof ApiError
              ? fetchError.message
              : "Failed to load technologies.",
          );
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const excluded = new Set(excludedTechnologyIds);

  const query = search.trim().toLowerCase();

  const eligible = items.filter(
    (technology) =>
      !excluded.has(technology.id) &&
      (query === "" || technology.name.toLowerCase().includes(query)),
  );

  async function handleAdd() {
    if (!selected) {
      return;
    }

    await onAdd({
      technologyId: selected.id,
      startedUsingAt: startedUsingAt ? new Date(startedUsingAt) : null,
      description: description.trim() || null,
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a technology</DialogTitle>

        <DialogDescription>
          Choose a technology to showcase as part of your professional
          profile.
        </DialogDescription>
      </DialogHeader>

      {selected ? (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <Avatar className="size-9 shrink-0">
              <AvatarImage
                src={selected.iconAsset?.secureUrl}
                alt={selected.name}
              />
              <AvatarFallback>{getInitials(selected.name)}</AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{selected.name}</p>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Change
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="technology-started-using-at">
              Started using (optional)
            </Label>

            <Input
              id="technology-started-using-at"
              type="date"
              value={startedUsingAt}
              disabled={busy}
              onChange={(event) => setStartedUsingAt(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="technology-description">
              Description (optional)
            </Label>

            <Textarea
              id="technology-description"
              value={description}
              disabled={busy}
              rows={3}
              placeholder="How do you use this technology?"
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>
      ) : (
        <>
          <Input
            placeholder="Search technologies..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((key) => (
                  <div
                    key={key}
                    className="h-14 animate-pulse rounded-md bg-muted"
                  />
                ))}
              </div>
            ) : error ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </p>
            ) : eligible.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {items.length === 0
                  ? "No technologies are available yet."
                  : "All matching technologies are already in your portfolio."}
              </p>
            ) : (
              <div className="space-y-2">
                {eligible.map((technology) => (
                  <button
                    key={technology.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setSelected(technology)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50",
                    )}
                  >
                    <Avatar className="size-9 shrink-0">
                      <AvatarImage
                        src={technology.iconAsset?.secureUrl}
                        alt={technology.name}
                      />
                      <AvatarFallback>
                        {getInitials(technology.name)}
                      </AvatarFallback>
                    </Avatar>

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {technology.name}
                      </p>
                    </div>

                    <Badge variant="secondary" className="shrink-0">
                      {technology.type}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {selected && (
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setSelected(null)}
          >
            Back
          </Button>

          <Button type="button" disabled={busy} onClick={() => void handleAdd()}>
            {busy ? "Adding..." : "Add technology"}
          </Button>
        </DialogFooter>
      )}
    </>
  );
}
