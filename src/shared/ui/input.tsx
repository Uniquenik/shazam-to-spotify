import { forwardRef, InputHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-3xl border border-ink/10 bg-white/90 px-4 py-3 text-sm text-ink outline-none transition placeholder:text-ink/40 focus:border-ink/25 focus:ring-4 focus:ring-ink/5",
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = "Input";
