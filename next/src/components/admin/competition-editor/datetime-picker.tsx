"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** `"HH:mm"`, defaulting to midnight when only a date has been picked. */
function timeOf(date: Date | undefined): string {
  if (!date) return "00:00";
  return format(date, "HH:mm");
}

function combine(date: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const next = new Date(date);
  next.setHours(hours || 0, minutes || 0, 0, 0);
  return next;
}

/**
 * Calendar+Popover date/time picker, replacing `DateTimeInput`'s native
 * `type="datetime-local"` control while keeping the exact same external
 * contract (`id`, `value`, `disabled`, `onCommit`) — callers (`schedule-tab`,
 * `locations-tab`) need no changes beyond the import.
 *
 * Local `date`/`time` state, resynced from `value` whenever it changes for
 * a reason other than this component's own edits (e.g. Reset restoring
 * `original`) — the same "controlled but locally buffered" shape the
 * editor's previous native datetime input used, applied to a Date+time
 * pair instead of one packed `datetime-local` string. The resync happens
 * during render (comparing against the last-seen `value`) rather than in
 * an effect, per React's "adjusting state when a prop changes" pattern —
 * calling `setState` synchronously inside an effect body causes an extra
 * render pass for no benefit here.
 */
export function DateTimePicker({
  id,
  value,
  disabled,
  onCommit,
}: {
  id?: string;
  value: string | null;
  disabled?: boolean;
  onCommit: (iso: string | null) => void;
}) {
  const [date, setDate] = useState<Date | undefined>(
    value ? new Date(value) : undefined,
  );
  const [time, setTime] = useState<string>(timeOf(date));
  const [open, setOpen] = useState(false);
  const [lastValue, setLastValue] = useState(value);

  if (value !== lastValue) {
    setLastValue(value);
    const next = value ? new Date(value) : undefined;
    setDate(next);
    setTime(timeOf(next));
  }

  function commit(nextDate: Date | undefined, nextTime: string) {
    if (!nextDate) {
      onCommit(null);
      return;
    }
    onCommit(combine(nextDate, nextTime).toISOString());
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !date && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="size-4" />
          {date ? format(date, "PPP p") : "Pick a date"}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-auto space-y-3 p-3">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(next) => {
            setDate(next);
            commit(next, time);
          }}
        />

        <div className="flex items-center gap-2">
          <Input
            type="time"
            value={time}
            disabled={!date}
            onChange={(e) => {
              setTime(e.target.value);
              if (date) commit(date, e.target.value);
            }}
          />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setDate(undefined);
              onCommit(null);
              setOpen(false);
            }}
          >
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
