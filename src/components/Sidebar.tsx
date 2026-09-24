import {
  Building2,
  Inbox,
  LayoutDashboard,
  ReceiptText,
  Send,
  Settings,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type ViewKey = "overview" | "transactions" | "accounts" | "queue" | "history" | "facts" | "settings";

interface Props {
  current: ViewKey;
  pendingCount: number;
  onSelect: (view: ViewKey) => void;
}

interface Item {
  key: ViewKey;
  label: string;
  icon: LucideIcon;
}

const OVERVIEW: Item = { key: "overview", label: "Overview", icon: LayoutDashboard };
const SETTINGS: Item = { key: "settings", label: "Settings", icon: Settings };

const GROUPS: { heading: string; items: Item[] }[] = [
  {
    heading: "Money",
    items: [
      { key: "transactions", label: "Transactions", icon: ReceiptText },
      { key: "accounts", label: "Accounts", icon: Wallet },
    ],
  },
  {
    heading: "Desk",
    items: [
      { key: "queue", label: "Waiting on you", icon: Inbox },
      { key: "history", label: "Sent", icon: Send },
      { key: "facts", label: "Your business", icon: Building2 },
    ],
  },
];

/** The email desk is three views; on a phone they share one tab and the views link to each other. */
export const DESK_VIEWS: ViewKey[] = ["queue", "history", "facts"];

const ROW =
  "relative flex w-full items-center justify-center gap-3 rounded-control text-ink-secondary " +
  "transition-colors duration-150 ease-standard hover:bg-black/5 " +
  "aria-[current=page]:bg-black/[0.07] aria-[current=page]:text-ink";

/**
 * Full sidebar on wide windows, icon rail on medium ones, a bottom tab bar on
 * phone widths. Labels stay in the DOM at every size so screen readers get them.
 */
export function Sidebar({ current, pendingCount, onSelect }: Props) {
  const badge = (item: Item) => item.key === "queue" && pendingCount > 0;

  // A render helper, not a component: a nested component would remount on every render and drop keyboard focus.
  function sideItem(item: Item) {
    const active = item.key === current;
    const Icon = item.icon;
    return (
      <li key={item.key}>
        <button
          onClick={() => onSelect(item.key)}
          aria-current={active ? "page" : undefined}
          title={item.label}
          className={ROW + " h-10 px-0 text-body lg:justify-start lg:px-3"}
        >
          <span className="relative">
            <Icon className={"h-[18px] w-[18px] " + (active ? "text-accent" : "")} strokeWidth={1.75} aria-hidden="true" />
            {badge(item) && (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-sidebar lg:hidden"
              />
            )}
          </span>
          <span className="sr-only lg:not-sr-only">{item.label}</span>
          {badge(item) && (
            <>
              <span aria-hidden="true" className="ml-auto hidden text-label tabular-nums text-ink-tertiary lg:inline">
                {pendingCount}
              </span>
              <span className="sr-only">, {pendingCount} waiting</span>
            </>
          )}
        </button>
      </li>
    );
  }

  const phoneItems: Item[] = [
    OVERVIEW,
    { key: "transactions", label: "Transactions", icon: ReceiptText },
    { key: "accounts", label: "Accounts", icon: Wallet },
    { key: "queue", label: "Desk", icon: Inbox },
    SETTINGS,
  ];
  const tabs = phoneItems.map((item) => ({
    item,
    target: item.key,
    active: item.key === "queue" ? DESK_VIEWS.includes(current) : item.key === current,
  }));

  return (
    <>
      {/* Wide and medium windows */}
      <nav
        aria-label="Main"
        className="hidden h-full w-16 shrink-0 select-none flex-col border-r border-line bg-sidebar px-2.5 py-4 md:flex lg:w-60 lg:px-3"
      >
        <div className="flex items-center gap-2.5 px-1.5 pb-5 lg:px-2.5">
          <div
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink text-[13px] font-semibold text-white"
          >
            Z
          </div>
          <span className="hidden text-heading text-ink lg:inline">ZeraphDesk</span>
        </div>

        <ul className="flex flex-col gap-0.5">
          {sideItem(OVERVIEW)}
        </ul>

        {GROUPS.map((group) => (
          <div key={group.heading} className="mt-4 border-t border-line pt-3 lg:border-t-0 lg:pt-0">
            <h2 className="hidden px-3 pb-1 text-meta font-medium text-ink-tertiary lg:block">{group.heading}</h2>
            <ul className="flex flex-col gap-0.5">
              {group.items.map(sideItem)}
            </ul>
          </div>
        ))}

        <ul className="mt-auto flex flex-col gap-0.5 pt-4">
          {sideItem(SETTINGS)}
        </ul>
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
        {tabs.map(({ item, active, target }) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              onClick={() => onSelect(target)}
              aria-current={active ? "page" : undefined}
              className={ROW + " flex-1 flex-col gap-0.5 px-1 text-[11px] font-medium"}
            >
              <span className="relative">
                <Icon className={"h-[18px] w-[18px] " + (active ? "text-accent" : "")} strokeWidth={1.75} aria-hidden="true" />
                {badge(item) && (
                  <span aria-hidden="true" className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-sidebar" />
                )}
              </span>
              {item.label}
              {badge(item) && <span className="sr-only">, {pendingCount} waiting</span>}
            </button>
          );
        })}
      </nav>
    </>
  );
}
