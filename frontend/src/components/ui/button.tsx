import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-ink hover:bg-accent-hover",
        secondary: "border border-rule bg-head text-ink hover:bg-rule-soft",
        outline: "border border-rule bg-white text-ink hover:border-accent/50 hover:text-accent-text",
        ghost: "text-muted hover:bg-rule-soft hover:text-ink",
        danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50",
      },
      size: {
        default: "h-10 px-3.5 md:h-8",
        lg: "h-11 px-4 text-sm md:h-9",
        sm: "h-9 px-2.5 text-xs md:h-7",
        icon: "h-10 w-10 p-0 md:h-8 md:w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
