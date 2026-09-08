"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The button, as variants rather than one-off class strings.
 *
 * `destructive` uses the reserved `critical` status colour and nothing else
 * does, so a red button always means the same thing.
 */
const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md",
    "text-sm font-medium transition-colors",
    // Focus is visible and never removed — it is the whole keyboard story.
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ),
  {
    variants: {
      variant: {
        primary:
          "bg-brand text-brand-ink hover:bg-brand-hover active:bg-brand-active",
        secondary:
          "bg-surface-2 text-ink hover:bg-surface-3 border border-border",
        outline:
          "border border-border-strong bg-transparent text-ink hover:bg-surface-2",
        ghost:
          "bg-transparent text-ink-secondary hover:bg-surface-2 hover:text-ink",
        destructive:
          "bg-critical text-white hover:brightness-95 active:brightness-90",
        link: "bg-transparent text-brand underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4",
        lg: "h-10 px-6",
        // Square, for a toolbar icon. Kept at 36px so it clears the 24px
        // minimum touch target with room to spare.
        icon: "size-9 p-0",
        "icon-sm": "size-8 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Shows a spinner and blocks input. Use for anything that writes. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant, size, loading, disabled, children, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        // A loading button must not be clickable twice — double-submitting a
        // payroll run or an invoice is a real problem, not a cosmetic one.
        disabled={disabled || loading}
        // Tells a screen reader the control is working rather than broken.
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);

export { buttonVariants };
