import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-md border border-rule bg-white px-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/15 disabled:bg-head disabled:text-muted md:h-8 md:text-[13px]",
        className,
      )}
      {...props}
    />
  );
}
