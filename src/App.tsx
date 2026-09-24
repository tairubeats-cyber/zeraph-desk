import { useCallback, useEffect, useRef, useState } from "react";
import { DESK_VIEWS, Sidebar, type ViewKey } from "./components/Sidebar";
import { Overview } from "./views/Overview";
import { Transactions } from "./views/Transactions";
import { Accounts } from "./views/Accounts";
import { Queue } from "./views/Queue";
import { History } from "./views/History";
import { Facts } from "./views/Facts";
import { Settings } from "./views/Settings";
import { db, newEvent } from "./lib/db";
import type { Action } from "./lib/actions";
import { type BusinessFacts, EMPTY_FACTS } from "./lib/facts";
import { emailConnector } from "./connectors/email";
import { syncInbox, proposeFollowUps } from "./lib/sync";
import { useFinance } from "./lib/finance/useFinance";
import type { TxFilters } from "./lib/finance/filters";

const SYNC_INTERVAL_MS = 60_000;
const FINANCE_VIEWS: ViewKey[] = ["overview", "transactions", "accounts"];
/** Matches the `toast` animation length in tailwind.config.js. */
const TOAST_MS = 2600;

const DESK_TABS: { key: ViewKey; label: string }[] = [
  { key: "queue", label: "Waiting on you" },
  { key: "history", label: "Sent" },
  { key: "facts", label: "Your business" },
];

/** On a phone the three desk views share one tab, so they need a way to reach each other. */
function DeskTabs({ current, onSelect }: { current: ViewKey; onSelect: (v: ViewKey) => void }) {
  return (
    <div role="group" aria-label="Desk" className="mb-5 flex gap-1 rounded-control bg-surface-secondary p-1 md:hidden">
      {DESK_TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => onSelect(t.key)}
          aria-pressed={t.key === current}
          className="h-9 flex-1 rounded-lg text-label text-ink-secondary transition-colors duration-150 ease-standard aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-card"
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<ViewKey>("overview");
  const [txPreset, setTxPreset] = useState<Partial<TxFilters> | undefined>();
  const [pending, setPending] = useState<Action[]>([]);
  const [past, setPast] = useState<Action[]>([]);
  const [facts, setFacts] = useState<BusinessFacts>(EMPTY_FACTS);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const flash = useCallback((message: string) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text: message });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const finance = useFinance(flash);

  function open(next: ViewKey, filters?: Partial<TxFilters>) {
    setTxPreset(filters);
    setView(next);
  }

  async function refresh() {
    setPending(await db.pendingActions());
    setPast(await db.recentActions());
    setFacts(await db.facts());
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const synced = await syncInbox();
        const followedUp = await proposeFollowUps();
        if (!cancelled && synced.queued + followedUp.queued > 0) await refresh();
      } catch (err) {
        console.error("Mail sync failed:", err instanceof Error ? err.message : err);
      }
    }
    void tick();
    const interval = setInterval(tick, SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function approve(action: Action, body: string) {
    const edited: Action = {
      ...action,
      payload: { ...action.payload, body } as Action["payload"],
      status: "approved",
      decidedAt: new Date().toISOString(),
    };
    await db.updateAction(action.id, edited);
    await db.log(newEvent("action_approved", action.id, { kind: action.kind }));

    try {
      if (emailConnector.canSend(edited) && (await emailConnector.isConnected())) {
        await emailConnector.send(edited);
      }
      await db.updateAction(action.id, { status: "sent" });
      await db.log(newEvent("action_sent", action.id, { kind: action.kind }));
      flash("Reply sent");
    } catch (err) {
      await db.updateAction(action.id, { status: "failed" });
      await db.log(newEvent("action_failed", action.id, { kind: action.kind }));
      // Tauri rejects with the raw string an Err(String) command returns, not an Error instance.
      flash(
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message
            : "That didn't send. It's still in your queue.",
      );
    }
    await refresh();
  }

  async function decline(action: Action, reason: string) {
    await db.updateAction(action.id, {
      status: "declined",
      decidedAt: new Date().toISOString(),
      declineReason: reason || null,
    });
    await db.log(newEvent("action_declined", action.id, { kind: action.kind }));
    flash("Skipped");
    await refresh();
  }

  return (
    // flex-col-reverse puts the nav (first in the DOM, so first for keyboard and
    // screen readers) at the bottom on phone widths.
    <div className="flex h-full flex-col-reverse md:flex-row">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:text-label focus:text-ink focus:shadow-elevated"
      >
        Skip to content
      </a>

      <Sidebar current={view} pendingCount={pending.length} onSelect={(v) => open(v)} />

      <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto focus:outline-none">
        <div
          key={view}
          className={
            "mx-auto w-full animate-view-in px-4 py-6 md:px-8 md:py-10 " +
            (FINANCE_VIEWS.includes(view) ? "max-w-[1120px]" : "max-w-[760px]")
          }
        >
          {DESK_VIEWS.includes(view) && <DeskTabs current={view} onSelect={(v) => open(v)} />}
          {view === "overview" && <Overview finance={finance} onOpen={open} />}
          {view === "transactions" && <Transactions finance={finance} preset={txPreset} />}
          {view === "accounts" && <Accounts finance={finance} />}
          {view === "queue" && <Queue actions={pending} onApprove={approve} onDecline={decline} />}
          {view === "history" && <History actions={past} />}
          {view === "facts" && (
            <Facts
              facts={facts}
              onSave={async (next) => {
                await db.saveFacts(next);
                flash("Saved");
                await refresh();
              }}
            />
          )}
          {view === "settings" && <Settings />}
        </div>
      </main>

      {/* Always mounted so screen readers announce changes; the visible toast below is decoration. */}
      <div role="status" aria-live="polite" className="sr-only">
        {toast?.text}
      </div>
      {toast && (
        <div
          key={toast.id}
          aria-hidden="true"
          className="pointer-events-none fixed bottom-6 left-1/2 z-40 max-w-[calc(100vw-2rem)] animate-toast rounded-xl bg-hud px-4 py-2.5 text-label text-hud-text shadow-elevated backdrop-blur-md max-md:bottom-24"
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
