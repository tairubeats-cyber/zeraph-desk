import { useEffect, useState } from "react";
import { Input } from "@/components/ui/field";
import { moneyInputValue, parseMoney } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

/**
 * A dollars field that stores cents. Typing is free-form ("1,250", "$80.5");
 * the value is read when you leave the field or press Enter (or, with `live`,
 * as you type), and a value that can't be read snaps back rather than saving
 * something you didn't mean.
 */
export function MoneyInput({
  value,
  onCommit,
  live = false,
  className,
  ...rest
}: {
  /** Current amount in cents, or null when nothing is set. */
  value: number | null;
  /** Called with the new amount in cents, or null when the field was cleared. */
  onCommit: (cents: number | null) => void;
  /**
   * Report the amount as it's typed (for fields inside a form, so pressing
   * Enter submits what's on screen) instead of when the field is left.
   */
  live?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "type">) {
  const shown = value === null ? "" : moneyInputValue(value);
  const [text, setText] = useState(shown);
  // Follow outside changes, but never rewrite what's being typed ("1." is still 1).
  useEffect(() => {
    const typed = text.trim() === "" ? null : parseMoney(text);
    if (typed !== value) setText(shown);
  }, [shown]);

  function commit() {
    if (text.trim() === "") {
      if (value !== null) onCommit(null);
      setText("");
      return;
    }
    const cents = parseMoney(text);
    if (cents === null) return setText(shown);
    if (cents !== value) onCommit(cents);
    setText(moneyInputValue(cents));
  }

  return (
    <div className={cn("relative", className)}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-body text-ink-tertiary"
      >
        $
      </span>
      <Input
        inputMode="decimal"
        autoComplete="off"
        className="pl-6 text-right tabular-nums"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (live) onCommit(e.target.value.trim() === "" ? null : parseMoney(e.target.value));
        }}
        onBlur={live ? () => setText(shown) : commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !live) (e.target as HTMLInputElement).blur();
        }}
        {...rest}
      />
    </div>
  );
}

/** A thin bar for "how far along". Decorative: the numbers next to it carry the meaning. */
export function ProgressBar({
  fraction,
  tone = "accent",
  className,
}: {
  fraction: number;
  tone?: "accent" | "muted" | "warning";
  className?: string;
}) {
  const fill = tone === "accent" ? "bg-accent" : tone === "warning" ? "bg-warning" : "bg-chart-muted";
  return (
    <span aria-hidden="true" className={cn("block h-2 overflow-hidden rounded-full bg-surface-secondary", className)}>
      <span
        className={cn("block h-full rounded-full transition-[width] duration-200 ease-standard", fill)}
        style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
      />
    </span>
  );
}

/** Pick one of a few options, iOS-segmented style. */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap gap-1 rounded-control bg-surface-secondary p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className="h-8 whitespace-nowrap rounded-lg px-3 text-label text-ink-secondary transition-colors duration-150 ease-standard aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-card"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A label above a figure. */
export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-label text-ink-tertiary">{label}</dt>
      <dd className="mt-0.5 text-heading tabular-nums text-ink">{value}</dd>
      {hint && <dd className="mt-0.5 text-meta text-ink-tertiary">{hint}</dd>}
    </div>
  );
}
