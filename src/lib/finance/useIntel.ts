import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db, newEvent } from "../db";
import type { Event } from "../events";
import { detectInsights } from "./insights";
import {
  FEED_EVENT_KINDS,
  actionItems,
  buildActivity,
  notificationsFor,
  planSync,
  type InsightState,
} from "./intel";
import { fingerprint } from "./fingerprint";
import { DEFAULT_PREFS, type DetectorId, type FinancePreferences } from "./prefs";
import type { AskContext } from "./ask";
import type { Finance } from "./useFinance";
import type { Plans } from "./usePlans";
import type { Planning } from "./usePlanning";

function message(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : "Something went wrong.";
}

/**
 * Findings, notifications, the Activity feed and preferences, built on top of
 * the finance and planning data. Findings are recomputed whenever the data
 * changes; only the person's response to each is stored. Reading and
 * detection never write anything except that state.
 */
export function useIntel(finance: Finance, plans: Plans, planning: Planning, onError: (message: string) => void) {
  const [prefs, setPrefs] = useState<FinancePreferences | null>(null);
  const [states, setStates] = useState<InsightState[] | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const statesRef = useRef<InsightState[] | null>(null);

  const commit = useCallback((next: InsightState[]) => {
    statesRef.current = next;
    setStates(next);
  }, []);

  const load = useCallback(async () => {
    try {
      const [p, s, e] = await Promise.all([db.finPreferences(), db.insightStates(), db.recentEvents([...FEED_EVENT_KINDS], 300)]);
      setPrefs(p);
      commit(s);
      setEvents(e);
    } catch (err) {
      onError(`Couldn't load your findings. ${message(err)}`);
    }
  }, [commit, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const reloadEvents = useCallback(async () => {
    try {
      setEvents(await db.recentEvents([...FEED_EVENT_KINDS], 300));
    } catch {
      /* the feed just keeps what it had */
    }
  }, []);

  const ready = finance.status === "ready" && plans.status === "ready" && prefs !== null && states !== null;

  const insights = useMemo(
    () =>
      ready && prefs
        ? detectInsights({
            today: finance.today,
            transactions: finance.transactions,
            categories: finance.categories,
            accounts: finance.snapshot?.accounts ?? [],
            recurring: plans.recurring,
            budgets: plans.budgets,
            goals: plans.goals,
            contributions: plans.contributions,
            prefs,
          })
        : [],
    [ready, prefs, finance.today, finance.transactions, finance.categories, finance.snapshot, plans.recurring, plans.budgets, plans.goals, plans.contributions],
  );

  // Record new findings, reopen ones that came back, and close ones that cleared up.
  useEffect(() => {
    if (!ready || !statesRef.current) return;
    const watching = new Set((Object.keys(prefs?.watch ?? {}) as DetectorId[]).filter((k) => prefs?.watch[k]));
    const plan = planSync(insights, statesRef.current, new Date().toISOString(), watching);
    if (plan.write.length === 0) return;
    commit(plan.next);
    void (async () => {
      try {
        for (const s of plan.write) await db.saveInsightState(s);
        await db.log(
          ...plan.detected.map((s) => newEvent("insight_detected", fingerprint(s.id, "ins"), { detector: s.detector })),
          ...plan.reopened.map((s) => newEvent("insight_reopened", fingerprint(s.id, "ins"), { detector: s.detector })),
        );
      } catch (err) {
        onError(`Couldn't save your findings. ${message(err)}`);
        void load();
      }
    })();
  }, [ready, insights, prefs, commit, load, onError]);

  const update = useCallback(
    async (id: string, change: Partial<InsightState>, log?: "insight_dismissed" | "insight_reopened") => {
      const current = statesRef.current?.find((s) => s.id === id);
      if (!current) return;
      const next: InsightState = { ...current, ...change, updatedAt: new Date().toISOString() };
      commit((statesRef.current ?? []).map((s) => (s.id === id ? next : s)));
      try {
        await db.saveInsightState(next);
        if (log) await db.log(newEvent(log, fingerprint(id, "ins"), { detector: next.detector }));
      } catch (err) {
        onError(`That didn't save. ${message(err)}`);
        void load();
      }
    },
    [commit, load, onError],
  );

  const dismiss = useCallback((id: string) => update(id, { status: "dismissed", read: true }, "insight_dismissed"), [update]);
  const restore = useCallback((id: string) => update(id, { status: "open" }, "insight_reopened"), [update]);
  const markRead = useCallback((id: string) => update(id, { read: true }), [update]);
  const hideNotification = useCallback((id: string) => update(id, { notifHidden: true, read: true }), [update]);

  const markAllRead = useCallback(async () => {
    const unread = (statesRef.current ?? []).filter((s) => s.status === "open" && !s.read);
    for (const s of unread) await update(s.id, { read: true });
  }, [update]);

  const savePrefs = useCallback(
    async (next: FinancePreferences) => {
      setPrefs(next);
      try {
        await db.saveFinPreferences(next);
        await db.log(newEvent("preferences_changed", null));
      } catch (err) {
        onError(`That didn't save. ${message(err)}`);
        void load();
      }
    },
    [load, onError],
  );

  const items = useMemo(() => (states ? actionItems(insights, states) : []), [insights, states]);
  const notifications = useMemo(() => notificationsFor(items, prefs ?? DEFAULT_PREFS), [items, prefs]);
  const dismissed = useMemo(() => (states ?? []).filter((s) => s.status === "dismissed"), [states]);

  const activity = useMemo(
    () =>
      buildActivity({
        events,
        states: states ?? [],
        transactions: finance.transactions,
        categories: finance.categories,
        goals: plans.goals,
        recurring: plans.recurring,
        budgets: plans.budgets,
      }),
    [events, states, finance.transactions, finance.categories, plans.goals, plans.recurring, plans.budgets],
  );

  /** Everything Ask needs, read from the same data as the screens. */
  const askContext: AskContext | null = useMemo(
    () =>
      finance.snapshot
        ? {
            today: finance.today,
            sample: finance.origin === "sample",
            transactions: finance.transactions,
            categories: finance.categories,
            accounts: finance.snapshot.accounts,
            institutions: new Map(finance.snapshot.institutions.map((i) => [i.id, i.name])),
            recurring: plans.recurring,
            budgets: plans.budgets,
            goals: plans.goals,
            contributions: plans.contributions,
            holdings: planning.holdings,
            history: finance.snapshot.balanceHistory,
            debtTerms: planning.debtTerms,
            planned: planning.planned,
          }
        : null,
    [finance.snapshot, finance.today, finance.origin, finance.transactions, finance.categories, plans.recurring, plans.budgets, plans.goals, plans.contributions, planning.holdings, planning.debtTerms, planning.planned],
  );

  return {
    ready,
    prefs: prefs ?? DEFAULT_PREFS,
    items,
    dismissed,
    notifications,
    unreadCount: notifications.filter((n) => !n.state.read).length,
    activity,
    askContext,
    dismiss,
    restore,
    markRead,
    hideNotification,
    markAllRead,
    savePrefs,
    reloadEvents,
  };
}

export type Intel = ReturnType<typeof useIntel>;
