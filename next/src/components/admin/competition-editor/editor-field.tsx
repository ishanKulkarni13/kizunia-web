"use client";

import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import type { FieldStatus } from "@/modules/competitions/editor/field-status";
import type { SummaryFieldKey } from "@/modules/competitions/editor/field-metadata";
import { getFieldAnchorId } from "@/modules/competitions/editor/field-metadata";
import { FieldStatusBadge } from "./field-status-badge";

interface EditorFieldProps {
  label: string;
  htmlFor?: string;
  /** The `FIELD_METADATA` key this field corresponds to, used only to give
   * the wrapper a stable scroll/focus anchor id for the Summary tab's
   * "Not specified" links (`getFieldAnchorId`). Omit for fields with no
   * `FIELD_METADATA` entry. */
  fieldKey?: SummaryFieldKey;
  /** Omit for fields that don't participate in the NULL/UNSAVED/DONE system
   * (e.g. a read-only panel). */
  status?: FieldStatus;
  /** A validation error message — conceptually separate from `status`. A
   * field can be `UNSAVED` and simultaneously carry a validation error;
   * neither state implies the other. */
  error?: string;
  description?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Standard field wrapper for the competition editor: label + status badge
 * on one row, the control, then an optional description and/or validation
 * error. Keeps the same `space-y-2` rhythm the tabs already use, so
 * adopting this doesn't change vertical density on its own.
 */
export function EditorField({
  label,
  htmlFor,
  fieldKey,
  status,
  error,
  description,
  className,
  children,
}: EditorFieldProps) {
  return (
    <div
      id={fieldKey ? getFieldAnchorId(fieldKey) : undefined}
      className={cn("space-y-2", className)}
      data-invalid={Boolean(error)}
    >
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </Label>
        {status && <FieldStatusBadge status={status} />}
      </div>
      {children}
      {description}
      {error ? <FieldError errors={[{ message: error }]} /> : null}
    </div>
  );
}
