import React, { useId } from "react";
import { cn } from "@/lib/utils";

const CONTROL =
  "w-full rounded-control border border-line bg-surface-secondary px-3 text-body text-ink " +
  "placeholder:text-ink-tertiary transition-[border-color,background-color,box-shadow] duration-150 ease-standard " +
  "focus:border-accent focus:bg-surface focus:shadow-ring focus:outline-none " +
  "disabled:opacity-60 aria-[invalid=true]:border-danger";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(CONTROL, "h-9 max-md:h-11", className)} {...rest} />;
  },
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(CONTROL, "block py-2.5 leading-relaxed", className)} {...rest} />;
});

interface FieldChrome {
  label: string;
  help?: string;
  error?: string | null;
}

function Chrome({
  id,
  label,
  help,
  error,
  children,
  emphasis,
}: FieldChrome & { id: string; children: React.ReactNode; emphasis?: boolean }) {
  return (
    <div>
      <label htmlFor={id} className={emphasis ? "text-heading text-ink" : "text-label text-ink"}>
        {label}
      </label>
      {help && (
        <p id={`${id}-help`} className="mt-1 max-w-[62ch] text-body text-ink-tertiary">
          {help}
        </p>
      )}
      <div className={help || emphasis ? "mt-3" : "mt-1.5"}>{children}</div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-label text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, help?: string, error?: string | null) {
  return [help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
}

/** A labelled single-line input. The label is tied to the control, so it's read out and clickable. */
export function TextField({
  label,
  help,
  error,
  className,
  ...rest
}: FieldChrome & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={className}>
      <Chrome id={id} label={label} help={help} error={error}>
        <Input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, help, error)} {...rest} />
      </Chrome>
    </div>
  );
}

/** A labelled multi-line input, with the label styled as a section heading. */
export function TextAreaField({
  label,
  help,
  error,
  ...rest
}: FieldChrome & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Chrome id={id} label={label} help={help} error={error} emphasis>
      <Textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, help, error)} {...rest} />
    </Chrome>
  );
}
