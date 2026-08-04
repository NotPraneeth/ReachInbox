"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { useAuth } from "@/lib/hooks/useAuth";

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-chrome-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-chrome-300 border-t-primary-600" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} />
      <main className="flex-1 overflow-y-auto px-8 py-6">{children}</main>
    </div>
  );
}
