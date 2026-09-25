import { useState } from "react";
import { ChevronDown, ShieldCheck, Sparkles } from "lucide-react";
import {
  GROUPS,
  MORE,
  OVERVIEW,
  groupOf,
  landingFor,
  type NavGroup,
  type NavItem,
  type ViewKey,
} from "@/nav";
import { cn } from "@/lib/utils";

interface Props {
  current: ViewKey;
  /** Counts to show beside items, keyed by view. */
  badges: Partial<Record<ViewKey, number>>;
  /** Opens Ask ZeraphDesk. */
  onAsk: () => void;
  /** The notification bell, so the sidebar and the phone header can share one. */
  bell: React.ReactNode;
  onSelect: (view: ViewKey) => void;
}

/** What a count beside an item means, for screen readers. */
const BADGE_WORD: Partial<Record<ViewKey, string>> = { queue: "waiting", "action-center": "to look at" };

/** The shortcut that opens Ask, spelled the way this computer spells it. */
export const ASK_SHORTCUT = typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "⌘K" : "Ctrl K";

const COLLAPSED_KEY = "zeraphdesk.nav.collapsed";

/** Which groups the user folded away. A per-person convenience, so it lives in the browser, and the app works without it. */
function loadCollapsed(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function saveCollapsed(keys: string[]) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(keys));
  } catch {
    /* private mode or blocked storage: folding just won't persist */
  }
}

const ROW =
  "relative flex w-full items-center justify-center gap-3 rounded-control " +
  "transition-colors duration-150 ease-standard hover:bg-black/5 " +
  "aria-[current=page]:bg-black/[0.07] aria-[current=page]:text-ink";

/** The phone tab bar: the four sections you reach for most, then everything else. */
const PHONE_TABS: { label: string; icon: NavItem["icon"]; target: ViewKey; groupKey?: string }[] = [
  { label: OVERVIEW.label, icon: OVERVIEW.icon, target: "overview" },
  ...["money", "planning", "intelligence"].map((key) => {
    const g = GROUPS.find((x) => x.key === key) as NavGroup;
    return { label: g.label, icon: g.icon, target: landingFor(g), groupKey: key };
  }),
  { label: "More", icon: MORE.icon, target: "more" },
];

/**
 * Full sidebar on wide windows, icon rail on medium ones, bottom tab bar on
 * phone widths. Labels stay in the DOM at every size so screen readers get
 * them. The list scrolls, so the full tree fits any window height.
 */
export function Sidebar({ current, badges, onAsk, bell, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsed);
  const currentGroup = groupOf(current);

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      saveCollapsed(next);
      return next;
    });
  }

  const count = (item: NavItem) => badges[item.key] ?? 0;
  const badge = (item: NavItem) => count(item) > 0;

  // Render helpers, not components: a nested component would remount on every render and drop keyboard focus.
  function item(it: NavItem) {
    const active = it.key === current;
    const Icon = it.icon;
    return (
      <li key={it.key}>
        <button
          onClick={() => onSelect(it.key)}
          aria-current={active ? "page" : undefined}
          title={it.built ? it.label : `${it.label} (not built yet)`}
          className={cn(
            ROW,
            "h-10 px-0 text-body lg:h-9 lg:justify-start lg:px-3",
            it.built ? "text-ink-secondary" : "text-ink-tertiary",
          )}
        >
          <span className="relative">
            <Icon className={cn("h-[18px] w-[18px]", active && "text-accent")} strokeWidth={1.75} aria-hidden="true" />
            {badge(it) && (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-sidebar lg:hidden"
              />
            )}
          </span>
          <span className="sr-only lg:not-sr-only lg:min-w-0 lg:truncate lg:whitespace-nowrap lg:text-left">{it.label}</span>
          {!it.built && <span className="sr-only">, not built yet</span>}
          {!it.built && (
            <span aria-hidden="true" className="ml-auto hidden shrink-0 pl-2 text-meta lg:inline">
              Soon
            </span>
          )}
          {badge(it) && (
            <>
              <span aria-hidden="true" className="ml-auto hidden text-label tabular-nums text-ink-tertiary lg:inline">
                {count(it)}
              </span>
              <span className="sr-only">, {count(it)} {BADGE_WORD[it.key] ?? "new"}</span>
            </>
          )}
        </button>
      </li>
    );
  }

  function group(g: NavGroup) {
    const containsCurrent = currentGroup?.key === g.key;
    const open = containsCurrent || !collapsed.includes(g.key);
    const hasPending = g.items.some(badge);
    return (
      <div key={g.key} className="mt-3 border-t border-line pt-2 lg:border-t-0 lg:pt-0">
        <button
          onClick={() => toggle(g.key)}
          aria-expanded={open}
          // Folding the group you're standing in would hide where you are.
          disabled={containsCurrent}
          className="hidden w-full items-center gap-1 rounded-control px-3 pb-1 pt-1.5 text-meta font-medium text-ink-tertiary transition-colors duration-150 ease-standard enabled:hover:text-ink lg:flex"
        >
          <span>{g.label}</span>
          {!open && hasPending && (
            <>
              <span aria-hidden="true" className="ml-1 h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="sr-only">, {g.items.reduce((sum, i) => sum + count(i), 0)} new</span>
            </>
          )}
          <ChevronDown
            className={cn("ml-auto h-3.5 w-3.5 transition-transform duration-150 ease-standard", !open && "-rotate-90")}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </button>
        <ul className={cn("flex flex-col gap-0.5", !open && "lg:hidden")}>{g.items.map(item)}</ul>
      </div>
    );
  }

  // A tab's count is everything beside the items it leads to; "More" covers the groups without a tab of their own.
  const tabGroups = PHONE_TABS.flatMap((t) => (t.groupKey ? [t.groupKey] : []));
  const tabCount = (t: (typeof PHONE_TABS)[number]) =>
    GROUPS.filter((g) => (t.target === "more" ? !tabGroups.includes(g.key) : g.key === t.groupKey)).reduce(
      (sum, g) => sum + g.items.reduce((n, i) => n + count(i), 0),
      0,
    );

  const phoneActive = (t: (typeof PHONE_TABS)[number]) => {
    if (t.target === "overview") return current === "overview";
    if (t.target === "more") return current === "more" || (currentGroup ? !["money", "planning", "intelligence"].includes(currentGroup.key) : false);
    return currentGroup?.key === t.groupKey;
  };

  return (
    <>
      {/* Wide and medium windows */}
      <nav
        aria-label="Main"
        className="hidden h-full w-16 shrink-0 select-none flex-col border-r border-line bg-sidebar px-2.5 py-4 md:flex lg:w-64 lg:px-3"
      >
        <div className="flex items-center gap-2.5 px-1.5 pb-4 lg:px-2.5">
          <div
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink text-[13px] font-semibold text-white"
          >
            Z
          </div>
          <span className="hidden text-heading text-ink lg:inline">ZeraphDesk</span>
        </div>

        <div className="mb-3 flex flex-col items-center gap-1 lg:flex-row lg:gap-2">
          <button
            onClick={onAsk}
            aria-label="Ask ZeraphDesk"
            title={`Ask ZeraphDesk (${ASK_SHORTCUT})`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-line bg-surface text-ink-secondary shadow-card transition-colors duration-150 ease-standard hover:bg-surface-hover lg:w-auto lg:flex-1 lg:justify-start lg:gap-2 lg:px-3"
          >
            <Sparkles className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span aria-hidden="true" className="hidden whitespace-nowrap text-label font-normal text-ink-tertiary lg:inline">
              Ask ZeraphDesk
            </span>
          </button>
          {bell}
        </div>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <ul className="flex flex-col gap-0.5">{item(OVERVIEW)}</ul>
          {GROUPS.map(group)}
        </div>

        <div className="hidden items-start gap-2 px-3 pt-4 text-meta text-ink-tertiary lg:flex">
          <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span>Nothing sends until you approve it.</span>
        </div>
      </nav>

      {/* Phone widths */}
      <nav
        aria-label="Main"
        className="flex h-16 shrink-0 select-none items-stretch justify-around gap-1 border-t border-line bg-sidebar px-2 md:hidden"
      >
        {PHONE_TABS.map((t) => {
          const Icon = t.icon;
          const active = phoneActive(t);
          return (
            <button
              key={t.label}
              onClick={() => onSelect(t.target)}
              aria-current={active ? "page" : undefined}
              className={cn(ROW, "flex-1 flex-col gap-0.5 px-1 text-[11px] font-medium text-ink-secondary")}
            >
              <span className="relative">
                <Icon className={cn("h-[18px] w-[18px]", active && "text-accent")} strokeWidth={1.75} aria-hidden="true" />
                {tabCount(t) > 0 && (
                  <span aria-hidden="true" className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-sidebar" />
                )}
              </span>
              {t.label}
              {tabCount(t) > 0 && <span className="sr-only">, {tabCount(t)} new</span>}
            </button>
          );
        })}
      </nav>
    </>
  );
}
