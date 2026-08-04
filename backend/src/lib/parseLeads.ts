import Papa from "papaparse";

export interface ParseLeadsResult {
  validEmails: string[];
  invalidCount: number;
  totalDetected: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isEmailLike(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/**
 * Parses a CSV or plain-text lead list.
 * - `.csv`: looks for a column named `email`/`Email Address` (case-insensitive);
 *   if none exists, falls back to scanning every cell for email-shaped strings.
 * - `.txt`: newline/comma/semicolon separated values.
 * Result is deduped case-insensitively. A count of non-email cells/lines is
 * reported alongside the valid count (Assumption #11).
 */
export function parseLeads(
  filename: string,
  content: string,
): ParseLeadsResult {
  const trimmed = content.trim();
  const isCsv = /\.csv$/i.test(filename);
  const raw: string[] = [];

  if (isCsv) {
    const parsed = Papa.parse<Record<string, string>>(trimmed, {
      header: true,
      skipEmptyLines: true,
    });

    const rows = parsed.data.filter((r) => r && typeof r === "object");
    const headers = parsed.meta.fields ?? [];

    const emailHeader = headers.find((h) =>
      /^(email(\s*address)?|e-mail)$/i.test(h.trim()),
    );

    for (const row of rows) {
      if (emailHeader) {
        const cell = row[emailHeader];
        if (cell) raw.push(cell);
        continue;
      }
      // Fallback: scan all cells for email-shaped strings.
      const values = Object.values(row).filter(
        (v) => v && typeof v === "string",
      );
      if (values.length === 0) {
        raw.push("");
        continue;
      }
      const matched = values.filter((v) => isEmailLike(v));
      raw.push(matched.length > 0 ? matched.join(",") : "");
    }
  } else {
    // Plain text: newline/comma/semicolon separated.
    raw.push(...trimmed.split(/[\n,;]/));
  }

  const seen = new Set<string>();
  const validEmails: string[] = [];
  let invalidCount = 0;

  for (const entry of raw) {
    const value = entry.trim();
    if (!value) continue;
    if (isEmailLike(value)) {
      const key = value.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        validEmails.push(value);
      }
    } else {
      invalidCount += 1;
    }
  }

  return {
    validEmails,
    invalidCount,
    totalDetected: validEmails.length + invalidCount,
  };
}
