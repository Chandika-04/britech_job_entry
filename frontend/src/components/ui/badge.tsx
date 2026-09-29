import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-px text-[10.5px] font-semibold uppercase leading-4 tracking-[0.06em]",
  {
    variants: {
      variant: {
        pending: "border-accent/25 bg-accent-soft text-accent",
        extracted: "border-emerald-200 bg-emerald-50 text-emerald-800",
        failed: "border-red-200 bg-red-50 text-red-700",
        unreviewed: "border-amber-200 bg-amber-50 text-amber-800",
        confirmed: "border-emerald-200 bg-emerald-50 text-emerald-800",
        ready: "border-accent/25 bg-accent-soft text-accent",
        creating: "border-indigo-200 bg-indigo-50 text-indigo-700",
        created: "border-emerald-200 bg-emerald-50 text-emerald-800",
        skipped: "border-rule bg-head text-muted",
        warning: "border-amber-200 bg-amber-50 text-amber-800",
        stale: "border-orange-200 bg-orange-50 text-orange-800",
        muted: "border-rule bg-head text-muted",
      },
    },
    defaultVariants: {
      variant: "muted",
    },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
