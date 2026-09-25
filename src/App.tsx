import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { SectionTabs } from "./components/SectionTabs";
import { findItem, type ViewKey } from "./nav";
import { AllSections } from "./views/AllSections";
import { ComingSoon } from "./views/ComingSoon";
import { Overview } from "./views/Overview";
import { Transactions } from "./views/Transactions";
import { Accounts } from "./views/Accounts";
import { CashFlow } from "./views/CashFlow";
import { Bills } from "./views/Bills";
import { Recurring } from "./views/Recurring";
import { Budgets } from "./views/Budgets";
import { Goals } from "./views/Goals";
import { Queue } from "./views/Queue";
import { History } from "./views/History";
import { Facts } from "./views/Facts";
import { Connections, Security } from "./views/Settings";
import { db, newEvent } from "./lib/db";
import type { Action } from "./lib/actions";
import { type BusinessFacts, EMPTY_FACTS } from "./lib/facts";
import { emailConnector } from "./connectors/email";
import { syncInbox, proposeFollowUps } from "./lib/sync";
import { useFinance } from "./lib/finance/useFinance";
import { usePlans } from "./lib/finance/usePlans";
import type { TxFilters } from "./lib/finance/filters";

const SYNC_INTERVAL_MS = 60_000;
/** Matches the `toast` animation length in tailwind.config.js. */
const TOAST_MS = 2600;

export default function App() {
  const [view, setView] = useState<ViewKey>("overview");
  const [txPreset, setTxPreset] = useState<Partial<TxFilters> | undefined>();
  const [pending, setPending] = useState<Action[]>([]);
  const [past, setPast] = useState<Action[]>([]);
  const [facts, setFacts] = useState<BusinessFacts>(EMPTY_FACTS);
  const [mailConnected, setMailConnected] = useState<boolean | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const flash = useCallback((message: string) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text: message });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const finance = useFinance(flash);
  const plans = usePlans(finance, flash);

  const current = findItem(view);

  function renderView() {
    if (!current.item.built) return <ComingSoon item={current.item} onOverview={() => open("overview")} />;
    switch (view) {
      case "overview":
        return <Overview finance={finance} plans={plans} onOpen={open} />;
      case "accounts":
        return <Accounts finance={finance} />;
      case "transactions":
        return <Transactions finance={finance} preset={txPreset} />;
      case "cash-flow":
        return <CashFlow finance={finance} plans={plans} onOpen={open} />;
      case "bills":
        return <Bills finance={finance} plans={plans} />;
      case "recurring":
        return <Recurring finance={finance} plans={plans} />;
      case "budgets":
        return <Budgets finance={finance} plans={plans} />;
      case "goals":
        return <Goals finance={finance} plans={plans} />;
      case "queue":
        return (
          <Queue
            actions={pending}
            mailConnected={mailConnected}
            onConnect={() => open("connections")}
            onApprove={approve}
            onDecline={decline}
          />
        );
      case "history":
        return <History actions={past} />;
      case "facts":
        return (
          <Facts
            facts={facts}
            onSave={async (next) => {
              await db.saveFacts(next);
              flash("Saved");
              await refresh();
            }}
          />
        );
      case "connections":
        return <Connections />;
      case "security":
        return <Security />;
      case "more":
        return <AllSections onOpen={open} />;
      default:
        // A section marked built in nav.ts with no case here is a wiring mistake, not a blank page.
        return <ComingSoon item={current.item} onOverview={() => open("overview")} />;
    }
  }

  function open(next: ViewKey, filters?: Partial<TxFilters>) {
    setTxPreset(filters);
    setView(next);
  }

  /** Whether an email account is set up. Anything that fails to answer counts as not connected. */
  async function checkMail(): Promise<boolean> {
    let connected = false;
    try {
      connected = await emailConnector.isConnected();
    } catch {
      connected = false;
    }
    setMailConnected(connected);
    return connected;
  }

  async function refresh() {
    void checkMail();
    setPending(await db.pendingActions());
    setPast(await db.recentActions());
    setFacts(await db.facts());
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (view === "queue") void checkMail();
  }, [view]);

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
    // Never claim a reply went out when there's nothing to send it with. The reply stays in the
    // queue, untouched, and the card keeps whatever was typed.
    if (emailConnector.canSend(action) && !(await checkMail())) {
      flash("Connect your email under Connections to send this. It's still in your queue.");
      return;
    }

    const edited: Action = {
      ...action,
      payload: { ...action.payload, body } as Action["payload"],
      status: "approved",
      decidedAt: new Date().toISOString(),
    };
    await db.updateAction(action.id, edited);
    await db.log(newEvent("action_approved", action.id, { kind: action.kind }));

    try {
      if (emailConnector.canSend(edited)) await emailConnector.send(edited);
      await db.updateAction(action.id, { status: "sent" });
      await db.log(newEvent("action_sent", action.id, { kind: action.kind }));
      flash("Reply sent");
    } catch (err) {
      // A reply that didn't go out goes back to the queue, with the text as edited, so it can't
      // quietly disappear into Sent while the customer waits. The failure stays in the event log.
      await db.updateAction(action.id, { status: "pending", decidedAt: null });
      await db.log(newEvent("action_failed", action.id, { kind: action.kind }));
      // Tauri rejects with the raw string an Err(String) command returns, not an Error instance.
      const reason = (typeof err === "string" ? err : err instanceof Error ? err.message : "").replace(/[.\s]+$/, "");
      flash(reason ? `Didn't send: ${reason}. It's still in your queue.` : "Didn't send. It's still in your queue.");
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
            (current.group?.narrow || view === "more" ? "max-w-[760px]" : "max-w-[1120px]")
          }
        >
          <SectionTabs current={view} onSelect={(v) => open(v)} />
          {renderView()}
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
