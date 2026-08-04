"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/apiClient";
import type { Counts, EmailMessage, PaginatedEmails } from "@/lib/types";

export function useCounts(intervalMs = 15_000) {
  const [counts, setCounts] = useState<Counts>({ scheduledCount: 0, sentCount: 0 });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCounts(await api.counts());
    } catch {
      // keep last known counts when the backend is briefly unavailable
    }
  }, []);

  useEffect(() => {
    void refresh();
    timer.current = setInterval(refresh, intervalMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [refresh, intervalMs]);

  return counts;
}

interface EmailListState {
  items: EmailMessage[];
  total: number;
  totalPages: number;
  loading: boolean;
}

export function useEmails(
  kind: "scheduled" | "sent",
  page: number,
  pageSize = 20,
  opts?: { search?: string; status?: string },
) {
  const [state, setState] = useState<EmailListState>({
    items: [],
    total: 0,
    totalPages: 0,
    loading: true,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const fetcher =
        kind === "scheduled"
          ? () => api.scheduled(page, pageSize, opts)
          : () => api.sent(page, pageSize, opts);
      const data: PaginatedEmails = await fetcher();
      setState({
        items: data.items,
        total: data.total,
        totalPages: data.totalPages,
        loading: false,
      });
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, [kind, page, pageSize, opts]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: load };
}
