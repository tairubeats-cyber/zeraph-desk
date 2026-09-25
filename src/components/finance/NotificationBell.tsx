import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NOTIFICATION_CATEGORIES } from "@/lib/finance/prefs";
import type { Intel } from "@/lib/finance/useIntel";
import type { TxFilters } from "@/lib/finance/filters";
import type { ViewKey } from "@/nav";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL = Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c.key, c.label]));

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The bell and its panel. Notifications are the findings whose category the
 * person has left on, so they can't multiply on their own: each finding
 * notifies once, and clearing one here doesn't remove it from the Action Center.
 */
export function NotificationBell({
  intel,
  onOpen,
}: {
  intel: Intel;
  onOpen: (view: ViewKey, filters?: Partial<TxFilters>) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    }
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const { notifications, unreadCount } = intel;

  function go(view: ViewKey, filters?: Partial<TxFilters>) {
    setOpen(false);
    onOpen(view, filters);
  }

  return (
    <>
      <button
        ref={button}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        title="Notifications"
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-line bg-surface text-ink-secondary shadow-card transition-colors duration-150 ease-standard hover:bg-surface-hover"
      >
        <Bell className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-sidebar"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label="Notifications"
          tabIndex={-1}
          // Keyboard users tab or activate their way out; the panel shouldn't be left floating over the next screen.
          onBlur={(e) => {
            const next = e.relatedTarget as Node | null;
            if (next && !e.currentTarget.contains(next) && next !== button.current) setOpen(false);
          }}
          className="fixed inset-x-3 top-14 z-50 max-h-[70vh] overflow-y-auto rounded-card border border-line bg-surface-elevated shadow-elevated animate-fade-in focus:outline-none md:inset-x-auto md:left-[4.5rem] md:top-3 md:w-[22rem] lg:left-[17rem]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="text-heading text-ink">Notifications</h2>
            {unreadCount > 0 && (
              <Button variant="tertiary" size="sm" onClick={() => void intel.markAllRead()}>
                Mark all read
              </Button>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-body text-ink-tertiary">You're all caught up.</p>
          ) : (
            <ul className="divide-y divide-line">
              {notifications.map(({ insight, state }) => {
                const target = insight.options.find((o) => o.kind === "open");
                return (
                  <li key={state.id} className="flex items-start gap-1 pr-2">
                    <button
                      onClick={() => {
                        void intel.markRead(state.id);
                        if (target && target.kind === "open") go(target.view, target.filters);
                        else go("action-center");
                      }}
                      className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left transition-colors duration-150 ease-standard hover:bg-surface-secondary"
                    >
                      <span
                        aria-hidden="true"
                        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", state.read ? "bg-transparent" : "bg-accent")}
                      />
                      <span className="min-w-0">
                        <span className="block text-meta text-ink-tertiary">
                          {CATEGORY_LABEL[state.category]} · {ago(state.firstSeenAt)}
                          {!state.read && <span className="sr-only"> · unread</span>}
                        </span>
                        <span className="block text-body font-medium text-ink">{insight.title}</span>
                        <span className="block text-label font-normal text-ink-tertiary">{insight.summary}</span>
                      </span>
                    </button>
                    <Button
                      variant="tertiary"
                      size="sm"
                      className="mt-2 w-8 shrink-0 px-0"
                      aria-label={`Clear notification: ${insight.title}`}
                      onClick={() => void intel.hideNotification(state.id)}
                    >
                      <X className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
            <Button variant="tertiary" size="sm" className="-ml-3" onClick={() => go("action-center")}>
              Open Action Center
            </Button>
            <Button variant="tertiary" size="sm" className="-mr-3" onClick={() => go("preferences")}>
              Preferences
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
