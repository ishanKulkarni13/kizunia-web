"use client";

import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EditorField } from "./editor-field";
import { useFieldStatus } from "./use-field-status";

type TeamSizeMode = "unspecified" | "solo" | "exact" | "range";

/**
 * Derives the mode from the two stored values rather than storing it
 * itself — there is no fifth state to desync, and `(min=1, max=1)` is
 * genuinely the same data whether the admin thinks of it as "solo" or "an
 * exact size of one", so showing it as Solo is correct rather than a loss
 * of information.
 */
function deriveMode(min: number | null, max: number | null): TeamSizeMode {
  if (min == null && max == null) return "unspecified";
  if (min === 1 && max === 1) return "solo";
  if (min != null && max != null && min === max) return "exact";
  return "range";
}

export function TeamSizeField({
  minTeamSize,
  maxTeamSize,
  onChange,
}: {
  minTeamSize: number | null;
  maxTeamSize: number | null;
  onChange: (next: { minTeamSize: number | null; maxTeamSize: number | null }) => void;
}) {
  const minStatus = useFieldStatus("minTeamSize");
  const maxStatus = useFieldStatus("maxTeamSize");

  const mode = deriveMode(minTeamSize, maxTeamSize);

  function selectMode(next: string) {
    if (!next) return; // ToggleGroup fires "" when deselecting; ignore.

    switch (next as TeamSizeMode) {
      case "unspecified":
        onChange({ minTeamSize: null, maxTeamSize: null });
        return;
      case "solo":
        onChange({ minTeamSize: 1, maxTeamSize: 1 });
        return;
      case "exact": {
        // `(1,1)` always displays as Solo (see `deriveMode`), so seeding
        // Exact with 1 from Unspecified/Solo would make the toggle snap
        // straight back to Solo and look unresponsive. Reuse an existing
        // exact value if there is one; otherwise seed with a value that
        // can't collide with Solo.
        const size =
          minTeamSize != null &&
          maxTeamSize != null &&
          minTeamSize === maxTeamSize &&
          minTeamSize !== 1
            ? minTeamSize
            : 2;
        onChange({ minTeamSize: size, maxTeamSize: size });
        return;
      }
      case "range": {
        // Same collision: from Solo, `maxTeamSize` is already non-null
        // (1), so `?? null` wouldn't apply and the pair would stay (1,1),
        // which `deriveMode` reads back as Solo. Force a genuinely
        // different min/max pair whenever the current values don't
        // already form a valid range.
        const nextMin = minTeamSize ?? 1;
        const nextMax =
          maxTeamSize != null && maxTeamSize !== nextMin
            ? maxTeamSize
            : nextMin + 1;
        onChange({ minTeamSize: nextMin, maxTeamSize: nextMax });
        return;
      }
    }
  }

  const belowMin =
    mode === "range" &&
    minTeamSize != null &&
    maxTeamSize != null &&
    minTeamSize > maxTeamSize;

  return (
    <div id="field-teamSize" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Team Size</span>
      </div>

      <ToggleGroup
        type="single"
        variant="outline"
        value={mode}
        onValueChange={selectMode}
        className="w-full"
      >
        <ToggleGroupItem value="unspecified" className="flex-1">
          Not specified
        </ToggleGroupItem>
        <ToggleGroupItem value="solo" className="flex-1">
          Solo
        </ToggleGroupItem>
        <ToggleGroupItem value="exact" className="flex-1">
          Exact
        </ToggleGroupItem>
        <ToggleGroupItem value="range" className="flex-1">
          Range
        </ToggleGroupItem>
      </ToggleGroup>

      {mode === "exact" && (
        <EditorField label="Team Size" htmlFor="teamSizeExact" status={minStatus}>
          <Input
            id="teamSizeExact"
            type="number"
            min={1}
            value={minTeamSize ?? ""}
            onChange={(e) => {
              const size = e.target.value === "" ? null : Number(e.target.value);
              onChange({ minTeamSize: size, maxTeamSize: size });
            }}
          />
        </EditorField>
      )}

      {mode === "range" && (
        <div className="grid grid-cols-2 gap-4">
          <EditorField label="Min" htmlFor="minTeamSize" status={minStatus}>
            <Input
              id="minTeamSize"
              type="number"
              min={1}
              value={minTeamSize ?? ""}
              onChange={(e) =>
                onChange({
                  minTeamSize: e.target.value === "" ? null : Number(e.target.value),
                  maxTeamSize,
                })
              }
            />
          </EditorField>

          <EditorField
            label="Max"
            htmlFor="maxTeamSize"
            status={maxStatus}
            error={
              belowMin
                ? "Maximum team size must be greater than or equal to the minimum."
                : undefined
            }
          >
            <Input
              id="maxTeamSize"
              type="number"
              min={1}
              value={maxTeamSize ?? ""}
              onChange={(e) =>
                onChange({
                  minTeamSize,
                  maxTeamSize: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </EditorField>
        </div>
      )}
    </div>
  );
}
