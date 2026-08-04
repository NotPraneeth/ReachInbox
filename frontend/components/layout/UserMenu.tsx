"use client";

import { Check, ChevronDown, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { api } from "@/lib/apiClient";
import type { User } from "@/lib/types";

export function UserMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await api.logout();
      toast.success("Signed out");
      router.replace("/login");
    } catch {
      toast.error("Failed to sign out");
      setSigningOut(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-white/10"
      >
        <Avatar src={user.avatarUrl} name={user.name} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">{user.name}</span>
          <span className="block truncate text-xs text-chrome-400">{user.email}</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-chrome-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-2 rounded-lg border border-chrome-200 bg-white py-1 shadow-lg">
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-chrome-400">
            <Check className="h-3.5 w-3.5 text-primary-600" />
            Logged in
          </div>
          <button
            onClick={signOut}
            disabled={signingOut}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-chrome-700 hover:bg-chrome-100 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            {signingOut ? "Signing out…" : "Logout"}
          </button>
        </div>
      )}
    </div>
  );
}
