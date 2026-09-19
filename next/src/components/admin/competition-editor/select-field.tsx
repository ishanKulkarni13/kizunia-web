"use client";

import { useId } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { FieldStatusBadge } from "./field-status-badge";
import type { FieldStatus } from "@/modules/competitions/editor/field-status";
import type { SummaryFieldKey } from "@/modules/competitions/editor/field-metadata";
import { getFieldAnchorId } from "@/modules/competitions/editor/field-metadata";

interface Option {
  value: string;
  label: string;
}

interface SelectFieldProps {
  label: string;

  value: string | null | undefined;

  placeholder?: string;

  options: readonly Option[];

  /** When true, renders a leading "Not specified" item that maps to
   * `null` — the only way Radix's `Select` can represent "no value" is
   * through a sentinel, since `SelectItem value=""` is reserved for
   * clearing the control entirely. Omit for non-nullable fields
   * (`visibility`), where there is no valid "unset" state. */
  nullable?: boolean;

  /** The `FIELD_METADATA` key this select corresponds to — gives the
   * wrapper a stable scroll/focus anchor id for the Summary tab's "Not
   * specified" links. Omit for fields with no `FIELD_METADATA` entry. */
  fieldKey?: SummaryFieldKey;

  status?: FieldStatus;

  onValueChange(value: string | null): void;
}

/** Radix reserves an empty string for "no selection"; this sentinel stands
 * in for an explicit, persisted `null` and is translated back at the
 * callback boundary — it never leaks past this component. */
const NOT_SET = "__not_set__";

export function SelectField({
  label,
  value,
  placeholder,
  options,
  nullable = false,
  fieldKey,
  status,
  onValueChange,
}: SelectFieldProps) {
  const id = useId();

  return (
    <div
      id={fieldKey ? getFieldAnchorId(fieldKey) : undefined}
      className="space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {status && <FieldStatusBadge status={status} />}
      </div>

      <Select
        value={value ?? (nullable ? NOT_SET : "")}
        onValueChange={(next) =>
          onValueChange(next === NOT_SET ? null : next)
        }
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder ?? `Select ${label}`} />
        </SelectTrigger>

        <SelectContent>
          {nullable && (
            <SelectItem value={NOT_SET}>
              <span className="text-muted-foreground">Not specified</span>
            </SelectItem>
          )}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
