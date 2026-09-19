"use client";

/**
 * Search Core (React) - Boolean flag
 *
 * A switch rather than a checkbox, because the two states are "narrow to
 * these" and "do not narrow" — an on/off setting rather than an item selected
 * from a set. There is no third state: a boolean filter cannot request
 * `false`, so the switch is never indeterminate.
 */

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import type { BooleanSpec } from "../../spec";
import type { FilterControlProps } from "./types";

export function BooleanControl({
  spec,
  value,
  onChange,
  disabled,
}: FilterControlProps<BooleanSpec>) {
  const id = `filter-${spec.key}`;

  return (
    <div className="flex items-start justify-between gap-3">
      <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
        {spec.label}

        {spec.description && (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {spec.description}
          </span>
        )}
      </Label>

      <Switch
        id={id}
        checked={value === true}
        disabled={disabled}
        onCheckedChange={(checked) => onChange(checked ? true : undefined)}
      />
    </div>
  );
}
