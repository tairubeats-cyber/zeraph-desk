import type { Category, RecurringPayment, ResolvedTransaction } from "./types";
import { addDays, monthKey, recentMonthKeys, shiftMonth } from "./money";
import { flowForMonth, type Flow } from "./analysis";
import { occurrencesBetween, recurringKey, type Occurrence } from "./recurring";

export interface MonthFlow extends Flow {
  month: string;
  /** Surplus as a share of income; null when there was no income to divide by. */
  savingsRate: number | null;
}

export function monthlyFlows(
  txs: ResolvedTransaction[],
  categories: Map<string, Category>,
  today: string,
  count = 6,
): MonthFlow[] {
  return recentMonthKeys(today, count).map((month) => {
    const f = flowForMonth(txs, categories, month);
    return { month, ...f, savingsRate: f.incomeCents > 0 ? f.surplusCents / f.incomeCents : null };
  });
}

/** The complete months only; the current month is still filling in. */
export function completeMonths(flows: MonthFlow[], today: string): MonthFlow[] {
  return flows.filter((f) => f.month < monthKey(today));
}

export function average(xs: number[]): number {
  return xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0;
}

export interface SpendingSplit {
  /** Average monthly spending that matches a recurring pattern (rent, loans, subscriptions). */
  recurringCents: number;
  /** Everything else: groceries, dining, fuel, one-off purchases. */
  otherCents: number;
}

/** CALCULATION: how much of a typical month's spending was already spoken for by recurring payments. */
export function spendingSplit(
  txs: ResolvedTransaction[],
  categories: Map<string, Category>,
  recurring: RecurringPayment[],
  today: string,
  months = 3,
): SpendingSplit {
  const keys = new Set(recurring.filter((r) => r.direction === "out").map((r) => r.key));
  const wanted = new Set(Array.from({ length: months }, (_, i) => shiftMonth(monthKey(today), -(i + 1))));
  let recurringTotal = 0;
  let otherTotal = 0;
  for (const t of txs) {
    if (!wanted.has(monthKey(t.date)) || categories.get(t.categoryId)?.kind !== "expense") continue;
    const spend = -t.amountCents;
    if (keys.has(recurringKey(t))) recurringTotal += spend;
    else otherTotal += spend;
  }
  return { recurringCents: Math.round(recurringTotal / months), otherCents: Math.round(otherTotal / months) };
}

export interface Upcoming {
  occurrences: Occurrence[];
  /** Expected bills and subscriptions (spending). */
  spendingCents: number;
  /** Expected payments to your own accounts: card payments, savings, investing. */
  transfersOutCents: number;
  /** Expected income. */
  incomeCents: number;
}

/**
 * PROJECTION: what the recurring patterns expect over the next `days`. This is
 * only what's known from patterns. One-off spending isn't in it, and none of
 * it is guaranteed to happen on that day or for that amount.
 */
export function upcoming(recurring: RecurringPayment[], today: string, days: number): Upcoming {
  const to = addDays(today, days);
  const occurrences = recurring
    .flatMap((r) => occurrencesBetween(r, today, to))
    .sort((a, b) => a.date.localeCompare(b.date) || b.payment.amountCents - a.payment.amountCents);
  const total = { spendingCents: 0, transfersOutCents: 0, incomeCents: 0 };
  for (const { payment: p } of occurrences) {
    if (p.direction === "in") total.incomeCents += p.amountCents;
    else if (p.kind === "expense") total.spendingCents += p.amountCents;
    else total.transfersOutCents += p.amountCents;
  }
  return { occurrences, ...total };
}
