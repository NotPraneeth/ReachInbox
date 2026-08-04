"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CsvUploader } from "@/components/compose/CsvUploader";
import { RecipientChips } from "@/components/compose/RecipientChips";
import { RichTextEditor } from "@/components/compose/RichTextEditor";
import { SendLaterPopover } from "@/components/compose/SendLaterPopover";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { api, ApiError } from "@/lib/apiClient";
import { useConfigDefaults, useSenders } from "@/lib/hooks/useApi";

export function ComposeForm() {
  const router = useRouter();
  const { data: senders, loading: sendersLoading, error: sendersError } = useSenders();
  const { data: defaults, loading: defaultsLoading, error: defaultsError } = useConfigDefaults();

  const [senderId, setSenderId] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [lastParsedCount, setLastParsedCount] = useState(0);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [delaySec, setDelaySec] = useState("");
  const [hourlyLimit, setHourlyLimit] = useState("");
  const [sendAt, setSendAt] = useState<Date>(() => new Date(Date.now() + 5 * 60_000));
  const [sendLaterOpen, setSendLaterOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (senders && senders.length > 0 && !senderId) setSenderId(senders[0].id);
  }, [senders, senderId]);

  useEffect(() => {
    if (defaults) {
      setDelaySec(String(defaults.delayBetweenEmailsSec.default));
      setHourlyLimit(String(defaults.hourlyLimit.default));
    }
  }, [defaults]);

  // Debug logging — open the browser console to diagnose a stuck skeleton.
  useEffect(() => {
    console.group("[ComposeForm] state update");
    console.log("sendersLoading:", sendersLoading, "| senders:", senders, "| sendersError:", sendersError);
    console.log("defaultsLoading:", defaultsLoading, "| defaults:", defaults, "| defaultsError:", defaultsError);
    console.groupEnd();
  }, [sendersLoading, senders, sendersError, defaultsLoading, defaults, defaultsError]);

  const ready = useMemo(
    () => !sendersLoading && !defaultsLoading && senders && senders.length > 0 && defaults,
    [sendersLoading, defaultsLoading, senders, defaults],
  );

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!senderId) next.sender = "Choose a sender";
    if (recipients.length === 0) next.recipients = "Add at least one recipient";
    if (!subject.trim()) next.subject = "Subject is required";
    const bodyText = bodyHtml.replace(/<[^>]*>/g, "").trim();
    if (!bodyText) next.body = "Message body is required";

    const d = Number(delaySec);
    if (!Number.isFinite(d) || d <= 0) next.delay = "Must be a positive number";
    else if (defaults && (d < defaults.delayBetweenEmailsSec.min || d > defaults.delayBetweenEmailsSec.max)) {
      next.delay = `Allowed: ${defaults.delayBetweenEmailsSec.min}–${defaults.delayBetweenEmailsSec.max} seconds`;
    }

    const h = Number(hourlyLimit);
    if (!Number.isFinite(h) || h <= 0) next.hourly = "Must be a positive number";
    else if (defaults && (h < defaults.hourlyLimit.min || h > defaults.hourlyLimit.max)) {
      next.hourly = `Allowed: ${defaults.hourlyLimit.min}–${defaults.hourlyLimit.max} per hour`;
    }

    if (sendAt.getTime() <= Date.now()) next.sendAt = "Send time must be in the future";

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate() || !senders) return;
    setSubmitting(true);
    try {
      const result = await api.createCampaign({
        senderId,
        subject: subject.trim(),
        bodyHtml,
        recipients,
        startTime: sendAt.toISOString(),
        delayBetweenEmailsSec: Number(delaySec),
        hourlyLimit: Number(hourlyLimit),
      });
      toast.success(
        `${result.totalRecipients} emails scheduled from ${new Date(
          result.firstScheduledAt,
        ).toLocaleString()}`,
      );
      router.push("/dashboard/scheduled");
    } catch (e) {
      const err = e as ApiError;
      toast.error(err.message || "Failed to schedule campaign");
      if (err.issues && typeof err.issues === "object") {
        const flat = err.issues as Record<string, string[]>;
        setErrors(
          Object.fromEntries(
            Object.entries(flat)
              .filter(([, v]) => Array.isArray(v) && v.length > 0)
              .map(([k, v]) => [k, v[0]]),
          ),
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Show a specific error/empty state instead of an infinite skeleton.
  if (!sendersLoading && !defaultsLoading) {
    const apiError = sendersError ?? defaultsError;
    if (apiError) {
      return (
        <div className="mx-auto max-w-2xl rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <p className="font-semibold">Failed to load compose form</p>
          <p className="mt-1">{apiError.message}</p>
          <p className="mt-3 text-xs text-red-500">
            {apiError.status === 401
              ? "Your session may have expired — try refreshing the page."
              : "Check that the backend API is running on port 4000 and try refreshing."}
          </p>
        </div>
      );
    }
    if (senders && senders.length === 0) {
      return (
        <div className="mx-auto max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <p className="font-semibold">No senders configured</p>
          <p className="mt-1">
            The database has no sender accounts. Run the seed script to create Ethereal test senders:
          </p>
          <pre className="mt-3 rounded-lg bg-amber-100 px-3 py-2 font-mono text-xs">
            cd backend{"\n"}npm run seed
          </pre>
          <p className="mt-3 text-xs text-amber-600">Then refresh this page.</p>
        </div>
      );
    }
  }

  if (!ready) {
    return (
      <div className="mx-auto max-w-2xl animate-pulse space-y-4">
        <div className="h-9 w-1/3 rounded-lg bg-chrome-200" />
        <div className="h-40 rounded-xl bg-chrome-100" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-5 text-2xl font-semibold text-chrome-900">Compose</h1>

      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-chrome-600">From</label>
          <select
            value={senderId}
            onChange={(e) => setSenderId(e.target.value)}
            className={`w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline focus:outline-2 focus:outline-offset-0 ${
              errors.sender ? "border-red-500" : "border-chrome-300"
            }`}
          >
            {senders?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName} &lt;{s.email}&gt;
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-medium text-chrome-600">To</label>
            <CsvUploader
              onParsed={(emails) => {
                setRecipients((r) => [...r, ...emails]);
                setLastParsedCount(emails.length);
              }}
            />
          </div>
          <RecipientChips emails={recipients} onChange={setRecipients} />
          {lastParsedCount > 0 && (
            <p className="mt-1 text-xs text-primary-600">
              {lastParsedCount} email address{lastParsedCount !== 1 ? "es" : ""} detected
            </p>
          )}
          {errors.recipients && <p className="mt-1 text-xs text-red-600">{errors.recipients}</p>}
        </div>

        <Input
          id="subject"
          label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Your subject line"
          error={errors.subject}
        />

        <div>
          <label className="mb-1.5 block text-xs font-medium text-chrome-600">Message</label>
          <RichTextEditor onChange={setBodyHtml} />
          {errors.body && <p className="mt-1 text-xs text-red-600">{errors.body}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input
            id="delay"
            label="Delay between emails (seconds)"
            type="number"
            value={delaySec}
            onChange={(e) => setDelaySec(e.target.value)}
            error={errors.delay}
          />
          <Input
            id="hourlyLimit"
            label="Hourly limit"
            type="number"
            value={hourlyLimit}
            onChange={(e) => setHourlyLimit(e.target.value)}
            error={errors.hourly}
            hint={defaults ? `Max ${defaults.hourlyLimit.max}/hr` : undefined}
          />
        </div>

        {errors.sendAt && <p className="text-xs text-red-600">{errors.sendAt}</p>}

        <div className="flex items-center justify-end gap-2 border-t border-chrome-200 pt-4">
          <SendLaterPopover
            value={sendAt}
            onChange={setSendAt}
            open={sendLaterOpen}
            onOpenChange={setSendLaterOpen}
          />
          <Button
            onClick={submit}
            loading={submitting}
            disabled={submitting}
          >
            <Send className="h-4 w-4" />
            Send now
          </Button>
        </div>
      </div>
    </div>
  );
}
