import { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-4xl border border-white/70 bg-white/80 p-6 shadow-panel backdrop-blur",
        className,
      )}
      {...props}
    />
  );
}
