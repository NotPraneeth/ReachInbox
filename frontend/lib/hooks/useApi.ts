"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/apiClient";

interface State<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => Promise<void>;
}

export function useApi<T>(fetcher: () => Promise<T>): State<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetcher());
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}

export const useSenders = () => useApi(api.senders);
export const useConfigDefaults = () => useApi(api.configDefaults);
