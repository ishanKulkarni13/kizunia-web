"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * A text input that commits on blur but stays controlled, so it correctly
 * reflects a value that changed for a reason other than the user's own
 * typing — most importantly the server's echoed value landing after a
 * successful save. Plain `defaultValue`+`onBlur` (this tab's original
 * pattern) never resyncs after the first mount.
 */
export function BufferedTextInput({
  id,
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  id?: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  /** Called on blur with the trimmed value, or null if it trims to empty. */
  onCommit: (value: string | null) => void;
}) {
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  return (
    <Input
      id={id}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => setText(event.target.value)}
      onBlur={(event) => onCommit(event.target.value.trim() || null)}
    />
  );
}
