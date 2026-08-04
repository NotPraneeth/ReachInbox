import type { HTMLAttributes } from "react";

type Tone = "amber" | "gray" | "green" | "red" | "blue";

const tones: Record<Tone, string> = {
  amber: "bg-amber-100 text-amber-700",
  gray: "bg-chrome-100 text-chrome-600",
  green: "bg-primary-100 text-primary-700",
  red: "bg-red-100 text-red-700",
  blue: "bg-blue-100 text-blue-700",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = "gray", className = "", children, ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
