import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-sm border border-border bg-background px-3 text-sm placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
