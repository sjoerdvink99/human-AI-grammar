import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/cx";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "border-accent bg-accent text-white hover:bg-[#1a4fae]",
  secondary: "border-line-strong bg-white text-ink hover:bg-wash",
  ghost: "border-transparent text-muted hover:bg-wash hover:text-ink",
  danger: "border-line-strong bg-white text-danger hover:bg-[#fdf3f2]",
};

export function buttonClass(variant: Variant = "secondary", className?: string): string {
  return cx(
    "inline-flex h-8 items-center gap-1.5 rounded border px-3 text-[13px] font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    className,
  );
}

export function Button({
  variant,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}
