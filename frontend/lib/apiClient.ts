import type {
  ConfigDefaults,
  Counts,
  CreateCampaignInput,
  CreateCampaignResult,
  EmailMessage,
  PaginatedEmails,
  ParseLeadsResult,
  Sender,
  User,
} from "./types";

export class ApiError extends Error {
  status: number;
  issues?: unknown;

  constructor(status: number, message: string, issues?: unknown) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "include",
      ...init,
      headers: {
        ...(init?.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Is the backend running?");
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let issues: unknown;
    try {
      const data = await res.json();
      if (typeof data?.error === "string") message = data.error;
      issues = data?.issues;
    } catch {
      // non-JSON error body
    }
    if (res.status === 401) message = "Unauthorized";
    throw new ApiError(res.status, message, issues);
  }

  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<User>("/api/me"),
  senders: () => request<Sender[]>("/api/senders"),
  configDefaults: () => request<ConfigDefaults>("/api/config/defaults"),
  counts: () => request<Counts>("/api/emails/counts"),
  scheduled: (page = 1, pageSize = 20, opts?: { search?: string; status?: string }) => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (opts?.search) params.set("search", opts.search);
    if (opts?.status) params.set("status", opts.status);
    return request<PaginatedEmails>(`/api/emails/scheduled?${params}`);
  },
  sent: (page = 1, pageSize = 20, opts?: { search?: string; status?: string }) => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (opts?.search) params.set("search", opts.search);
    if (opts?.status) params.set("status", opts.status);
    return request<PaginatedEmails>(`/api/emails/sent?${params}`);
  },
  parseLeads: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<ParseLeadsResult>("/api/leads/parse", { method: "POST", body: form });
  },
  createCampaign: (input: CreateCampaignInput) =>
    request<CreateCampaignResult>("/api/campaigns", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  cancelEmail: (id: string) =>
    request<{ ok: boolean; id: string }>(`/api/emails/${id}`, {
      method: "DELETE",
    }),
  logout: () =>
    request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
};

export function loginUrl() {
  return "/auth/google";
}
