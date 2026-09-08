import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Info,
  OctagonAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Status badge.
 *
 * The status variants ship an **icon as well as colour**, and that is not
 * decoration. On the light surface `warning` and `serious` sit below 3:1
 * contrast by design, and a colourblind reader cannot separate the red and
 * amber ones at all — so colour alone would not carry the meaning. The icon
 * plus the label do; the colour is reinforcement.
 *
 * This is also why the status palette is reserved: a badge in these colours
 * always means state, never "category 4".
 */
const badgeVariants = cva(
  cn(
    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5",
    "text-xs font-medium whitespace-nowrap",
    "[&_svg]:size-3 [&_svg]:shrink-0",
  ),
  {
    variants: {
      variant: {
        neutral: "border-border bg-surface-2 text-ink-secondary",
        good: "border-good/30 bg-good/10 text-good-ink dark:text-good",
        warning: "border-warning/40 bg-warning/15 text-ink",
        serious: "border-serious/40 bg-serious/15 text-ink",
        critical: "border-critical/40 bg-critical/15 text-critical",
        info: "border-brand/30 bg-brand/10 text-brand",
        outline: "border-border-strong bg-transparent text-ink-secondary",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

const STATUS_ICON = {
  good: CheckCircle2,
  warning: AlertTriangle,
  serious: CircleAlert,
  critical: OctagonAlert,
  info: Info,
} as const;

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /**
   * Renders the matching status icon. On by default for status variants,
   * because a status badge without one is colour-alone.
   */
  icon?: boolean;
}

export function Badge({
  className,
  variant = "neutral",
  icon,
  children,
  ...props
}: BadgeProps) {
  const Icon =
    variant && variant in STATUS_ICON
      ? STATUS_ICON[variant as keyof typeof STATUS_ICON]
      : null;

  const showIcon = icon ?? Icon !== null;

  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {showIcon && Icon ? <Icon aria-hidden /> : null}
      {children}
    </span>
  );
}

/** Maps an API severity to a badge variant, so the mapping lives in one place. */
export function severityVariant(
  severity: string | null | undefined,
): BadgeProps["variant"] {
  switch (severity) {
    case "critical":
      return "critical";
    case "high":
    case "serious":
      return "serious";
    case "medium":
    case "moderate":
    case "warning":
      return "warning";
    case "low":
    case "info":
      return "info";
    default:
      return "neutral";
  }
}

export { badgeVariants };
