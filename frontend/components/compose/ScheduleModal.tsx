"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatAbsoluteDate } from "@/lib/format";

interface ScheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (time: Date) => void;
  submitting?: boolean;
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

export function ScheduleModal({
  open,
  onOpenChange,
  onConfirm,
  submitting = false,
}: ScheduleModalProps) {
  const [time, setTime] = useState<Date>(() => new Date(Date.now() + 5 * 60_000));
  const picks = open ? quickPicks(new Date()) : [];

  const close = () => {
    if (submitting) return;
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Schedule send"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (time.getTime() > Date.now()) onConfirm(time);
            }}
            loading={submitting}
            disabled={time.getTime() <= Date.now()}
          >
            <CalendarClock className="h-4 w-4" />
            Schedule
          </Button>
        </>
      }
    >
      <p className="text-sm text-chrome-600">
        When should this mail be sent? {time.getTime() > Date.now() ? formatAbsoluteDate(time.toISOString()) : "Pick a future time."}
      </p>

      <div className="mt-3 flex flex-col gap-1">
        {picks.map((pick) => (
          <button
            key={pick.label}
            type="button"
            onClick={() => setTime(pick.date)}
            className={`rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-chrome-100 ${
              time.getTime() === pick.date.getTime()
                ? "bg-primary-50 font-medium text-primary-700"
                : "text-chrome-700"
            }`}
          >
            {pick.label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <label className="mb-1.5 block text-xs font-medium text-chrome-600">Custom time</label>
        <input
          type="datetime-local"
          value={toLocalInputValue(time)}
          min={toLocalInputValue(new Date())}
          onChange={(e) => {
            const next = new Date(e.target.value);
            if (!Number.isNaN(next.getTime())) setTime(next);
          }}
          className="w-full rounded-lg border border-chrome-300 px-3 py-2 text-sm text-chrome-800 focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-primary-500"
        />
      </div>
    </Modal>
  );
}