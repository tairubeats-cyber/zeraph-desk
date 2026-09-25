import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export const tabId = (base: string, key: string) => `${base}-tab-${key}`;
export const panelId = (base: string, key: string) => `${base}-panel-${key}`;

/**
 * Tabs within a page. The buttons are a real tablist: arrow keys, Home and End
 * move between them, only the current one is in the Tab order, and each
 * points at its panel. The caller renders the panel with `role="tabpanel"`,
 * `id={panelId(base, key)}` and `aria-labelledby={tabId(base, key)}`.
 */
export function Tabs<T extends string>({
  base,
  label,
  tabs,
  value,
  onChange,
}: {
  base: string;
  label: string;
  tabs: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  const refs = useRef<Map<T, HTMLButtonElement>>(new Map());

  // On a narrow screen the strip scrolls; keep the selected tab in view.
  useEffect(() => {
    refs.current.get(value)?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [value]);

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const last = tabs.length - 1;
    const to = e.key === "ArrowRight" ? (index === last ? 0 : index + 1) : e.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (to === null) return;
    e.preventDefault();
    onChange(tabs[to].key);
    refs.current.get(tabs[to].key)?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line px-1 pb-px">
      {tabs.map((t, i) => {
        const selected = t.key === value;
        return (
          <button
            key={t.key}
            ref={(el) => {
              if (el) refs.current.set(t.key, el);
              else refs.current.delete(t.key);
            }}
            role="tab"
            id={tabId(base, t.key)}
            aria-selected={selected}
            aria-controls={panelId(base, t.key)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "relative h-10 shrink-0 whitespace-nowrap rounded-t-lg px-3.5 text-body transition-colors duration-150 ease-standard max-md:h-11",
              selected ? "font-medium text-ink" : "text-ink-tertiary hover:text-ink",
            )}
          >
            {t.label}
            {selected && <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        );
      })}
    </div>
  );
}
