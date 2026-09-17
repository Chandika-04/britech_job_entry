import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
  {
    variants: {
      variant: {
        pending: "bg-sky-100 text-sky-800",
        extracted: "bg-emerald-100 text-emerald-800",
        failed: "bg-red-100 text-red-800",
        unreviewed: "bg-amber-100 text-amber-900",
        confirmed: "bg-emerald-100 text-emerald-800",
        warning: "bg-amber-100 text-amber-900",
        stale: "bg-orange-100 text-orange-800",
        muted: "bg-slate-100 text-slate-700",
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
