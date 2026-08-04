import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-primary-600 text-white hover:bg-primary-700 focus-visible:outline-primary-600 disabled:bg-chrome-300",
  secondary:
    "bg-white text-chrome-700 border border-chrome-300 hover:bg-chrome-50 focus-visible:outline-chrome-400 disabled:text-chrome-400",
  ghost: "text-chrome-600 hover:bg-chrome-100 focus-visible:outline-chrome-400",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600",
};

const sizes: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-xs rounded-md gap-1.5",
  md: "px-3.5 py-2 text-sm rounded-lg gap-2",
  lg: "px-5 py-2.5 text-sm rounded-lg gap-2",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}
