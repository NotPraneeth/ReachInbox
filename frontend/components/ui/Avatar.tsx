import { User } from "lucide-react";

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: "sm" | "md";
}

const sizes = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
};

export function Avatar({ src, name, size = "md" }: AvatarProps) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-100 font-semibold text-primary-700 ${sizes[size]}`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      ) : initials ? (
        initials
      ) : (
        <User className="h-1/2 w-1/2" />
      )}
    </div>
  );
}
