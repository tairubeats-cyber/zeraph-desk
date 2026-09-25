import type { Category, RecurringPayment, ResolvedTransaction } from "./types";
import { dayOfMonth, daysInMonth, endOfMonth, monthKey, shiftMonth } from "./money";
import { spendingByCategory } from "./analysis";
import { occurrencesBetween, recurringKey } from "./recurring";

export interface BudgetRow {
  categoryId: string;
  /** null when the category has no budget yet. */
  budgetCents: number | null;
  /** CALCULATION: what has actually been spent this month. */
  actualCents: number;
  /** budget - actual; negative means over. null without a budget. */
  remainingCents: number | null;
  /** PROJECTION: see `projectMonthEnd`. */
  projectedCents: number;
}

/**
 * Where a category's spending is likely to land by month end. Three parts,
 * each simple enough to explain to the person looking at it:
 *   1. what has been spent so far,
 *   2. recurring payments in the category that haven't shown up yet this month,
 *   3. the daily pace of everything else so far, carried through to month end.
 * Recurring payments are kept out of the pace so rent on the 1st doesn't
 * multiply into a huge projection. It's an estimate, and shown as one.
 */
export function projectMonthEnd(input: {
  actualCents: number;
  recurringPaidCents: number;
  recurringLeftCents: number;
  today: string;
}): number {
  const day = dayOfMonth(input.today);
  const [y, m] = input.today.split("-").map(Number);
  const daysLeft = daysInMonth(y, m) - day;
  const discretionary = Math.max(0, input.actualCents - input.recurringPaidCents);
  // Very early in the month a couple of purchases would otherwise be stretched over 30 days.
  const pace = (discretionary / Math.max(day, 7)) * daysLeft;
  return Math.round(input.actualCents + input.recurringLeftCents + pace);
}

export function budgetRows(
  txs: ResolvedTransaction[],
  categories: Category[],
  recurring: RecurringPayment[],
  budgets: Map<string, number>,
  today: string,
): BudgetRow[] {
  const month = monthKey(today);
  const monthStart = `${month}-01`;
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const actual = new Map(spendingByCategory(txs, catMap, month).map((r) => [r.categoryId, r.cents]));
  const recurringKeys = new Set(recurring.map((r) => r.key));

  const paid = new Map<string, number>();
  for (const t of txs) {
    if (monthKey(t.date) !== month || t.amountCents >= 0) continue;
    if (!recurringKeys.has(recurringKey(t))) continue;
    paid.set(t.categoryId, (paid.get(t.categoryId) ?? 0) - t.amountCents);
  }

  const left = new Map<string, number>();
  for (const r of recurring) {
    if (r.direction !== "out" || r.kind !== "expense") continue;
    for (const o of occurrencesBetween(r, monthStart, endOfMonth(today))) {
      left.set(r.categoryId, (left.get(r.categoryId) ?? 0) + o.payment.amountCents);
    }
  }

  return categories
    .filter((c) => c.kind === "expense" && (!c.hidden || budgets.has(c.id) || (actual.get(c.id) ?? 0) > 0))
    .map((c) => {
      const spent = actual.get(c.id) ?? 0;
      const budget = budgets.get(c.id) ?? null;
      return {
        categoryId: c.id,
        budgetCents: budget,
        actualCents: spent,
        remainingCents: budget === null ? null : budget - spent,
        projectedCents: projectMonthEnd({
          actualCents: spent,
          recurringPaidCents: paid.get(c.id) ?? 0,
          recurringLeftCents: left.get(c.id) ?? 0,
          today,
        }),
      };
    });
}

/** Average monthly spend per category over the last `months` complete months, for pre-filling budgets. */
export function averageMonthlySpend(
  txs: ResolvedTransaction[],
  categories: Map<string, Category>,
  today: string,
  months = 3,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (let i = 1; i <= months; i++) {
    for (const row of spendingByCategory(txs, categories, shiftMonth(monthKey(today), -i))) {
      totals.set(row.categoryId, (totals.get(row.categoryId) ?? 0) + row.cents);
    }
  }
  // Round to whole dollars: a budget of $412.67 reads as false precision.
  return new Map([...totals].map(([id, cents]) => [id, Math.round(cents / months / 100) * 100]));
}
