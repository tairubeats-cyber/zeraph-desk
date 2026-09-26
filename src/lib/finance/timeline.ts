/**
 * The financial timeline: what happened, and what's scheduled to happen, in one date-ordered view.
 *
 * Two kinds of entry, never blurred: things that already happened come from your own transactions, goal deposits
 * and past findings (a FACT or a CALCULATION), and things ahead come from patterns and from plans you entered
 * (a PROJECTION: expected, not guaranteed). Nothing here forecasts a balance or invents an event; a date is only
 * on the timeline because a transaction, a repeating pattern, a planned item or a goal deadline puts it there.
 *
 * It picks what's worth a line so it stays readable: every income deposit, every recurring payment that posted,
 * and each month's few largest purchases and any that stand out. The Transactions screen still has all of them.
 */
import type { Basis, Category, Goal, GoalContribution, PlannedItem, RecurringPayment, ResolvedTransaction } from "./types";
import type { TxFilters } from "./filters";
import type { ViewKey } from "../../nav";
import { addDays, daysBetween, formatMoney, monthKey } from "./money";
import { upcoming } from "./cashflow";
import { FREQUENCY_LABELS, recurringKey } from "./recurring";
import { goalProgress } from "./goals";
import { unusualPurchases } from "./spending";

export type TimelineKind = "income" | "bill" | "transfer" | "purchase" | "goal" | "deadline" | "planned" | "finding";

/** The filter buttons on the screen: several kinds share one. */
export type TimelineGroup = "in" | "bills" | "purchases" | "plans" | "findings";

export const GROUP_OF: Record<TimelineKind, TimelineGroup> = {
  income: "in",
  bill: "bills",
  transfer: "bills",
  purchase: "purchases",
  goal: "plans",
  deadline: "plans",
  planned: "plans",
  finding: "findings",
};

export const GROUP_LABELS: Record<TimelineGroup, string> = {
  in: "Money in",
  bills: "Bills and payments",
  purchases: "Purchases",
  plans: "Plans and goals",
  findings: "Findings",
};

export const ALL_GROUPS: TimelineGroup[] = ["in", "bills", "purchases", "plans", "findings"];

/** Each month's largest purchases that get a line: this many, and never below this amount. */
export const PURCHASES_PER_MONTH = 3;
export const PURCHASE_FLOOR_CENTS = 5_000;

export type When = "earlier" | "today" | "ahead";

export interface TimelineEntry {
  id: string;
  date: string;
  when: When;
  kind: TimelineKind;
  title: string;
  /** One plain line under the title. */
  detail: string;
  /** Signed: money in is positive, money out is negative. null when the entry isn't an amount (a deadline, a finding). */
  amountCents: number | null;
  basis: Extract<Basis, "fact" | "calculation" | "projection">;
  /** The screen with the fuller picture, and any filter to open it with. */
  view: ViewKey;
  filters?: Partial<TxFilters>;
}

export interface FindingLine {
  id: string;
  title: string;
  summary: string;
  on: string;
  view: ViewKey;
}

export interface TimelineInput {
  today: string;
  transactions: ResolvedTransaction[];
  categories: Map<string, Category>;
  recurring: RecurringPayment[];
  planned: PlannedItem[];
  goals: Goal[];
  contributions: GoalContribution[];
  findings: FindingLine[];
  /** How far back and forward to look, in days. */
  pastDays: number;
  aheadDays: number;
}

function whenOf(date: string, today: string): When {
  return date < today ? "earlier" : date === today ? "today" : "ahead";
}

const name = (goal: Goal) => goal.name || "your goal";

export function buildTimeline(input: TimelineInput): TimelineEntry[] {
  const { today } = input;
  const from = addDays(today, -input.pastDays);
  const to = addDays(today, input.aheadDays);
  const cats = input.categories;
  const out: TimelineEntry[] = [];
  const add = (e: Omit<TimelineEntry, "when">) => out.push({ ...e, when: whenOf(e.date, today) });

  const recurringOut = new Map(input.recurring.filter((r) => r.direction === "out").map((r) => [r.key, r]));

  // ---- what happened -----------------------------------------------------------------------------------------
  const inWindow = input.transactions.filter((t) => t.date >= from && t.date <= today);
  const notable = new Set<string>();

  // Each month's largest purchases, leaving out payments that repeat (they get their own line).
  const purchasesByMonth = new Map<string, ResolvedTransaction[]>();
  for (const t of inWindow) {
    if (t.amountCents >= 0 || (cats.get(t.categoryId)?.kind ?? "expense") !== "expense" || recurringOut.has(recurringKey(t))) continue;
    const list = purchasesByMonth.get(monthKey(t.date)) ?? [];
    list.push(t);
    purchasesByMonth.set(monthKey(t.date), list);
  }
  for (const list of purchasesByMonth.values()) {
    list
      .filter((t) => -t.amountCents >= PURCHASE_FLOOR_CENTS)
      .sort((a, b) => a.amountCents - b.amountCents || a.id.localeCompare(b.id))
      .slice(0, PURCHASES_PER_MONTH)
      .forEach((t) => notable.add(t.id));
  }
  // Anything that stands out for its category, wherever it ranks.
  const standout = new Map<string, number>();
  for (const m of new Set(inWindow.map((t) => monthKey(t.date)))) {
    for (const u of unusualPurchases(input.transactions, cats, m, 31, null)) if (u.date >= from && u.date <= today) standout.set(u.id, u.times);
  }
  for (const id of standout.keys()) notable.add(id);

  for (const t of inWindow) {
    const kind = cats.get(t.categoryId)?.kind ?? "expense";
    const category = cats.get(t.categoryId)?.name ?? "Other";
    if (kind === "income") {
      add({ id: `tx-${t.id}`, date: t.date, kind: "income", title: t.merchant, detail: `${category} · money in`, amountCents: t.amountCents, basis: "fact", view: "transactions", filters: { query: t.merchant, period: "all" } });
      continue;
    }
    const rec = recurringOut.get(recurringKey(t));
    if (rec && t.amountCents < 0) {
      add({
        id: `tx-${t.id}`,
        date: t.date,
        kind: rec.kind === "transfer" ? "transfer" : "bill",
        title: t.merchant,
        detail: `${FREQUENCY_LABELS[rec.frequency]}${rec.kind === "transfer" ? " · to your own account" : ""}`,
        amountCents: t.amountCents,
        basis: "fact",
        view: "transactions",
        filters: { query: t.merchant, period: "all" },
      });
      continue;
    }
    if (notable.has(t.id)) {
      const times = standout.get(t.id);
      add({
        id: `tx-${t.id}`,
        date: t.date,
        kind: "purchase",
        title: t.merchant,
        detail: times ? `${category} · about ${Math.round(times * 10) / 10}× the usual purchase there` : `${category} · one of the month's largest`,
        amountCents: t.amountCents,
        basis: times ? "calculation" : "fact",
        view: "transactions",
        filters: { query: t.merchant, period: "all" },
      });
    }
  }

  // Money set aside toward a goal.
  const goalById = new Map(input.goals.map((g) => [g.id, g]));
  for (const c of input.contributions) {
    const g = goalById.get(c.goalId);
    if (!g || c.date < from || c.date > today) continue;
    add({ id: `gc-${c.id}`, date: c.date, kind: "goal", title: `Set aside for ${name(g)}`, detail: "A deposit you recorded", amountCents: c.amountCents, basis: "fact", view: "goals" });
  }

  // Findings that are already true. A finding dated in the future is a bill or a due date, which the schedule below already has.
  for (const f of input.findings) {
    if (f.on < from || f.on > today) continue;
    add({ id: `fd-${f.id}`, date: f.on, kind: "finding", title: f.title, detail: f.summary, amountCents: null, basis: "calculation", view: f.view });
  }

  // A goal whose deadline has passed unmet.
  for (const g of input.goals) {
    if (!g.deadline || g.deadline < from || g.deadline >= today) continue;
    const p = goalProgress(g, input.contributions, today);
    if (p.reached) continue;
    add({ id: `gd-${g.id}`, date: g.deadline, kind: "deadline", title: `Deadline for ${name(g)}`, detail: `${formatMoney(p.currentCents)} of ${formatMoney(g.targetCents)} was set aside by then`, amountCents: null, basis: "fact", view: "goals" });
  }

  // ---- what's scheduled ------------------------------------------------------------------------------------------
  const tomorrow = addDays(today, 1);
  const ahead = upcoming(input.recurring, today, input.aheadDays).occurrences.filter((o) => o.date >= today && o.date <= to);
  for (const { date, payment: p } of ahead) {
    const income = p.direction === "in";
    // What happens today may already be in the transactions above; the schedule adds only the days still to come.
    if (date < tomorrow && inWindow.some((t) => recurringKey(t) === p.key && t.date === date)) continue;
    add({
      id: `rc-${p.key}-${date}`,
      date,
      kind: income ? "income" : p.kind === "transfer" ? "transfer" : "bill",
      title: p.merchant,
      detail: `${FREQUENCY_LABELS[p.frequency]}${p.variable ? " · usually about this much" : ""}${!income && p.kind === "transfer" ? " · to your own account" : ""}`,
      amountCents: income ? p.amountCents : -p.amountCents,
      basis: "projection",
      view: income ? "cash-flow" : "bills",
    });
  }

  for (const p of input.planned) {
    if (p.date < today || p.date > to) continue;
    add({ id: `pl-${p.id}`, date: p.date, kind: "planned", title: p.name, detail: "You planned this", amountCents: p.direction === "in" ? p.amountCents : -p.amountCents, basis: "projection", view: "forecast" });
  }

  for (const g of input.goals) {
    if (!g.deadline || g.deadline < today || g.deadline > to) continue;
    const p = goalProgress(g, input.contributions, today);
    if (p.reached) continue;
    add({
      id: `gd-${g.id}`,
      date: g.deadline,
      kind: "deadline",
      title: `Deadline for ${name(g)}`,
      detail: `${formatMoney(p.remainingCents)} still to set aside${p.finishesByDeadline === false ? ", more than the current rate covers" : ""}`,
      amountCents: null,
      basis: "projection",
      view: "goals",
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || Math.abs(b.amountCents ?? 0) - Math.abs(a.amountCents ?? 0) || a.id.localeCompare(b.id));
}

/** Only the kinds the person has left switched on. */
export function filterTimeline(entries: TimelineEntry[], groups: Set<TimelineGroup>): TimelineEntry[] {
  return entries.filter((e) => groups.has(GROUP_OF[e.kind]));
}

export interface TimelineSections {
  /** Soonest first. */
  ahead: TimelineEntry[];
  today: TimelineEntry[];
  /** Most recent first. */
  earlier: TimelineEntry[];
}

export function sections(entries: TimelineEntry[]): TimelineSections {
  return {
    ahead: entries.filter((e) => e.when === "ahead"),
    today: entries.filter((e) => e.when === "today"),
    earlier: entries.filter((e) => e.when === "earlier").reverse(),
  };
}

export interface DayGroup {
  date: string;
  entries: TimelineEntry[];
}

export function byDay(entries: TimelineEntry[]): DayGroup[] {
  const out: DayGroup[] = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    if (last && last.date === e.date) last.entries.push(e);
    else out.push({ date: e.date, entries: [e] });
  }
  return out;
}

/** "Tomorrow", "In 5 days", "Yesterday", "5 days ago". */
export function relativeDay(date: string, today: string): string {
  const d = daysBetween(today, date);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  return d > 0 ? `In ${d} days` : `${-d} days ago`;
}

export interface AheadTotals {
  count: number;
  inCents: number;
  outCents: number;
}

/** What the schedule expects, in and out, over what's on screen. A projection: expected, not guaranteed. */
export function aheadTotals(entries: TimelineEntry[]): AheadTotals {
  const a = entries.filter((e) => e.when === "ahead");
  return {
    count: a.length,
    inCents: a.reduce((s, e) => s + ((e.amountCents ?? 0) > 0 ? (e.amountCents ?? 0) : 0), 0),
    outCents: a.reduce((s, e) => s + ((e.amountCents ?? 0) < 0 ? -(e.amountCents ?? 0) : 0), 0),
  };
}
