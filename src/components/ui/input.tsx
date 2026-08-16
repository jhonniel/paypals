import * as React from "react";
import { cn } from "@/utils/cn";

export type InputProps = React.ComponentProps<"input"> & {
  /** Clears the field on focus when the current value matches one of these defaults. */
  clearOnFocusWhen?: string | readonly string[];
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, clearOnFocusWhen, onFocus, onChange, value, ...props }, ref) => {
    const defaultValues = clearOnFocusWhen
      ? Array.isArray(clearOnFocusWhen)
        ? clearOnFocusWhen
        : [clearOnFocusWhen]
      : null;

    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full rounded-xl border border-input bg-surface-elevated/60 px-3.5 py-2 text-sm text-foreground shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        value={value}
        onChange={onChange}
        onFocus={(e) => {
          if (
            defaultValues &&
            typeof value === "string" &&
            defaultValues.includes(value)
          ) {
            onChange?.({
              ...e,
              target: { ...e.target, value: "" },
              currentTarget: { ...e.currentTarget, value: "" },
            });
          }
          onFocus?.(e);
        }}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
