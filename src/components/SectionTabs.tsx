import { cn } from "@/lib/utils";
import { groupOf, type ViewKey } from "@/nav";

/**
 * On a phone the bottom bar only reaches whole groups, so the sections inside
 * the current group are one swipe away here. Hidden from md up, where the
 * sidebar already lists them.
 */
export function SectionTabs({ current, onSelect }: { current: ViewKey; onSelect: (v: ViewKey) => void }) {
  const group = groupOf(current);
  if (!group) return null;
  return (
    <nav aria-label={group.label} className="-mx-4 mb-5 overflow-x-auto px-4 md:hidden">
      <ul className="flex w-max gap-1 rounded-control bg-surface-secondary p-1">
        {group.items.map((it) => (
          <li key={it.key}>
            <button
              onClick={() => onSelect(it.key)}
              aria-current={it.key === current ? "page" : undefined}
              className={cn(
                "h-9 whitespace-nowrap rounded-lg px-3 text-label transition-colors duration-150 ease-standard",
                "aria-[current=page]:bg-surface aria-[current=page]:text-ink aria-[current=page]:shadow-card",
                it.built ? "text-ink-secondary" : "text-ink-tertiary",
              )}
            >
              {it.label}
              {!it.built && <span className="sr-only">, not built yet</span>}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
