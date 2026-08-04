"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/apiClient";
import type { User } from "@/lib/types";

interface AuthState {
  user: User | null;
  loading: boolean;
}

export function useAuth() {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((user) => {
        if (!cancelled) setState({ user, loading: false });
      })
      .catch((e: ApiError) => {
        if (cancelled) return;
        if (e.status === 401) router.replace("/login");
        else setState({ user: null, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return state;
}
