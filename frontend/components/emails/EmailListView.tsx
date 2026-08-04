"use client";

import { RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  EmailRow,
  EmailRowSkeleton,
  EmptyState,
} from "@/components/emails/EmailRow";
import { Button } from "@/components/ui/Button";
import { useEmails } from "@/lib/hooks/useEmails";
import type { EmailMessage, MessageStatus } from "@/lib/types";

const statusOptions: Record<string, string> = {
  scheduled: "All",
  PENDING: "Scheduled",
  PROCESSING: "Sending",
  sent: "All",
  SENT: "Sent",
  FAILED: "Failed",
};

export function EmailListView({
  kind,
  title,
}: {
  kind: "scheduled" | "sent";
  title: string;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const pageSize = 20;

  const opts = useMemo(
    () => ({
      search: search || undefined,
      status: statusFilter || undefined,
    }),
    [search, statusFilter],
  );

  const { items, total, totalPages, loading, reload } = useEmails(
    kind,
    page,
    pageSize,
    opts,
  );

  const handleCancelled = useCallback(
    (_id: string) => {
      void reload();
    },
    [reload],
  );

  const statusKeys =
    kind === "scheduled"
      ? ["", "PENDING", "PROCESSING"]
      : ["", "SENT", "FAILED"];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-chrome-900">{title}</h1>
        {!loading && total > 0 && (
          <span className="text-sm text-chrome-400">
            {total} {total === 1 ? "email" : "emails"}
          </span>
        )}
      </div>

      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-chrome-400" />
          <input
            type="text"
            placeholder="Search by recipient or subject…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-lg border border-chrome-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-chrome-400 focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-primary-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-chrome-300 bg-white px-3 py-2 text-sm focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-primary-500"
        >
          {statusKeys.map((key) => (
            <option key={key} value={key}>
              {statusOptions[key] || "All"}
            </option>
          ))}
        </select>
        <Button variant="ghost" size="sm" onClick={() => reload()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2">
        {loading && items.length === 0 ? (
          <>
            <EmailRowSkeleton />
            <EmailRowSkeleton />
            <EmailRowSkeleton />
          </>
        ) : items.length === 0 ? (
          <EmptyState kind={kind} />
        ) : (
          items.map((email: EmailMessage) => (
            <EmailRow key={email.id} email={email} onCancelled={handleCancelled} />
          ))
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-sm text-chrome-400">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
