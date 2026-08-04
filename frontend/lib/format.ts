export function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const min = Math.round(abs / 60_000);
  const hour = Math.round(abs / 3_600_000);
  const day = Math.round(abs / 86_400_000);

  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (diffMs > 0 && min < 60) return `in ${min}m · ${time}`;
  if (diffMs > 0 && hour < 24) return `in ${hour}h · ${time}`;
  if (diffMs > 0 && day < 7) return `in ${day}d · ${time}`;
  if (diffMs <= 0 && min < 60) return `${min}m ago`;
  if (diffMs <= 0 && hour < 24) return `${hour}h ago · ${time}`;

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatAbsoluteDate(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const format = {
  relative: formatRelativeDate,
  absolute: formatAbsoluteDate,
};
