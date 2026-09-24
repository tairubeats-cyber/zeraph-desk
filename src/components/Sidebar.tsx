import { Building2, Inbox, Send, Settings, ShieldCheck, type LucideIcon } from "lucide-react";

export type ViewKey = "queue" | "history" | "facts" | "settings";

interface Props {
  current: ViewKey;
  pendingCount: number;
  onSelect: (view: ViewKey) => void;
}

const ITEMS: { key: ViewKey; label: string; icon: LucideIcon }[] = [
  { key: "queue", label: "Waiting on you", icon: Inbox },
  { key: "history", label: "Sent", icon: Send },
  { key: "facts", label: "Your business", icon: Building2 },
  { key: "settings", label: "Settings", icon: Settings },
];

/**
 * Full sidebar on wide windows, icon rail on medium ones, bottom tab bar on
 * phone widths. Labels stay in the DOM at every size so screen readers get them.
 */
export function Sidebar({ current, pendingCount, onSelect }: Props) {
  return (
    <nav
      aria-label="Main"
      className={
        "flex h-16 shrink-0 select-none items-stretch justify-around gap-1 border-t border-line bg-sidebar px-2 " +
        "md:h-full md:w-16 md:flex-col md:justify-start md:border-r md:border-t-0 md:px-2.5 md:py-4 " +
        "lg:w-60 lg:px-3"
      }
    >
      <div className="hidden items-center gap-2.5 px-1.5 pb-5 md:flex lg:px-2.5">
        <div
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink text-[13px] font-semibold text-white"
        >
          Z
        </div>
        <span className="hidden text-heading text-ink lg:inline">Zeraph Desk</span>
      </div>

      <ul className="flex flex-1 items-stretch justify-around gap-1 md:flex-none md:flex-col md:justify-start">
        {ITEMS.map((item) => {
          const active = item.key === current;
          const Icon = item.icon;
          const waiting = item.key === "queue" && pendingCount > 0;
          return (
            <li key={item.key} className="flex-1 md:flex-none">
              <button
                onClick={() => onSelect(item.key)}
                aria-current={active ? "page" : undefined}
                title={item.label}
                className={
                  "relative flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-control px-2 text-[11px] font-medium " +
                  "text-ink-secondary transition-colors duration-150 ease-standard hover:bg-black/5 " +
                  "aria-[current=page]:bg-black/[0.07] aria-[current=page]:text-ink " +
                  "md:h-10 md:flex-row md:justify-center md:gap-3 md:px-0 md:text-body lg:justify-start lg:px-3"
                }
              >
                <span className="relative">
                  <Icon
                    className={"h-[18px] w-[18px] " + (active ? "text-accent" : "")}
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  {waiting && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-sidebar lg:hidden"
                    />
                  )}
                </span>
                <span className="max-md:not-sr-only md:sr-only lg:not-sr-only">{item.label}</span>
                {waiting && (
                  <>
                    <span
                      aria-hidden="true"
                      className="ml-auto hidden text-label tabular-nums text-ink-tertiary lg:inline"
                    >
                      {pendingCount}
                    </span>
                    <span className="sr-only">, {pendingCount} waiting</span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto hidden items-start gap-2 px-2.5 pt-4 text-meta text-ink-tertiary lg:flex">
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span>Nothing sends until you approve it.</span>
      </div>
    </nav>
  );
}
