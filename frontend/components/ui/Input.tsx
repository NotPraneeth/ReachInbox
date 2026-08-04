import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function Input({ label, hint, error, id, className = "", ...rest }: InputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-chrome-600">
          {label}
        </label>
      )}
      <input
        id={id}
        className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-chrome-800 placeholder:text-chrome-400 focus:outline focus:outline-2 focus:outline-offset-0 disabled:cursor-not-allowed disabled:bg-chrome-100 disabled:text-chrome-500 ${
          error
            ? "border-red-500 focus:outline-red-500"
            : "border-chrome-300 focus:outline-primary-500"
        } ${className}`}
        {...rest}
      />
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-chrome-400">{hint}</p>
      ) : null}
    </div>
  );
}
