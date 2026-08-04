import { MailPlus } from "lucide-react";
import Link from "next/link";
import { GoogleSignIn } from "@/components/auth/GoogleSignIn";
import { Input } from "@/components/ui/Input";

export const metadata = { title: "Sign in · ReachInbox" };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-chrome-900 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-chrome-700 bg-white p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600">
            <MailPlus className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-chrome-900">ReachInbox</h1>
            <p className="text-xs text-chrome-400">Cold outreach, on autopilot</p>
          </div>
        </div>

        <GoogleSignIn />

        <div className="my-5 flex items-center gap-3 text-xs text-chrome-400">
          <span className="h-px flex-1 bg-chrome-200" />
          or
          <span className="h-px flex-1 bg-chrome-200" />
        </div>

        <form className="space-y-4">
          <Input
            id="email"
            label="Email ID"
            type="email"
            placeholder="you@example.com"
            disabled
            hint="Available with Google sign-in"
          />
          <Input
            id="password"
            label="Password"
            type="password"
            placeholder="••••••••"
            disabled
          />
        </form>

        <p className="mt-6 text-center text-xs text-chrome-400">
          Sign in with Google to start sending.
        </p>
        <p className="mt-2 text-center text-[11px] text-chrome-300">
          <Link href="/dashboard/scheduled" className="underline hover:text-chrome-500">
            Preview dashboard (demo)
          </Link>
        </p>
      </div>
    </div>
  );
}
