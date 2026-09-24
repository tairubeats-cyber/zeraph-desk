import React, { useId } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { CONTROL } from "./field";

/** A native select (so it's keyboard- and screen-reader-correct everywhere) in the same skin as the text fields. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <div className={cn("relative", className)}>
        <select ref={ref} className={cn(CONTROL, "h-9 cursor-pointer appearance-none pr-9 max-md:h-11")} {...rest}>
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </div>
    );
  },
);

export function SelectField({
  label,
  className,
  children,
  ...rest
}: { label: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="text-label text-ink">
        {label}
      </label>
      <Select id={id} className="mt-1.5" {...rest}>
        {children}
      </Select>
    </div>
  );
}
