/**
 * Turns findings (from `insights.ts`) into the three things people see: the
 * Action Center, notifications and the Activity feed. All pure functions; the
 * hook in `useIntel.ts` does the reading and writing.
 *
 * A finding is recomputed from the data every time. What's stored per finding
 * is only its state: whether the person dismissed it or read it, and when it
 * was first noticed. That's what lets a dismissal survive a restart and the
 * feed say "noticed on Tuesday" without keeping the finding itself.
 */
import type { ViewKey } from "../../nav";
import type { Category, Goal, RecurringPayment, ResolvedTransaction } from "./types";
import type { TxFilters } from "./filters";
import type { Event } from "../events";
import type { Insight, Severity } from "./insights";
import type { DetectorId, FinancePreferences, NotificationCategory } from "./prefs";
import { fingerprint } from "./fingerprint";
import { formatMoney } from "./money";

export type InsightStatus = "open" | "dismissed" | "resolved";

export interface InsightState {
  id: string;
  detector: DetectorId;
  severity: Severity;
  category: NotificationCategory;
  /** As first shown, so the Activity feed can read it back later. */
  title: string;
  summary: string;
  firstSeenAt: string;
  status: InsightStatus;
  read: boolean;
  /** Hidden from the notification list only; it stays in the Action Center. */
  notifHidden: boolean;
  /** Already shown as a system notification, so it isn't shown twice. */
  osNotified: boolean;
  updatedAt: string;
}

export interface SyncPlan {
  /** Every state after applying the plan. */
  next: InsightState[];
  /** Only the rows that need writing. */
  write: InsightState[];
  detected: InsightState[];
  reopened: InsightState[];
}

/**
 * Compare what's detected now with what's stored.
 *   - new finding: stored as open and unread;
 *   - a finding that had cleared up and is back: reopened as unread;
 *   - an open finding that has cleared up: marked resolved (kept for the feed), unless
 *     its detector has been switched off, in which case it's left alone;
 *   - a dismissed finding stays dismissed, whether or not it's still true.
 * Titles and summaries are left as first shown, so a finding whose wording
 * changes with the date ("in 3 days") doesn't rewrite itself every day.
 */
export function planSync(
  current: Insight[],
  states: InsightState[],
  now: string,
  /** Detectors that are switched on. A finding from one that's switched off isn't "cleared", just not being checked. */
  watching?: ReadonlySet<DetectorId>,
): SyncPlan {
  const byId = new Map(states.map((s) => [s.id, s]));
  const detected: InsightState[] = [];
  const reopened: InsightState[] = [];
  const write: InsightState[] = [];
  const seen = new Set<string>();

  for (const i of current) {
    seen.add(i.id);
    const existing = byId.get(i.id);
    if (!existing) {
      const s: InsightState = {
        id: i.id,
        detector: i.detector,
        severity: i.severity,
        category: i.category,
        title: i.title,
        summary: i.summary,
        firstSeenAt: now,
        status: "open",
        read: false,
        notifHidden: false,
        osNotified: false,
        updatedAt: now,
      };
      byId.set(i.id, s);
      detected.push(s);
      write.push(s);
    } else if (existing.status === "resolved") {
      const s: InsightState = {
        ...existing,
        title: i.title,
        summary: i.summary,
        firstSeenAt: now,
        status: "open",
        read: false,
        notifHidden: false,
        osNotified: false,
        updatedAt: now,
      };
      byId.set(i.id, s);
      reopened.push(s);
      write.push(s);
    }
  }

  for (const s of [...byId.values()]) {
    if (s.status === "open" && !seen.has(s.id) && (!watching || watching.has(s.detector))) {
      const resolved: InsightState = { ...s, status: "resolved", updatedAt: now };
      byId.set(s.id, resolved);
      write.push(resolved);
    }
  }

  return { next: [...byId.values()], write, detected, reopened };
}

export interface ActionItem {
  insight: Insight;
  state: InsightState;
}

/** Findings that are currently true and not dismissed, in the order detection gave them. */
export function actionItems(current: Insight[], states: InsightState[]): ActionItem[] {
  const byId = new Map(states.map((s) => [s.id, s]));
  return current.flatMap((insight) => {
    const state = byId.get(insight.id);
    return state && state.status === "open" ? [{ insight, state }] : [];
  });
}

/** Notifications are open findings whose category is switched on and that haven't been cleared from the list. Unread first, then newest. */
export function notificationsFor(items: ActionItem[], prefs: FinancePreferences): ActionItem[] {
  return items
    .filter((i) => prefs.notify[i.state.category] && !i.state.notifHidden)
    .sort((a, b) => Number(a.state.read) - Number(b.state.read) || b.state.firstSeenAt.localeCompare(a.state.firstSeenAt));
}

// ------------------------------------------------------------------ activity

export interface ActivityItem {
  id: string;
  /** ISO time. */
  at: string;
  kind: "detected" | "dismissed" | "recategorized" | "budget" | "goal" | "contribution" | "recurring";
  title: string;
  detail?: string;
  view?: ViewKey;
  filters?: Partial<TxFilters>;
}

/** The kinds of logged event the feed reads. Email-desk events aren't part of the financial feed. */
export const FEED_EVENT_KINDS = [
  "transaction_recategorized",
  "budget_changed",
  "goal_created",
  "goal_contribution_added",
  "recurring_marked",
] as const;

const VIEW_FOR: Record<NotificationCategory, ViewKey> = {
  money: "action-center",
  bills: "bills",
  goals: "goals",
  investments: "investments",
  security: "action-center",
  system: "action-center",
};

/**
 * What happened, newest first. The event log holds only ids, so names and
 * amounts are looked up from the current data; when the thing has since been
 * deleted the entry falls back to a generic line instead of guessing.
 */
export function buildActivity(input: {
  events: Event[];
  states: InsightState[];
  transactions: ResolvedTransaction[];
  categories: Category[];
  goals: Goal[];
  recurring: RecurringPayment[];
  budgets: Map<string, number>;
}): ActivityItem[] {
  const { events, states, transactions, categories, goals, recurring, budgets } = input;
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const tx = new Map(transactions.map((t) => [t.id, t]));
  const goal = new Map(goals.map((g) => [g.id, g]));
  const rec = new Map(recurring.map((r) => [fingerprint(r.key, "rec"), r]));

  const items: ActivityItem[] = [];

  for (const s of states) {
    items.push({
      id: `found:${s.id}:${s.firstSeenAt}`,
      at: s.firstSeenAt,
      kind: "detected",
      title: s.title,
      detail: s.summary,
      view: VIEW_FOR[s.category],
    });
    if (s.status === "dismissed") {
      items.push({ id: `dismissed:${s.id}`, at: s.updatedAt, kind: "dismissed", title: "You dismissed a finding", detail: s.title, view: "action-center" });
    }
  }

  // The most recent change to each budget, so the current amount is only claimed where it's still true.
  const latestBudgetEvent = new Map<string, string>();
  for (const e of events) {
    if (e.kind === "budget_changed" && e.subjectId && !latestBudgetEvent.has(e.subjectId)) latestBudgetEvent.set(e.subjectId, e.id);
  }

  for (const e of events) {
    const subject = e.subjectId ?? "";
    switch (e.kind) {
      case "transaction_recategorized": {
        const t = tx.get(subject);
        const to = cat.get(String(e.meta.categoryId ?? ""));
        items.push({
          id: e.id,
          at: e.at,
          kind: "recategorized",
          title: t ? `Recategorized ${t.merchant}` : "Recategorized a transaction",
          detail: to ? `Now in ${to}` : undefined,
          view: "transactions",
          filters: t ? { query: t.merchant, period: "all" } : undefined,
        });
        break;
      }
      case "budget_changed": {
        const amount = budgets.get(subject);
        const isLatest = latestBudgetEvent.get(subject) === e.id;
        items.push({
          id: e.id,
          at: e.at,
          kind: "budget",
          title: `Budget changed: ${cat.get(subject) ?? "a category"}`,
          detail: isLatest ? (amount === undefined ? "No budget now" : `${formatMoney(amount)} a month now`) : undefined,
          view: "budgets",
        });
        break;
      }
      case "goal_created": {
        items.push({ id: e.id, at: e.at, kind: "goal", title: `New goal: ${goal.get(subject)?.name ?? "a goal"}`, view: "goals" });
        break;
      }
      case "goal_contribution_added": {
        items.push({ id: e.id, at: e.at, kind: "contribution", title: `Added to ${goal.get(subject)?.name ?? "a goal"}`, view: "goals" });
        break;
      }
      case "recurring_marked": {
        const r = rec.get(subject);
        items.push({ id: e.id, at: e.at, kind: "recurring", title: r ? `Updated ${r.merchant}` : "Updated a recurring payment", view: "recurring" });
        break;
      }
      default:
        break;
    }
  }

  return items.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}
