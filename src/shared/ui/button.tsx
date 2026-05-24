import { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

const variants: Record<NonNullable<Props["variant"]>, string> = {
  primary:
    "bg-ink text-sand hover:bg-ember disabled:bg-ink/50 disabled:text-sand/60",
  secondary:
    "bg-white/70 text-ink ring-1 ring-ink/10 hover:bg-white disabled:text-ink/50",
  ghost: "bg-transparent text-ink hover:bg-ink/5 disabled:text-ink/50",
  danger: "bg-ember text-white hover:bg-ember/90 disabled:bg-ember/50",
};

export function Button({
  className,
  variant = "primary",
  type = "button",
  ...props
}: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-ink/20 disabled:cursor-not-allowed",
        variants[variant],
        className,
      )}
      type={type}
      {...props}
    />
  );
}
