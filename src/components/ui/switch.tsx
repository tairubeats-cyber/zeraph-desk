import { cn } from "@/lib/utils";

/**
 * An on/off switch. It's a real button with role="switch", so it works with a
 * keyboard (Space or Enter) and is announced with its state. The label is
 * supplied by the caller through `aria-labelledby` or `aria-label`.
 */
export function Switch({
  checked,
  onChange,
  disabled,
  ...rest
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role" | "aria-checked">) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[26px] w-[44px] shrink-0 items-center rounded-full transition-colors duration-200 ease-standard",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-accent" : "bg-chart-muted",
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-[22px] w-[22px] rounded-full bg-white shadow-card transition-transform duration-200 ease-standard",
          checked ? "translate-x-[20px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}
