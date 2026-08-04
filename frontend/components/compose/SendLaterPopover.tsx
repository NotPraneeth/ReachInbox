"use client";

import { CalendarClock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatAbsoluteDate } from "@/lib/format";

interface SendLaterPopoverProps {
  value: Date;
  onChange: (date: Date) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function quickPicks(now: Date): { label: string; date: Date }[] {
  const picks: { label: string; date: Date }[] = [
    { label: "In 5 minutes", date: new Date(now.getTime() + 5 * 60_000) },
    { label: "In 1 hour", date: new Date(now.getTime() + 60 * 60_000) },
    { label: "In 6 hours", date: new Date(now.getTime() + 6 * 60 * 60_000) },
  ];

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  picks.push({ label: "Tomorrow 9:00 AM", date: tomorrow });

  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);
  nextWeek.setHours(9, 0, 0, 0);
  picks.push({ label: "Next week 9:00 AM", date: nextWeek });

  return picks;
}

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function SendLaterPopover({
  value,
  onChange,
  open,
  onOpenChange,
}: SendLaterPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [picks] = useState(() => quickPicks(new Date()));

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [onOpenChange]);

  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" onClick={() => onOpenChange(!open)}>
        <CalendarClock className="h-4 w-4" />
        {formatAbsoluteDate(value.toISOString())}
      </Button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-chrome-200 bg-white p-3 shadow-lg">
          <p className="mb-2 text-xs font-medium text-chrome-500">Send later</p>
          <div className="mb-2 flex flex-col gap-1">
            {picks.map((pick) => (
              <button
                key={pick.label}
                type="button"
                onClick={() => {
                  onChange(pick.date);
                  onOpenChange(false);
                }}
                className="rounded-lg px-2 py-1.5 text-left text-sm text-chrome-700 hover:bg-chrome-100"
              >
                {pick.label}
              </button>
            ))}
          </div>
          <input
            type="datetime-local"
            value={toLocalInputValue(value)}
            min={toLocalInputValue(new Date())}
            onChange={(e) => {
              const next = new Date(e.target.value);
              if (!Number.isNaN(next.getTime())) onChange(next);
            }}
            className="w-full rounded-lg border border-chrome-300 px-2 py-1.5 text-sm focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-primary-500"
          />
        </div>
      )}
    </div>
  );
}
