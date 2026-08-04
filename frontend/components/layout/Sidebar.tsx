"use client";

import { Inbox, MailPlus, Send } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { UserMenu } from "@/components/layout/UserMenu";
import { Button } from "@/components/ui/Button";
import { useCounts } from "@/lib/hooks/useEmails";
import type { User } from "@/lib/types";

const nav = [
  { href: "/dashboard/scheduled", label: "Scheduled", icon: Inbox, countKey: "scheduledCount" as const },
  { href: "/dashboard/sent", label: "Sent", icon: Send, countKey: "sentCount" as const },
];

export function Sidebar({ user }: { user: User }) {
  const pathname = usePathname();
  const router = useRouter();
  const counts = useCounts();

  return (
    <aside className="flex w-64 shrink-0 flex-col bg-chrome-900 text-white">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600">
          <MailPlus className="h-4.5 w-4.5 text-white" />
        </div>
        <span className="text-lg font-semibold">ReachInbox</span>
      </div>

      <div className="px-3 pb-2">
        <Button
          className="w-full"
          onClick={() => router.push("/dashboard/compose")}
        >
          <MailPlus className="h-4 w-4" />
          Compose
        </Button>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {nav.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-primary-600 text-white"
                  : "text-chrome-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {counts[item.countKey] > 0 && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    active ? "bg-white/20 text-white" : "bg-chrome-700 text-chrome-300"
                  }`}
                >
                  {counts[item.countKey]}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-2">
        <UserMenu user={user} />
      </div>
    </aside>
  );
}
