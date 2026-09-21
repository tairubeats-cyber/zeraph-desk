import { useEffect, useState } from "react";
import { Sidebar, type ViewKey } from "./components/Sidebar";
import { Queue } from "./views/Queue";
import { History } from "./views/History";
import { Facts } from "./views/Facts";
import { Settings } from "./views/Settings";
import { db, newEvent } from "./lib/db";
import type { Action } from "./lib/actions";
import { type BusinessFacts, EMPTY_FACTS } from "./lib/facts";
import { emailConnector } from "./connectors/email";
import { syncInbox, proposeFollowUps } from "./lib/sync";

const SYNC_INTERVAL_MS = 60_000;

export default function App() {
  const [view, setView] = useState<ViewKey>("queue");
  const [pending, setPending] = useState<Action[]>([]);
  const [past, setPast] = useState<Action[]>([]);
  const [facts, setFacts] = useState<BusinessFacts>(EMPTY_FACTS);
  const [toast, setToast] = useState<string | null>(null);

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

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  }

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
    <div className="flex h-full">
      <Sidebar current={view} pendingCount={pending.length} onSelect={setView} />

      <main className="flex-1 overflow-y-auto px-14 py-12">
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
      </main>

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-md bg-navy-900 px-4 py-2 text-sm text-paper shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
