"use client";

import { X } from "lucide-react";
import { useMemo, useState } from "react";

const MAX_VISIBLE = 6;

interface RecipientChipsProps {
  emails: string[];
  onChange: (emails: string[]) => void;
}

export function RecipientChips({ emails, onChange }: RecipientChipsProps) {
  const [draft, setDraft] = useState("");

  const visible = useMemo(() => emails.slice(0, MAX_VISIBLE), [emails]);
  const overflow = emails.length - visible.length;

  const addDraft = () => {
    const value = draft.trim().toLowerCase();
    if (!value) return;
    if (emails.includes(value)) {
      setDraft("");
      return;
    }
    onChange([...emails, value]);
    setDraft("");
  };

  const remove = (email: string) => {
    onChange(emails.filter((e) => e !== email));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-chrome-300 bg-white px-3 py-2">
      {visible.map((email) => (
        <span
          key={email}
          className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700"
        >
          {email}
          <button
            type="button"
            onClick={() => remove(email)}
            className="text-primary-500 hover:text-primary-700"
            aria-label={`Remove ${email}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {overflow > 0 && (
        <span className="rounded-full bg-chrome-100 px-2 py-0.5 text-xs font-medium text-chrome-600">
          +{overflow} more
        </span>
      )}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addDraft();
          } else if (e.key === "Backspace" && !draft && emails.length > 0) {
            remove(emails[emails.length - 1]);
          }
        }}
        onBlur={addDraft}
        placeholder={emails.length === 0 ? "Add recipients or upload a CSV…" : ""}
        className="min-w-[10rem] flex-1 border-none bg-transparent text-sm outline-none placeholder:text-chrome-400"
      />
    </div>
  );
}
