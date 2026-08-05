"use client";

import { format } from "@/lib/format";
import { CalendarX2, ExternalLink, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/emails/StatusBadge";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/apiClient";
import type { EmailMessage } from "@/lib/types";

interface EmailRowProps {
  email: EmailMessage;
  onCancelled: (id: string) => void;
}

export function EmailRow({ email, onCancelled }: EmailRowProps) {
  const [cancelling, setCancelling] = useState(false);

  const cancel = async () => {
    setCancelling(true);
    try {
      await api.cancelEmail(email.id);
      toast.success("Email cancelled");
      onCancelled(email.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="flex items-center gap-4 rounded-xl border border-chrome-200 bg-white px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-chrome-800">{email.recipientEmail}</p>
        <p className="truncate text-xs text-chrome-500">{email.subject}</p>
      </div>
      <div className="hidden shrink-0 flex-col text-right text-xs text-chrome-400 md:flex">
        <span>{email.senderName}</span>
        <span>{format.relative(email.scheduledAt)}</span>
      </div>
      <StatusBadge status={email.status} />
      {email.status === "SENT" && email.testMessageUrl && (
        <a
          href={email.testMessageUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="View email in Ethereal"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-chrome-400 hover:bg-chrome-100 hover:text-chrome-600 transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
      {email.status === "PENDING" && (
        <Button
          variant="ghost"
          size="sm"
          loading={cancelling}
          onClick={cancel}
          aria-label="Cancel scheduled email"
        >
          <Trash2 className="h-3.5 w-3.5 text-chrome-400" />
        </Button>
      )}
    </div>
  );
}

export function EmailRowSkeleton() {
  return (
    <div className="flex animate-pulse items-center gap-4 rounded-xl border border-chrome-200 bg-white px-4 py-3">
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-1/3 rounded bg-chrome-200" />
        <div className="h-3 w-2/3 rounded bg-chrome-100" />
      </div>
      <div className="h-5 w-20 rounded-full bg-chrome-100" />
    </div>
  );
}

export function EmptyState({ kind }: { kind: "scheduled" | "sent" }) {
  const isScheduled = kind === "scheduled";
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-chrome-300 bg-white px-6 py-16 text-center">
      <CalendarX2 className="h-8 w-8 text-chrome-300" />
      <p className="text-sm font-medium text-chrome-700">
        {isScheduled ? "Nothing scheduled yet" : "No sent emails yet"}
      </p>
      <p className="text-xs text-chrome-400">
        {isScheduled
          ? "Compose a new email to start scheduling."
          : "Sent emails will show up here."}
      </p>
    </div>
  );
}
