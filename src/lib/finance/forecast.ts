/**
 * The cash forecast: a PROJECTION of the balance in the accounts you spend
 * from, built from what's expected rather than what's guaranteed.
 *
 * It starts from today's balance in checking and cash accounts, then applies,
 * on their expected dates:
 *   - recurring income, bills, subscriptions and debt payments that hit those accounts,
 *   - recurring transfers out of them (savings, investing, card payments),
 *   - one-off items the user planned,
 *   - optionally, a steady estimate of everyday spending.
 *
 * Purchases made on a credit card aren't listed one by one: they reach the
 * cash accounts as the card payment, which is already a recurring transfer.
 * Counting both would count the same money twice.
 */
import {
  ACCOUNT_KINDS,
  type Category,
  type FinancialAccount,
  type PlannedItem,
  type RecurringPayment,
  type ResolvedTransaction,
} from "./types";
import { addDays, daysBetween, monthKey, shiftMonth } from "./money";
import { occurrencesBetween, recurringKey } from "./recurring";

export type ForecastKind = "income" | "bill" | "subscription" | "debt" | "transfer" | "planned";

export const FORECAST_KIND_LABELS: Record<ForecastKind, string> = {
  income: "Income",
  bill: "Bills",
  subscription: "Subscriptions",
  debt: "Debt payments",
  transfer: "Transfers and card payments",
  planned: "Planned by you",
};

export interface ForecastEvent {
  date: string;
  label: string;
  /** Signed: money in is positive, money out is negative. */
  amountCents: number;
  kind: ForecastKind;
  /** True when the amount moves around from month to month, so this figure is an estimate of an estimate. */
  variable: boolean;
}

export interface ForecastPoint {
  date: string;
  balanceCents: number;
}

export interface Forecast {
  /** The accounts the forecast is about. */
  accounts: FinancialAccount[];
  startCents: number;
  endCents: number;
  days: number;
  /** End-of-day balance from today to the last day. */
  points: ForecastPoint[];
  /** Every dated item, oldest first. Everyday spending isn't in here; it's one steady line. */
  events: ForecastEvent[];
  /** Estimated everyday spending over the whole period, as a positive amount; 0 when it's off. */
  everydayCents: number;
  lowest: ForecastPoint;
  /** The first day the projected balance is below zero, if it gets there. */
  firstBelowZero: string | null;
  totals: Record<ForecastKind, number>;
  /** Things worth knowing about how the forecast was built. */
  notes: string[];
}

/** Checking and cash: the accounts money is spent from. Savings and investments are excluded on purpose. */
export function spendingAccounts(accounts: FinancialAccount[]): FinancialAccount[] {
  return accounts.filter((a) => a.kind === "checking" || a.kind === "cash");
}

function kindOf(p: RecurringPayment): ForecastKind {
  if (p.direction === "in") return "income";
  if (p.kind === "transfer") return "transfer";
  if (p.categoryId === "debt") return "debt";
  return p.isBill ? "bill" : "subscription";
}

/**
 * Average daily spending on `scope` accounts that isn't one of the recurring
 * payments, over the last three complete months. This is what groceries, fuel
 * and the like look like from the cash accounts' point of view.
 */
export function everydayDailyCents(
  txs: ResolvedTransaction[],
  categories: Map<string, Category>,
  recurring: RecurringPayment[],
  scope: Set<string>,
  today: string,
): { dailyCents: number; months: number } {
  const current = monthKey(today);
  const wanted = new Set([1, 2, 3].map((k) => shiftMonth(current, -k)));
  const recurringOut = new Set(recurring.filter((r) => r.direction === "out").map((r) => r.key));
  let total = 0;
  const seen = new Set<string>();
  for (const t of txs) {
    const m = monthKey(t.date);
    if (!wanted.has(m) || !scope.has(t.accountId)) continue;
    seen.add(m);
    if (categories.get(t.categoryId)?.kind !== "expense") continue;
    if (recurringOut.has(recurringKey(t))) continue;
    total -= t.amountCents;
  }
  if (seen.size === 0) return { dailyCents: 0, months: 0 };
  // Days in the months that actually had activity, so a short history isn't diluted.
  const days = [...seen].reduce((s, m) => {
    const [y, mo] = m.split("-").map(Number);
    return s + new Date(y, mo, 0).getDate();
  }, 0);
  return { dailyCents: Math.round(total / days), months: seen.size };
}

export function buildForecast(input: {
  today: string;
  days: number;
  accounts: FinancialAccount[];
  transactions: ResolvedTransaction[];
  categories: Map<string, Category>;
  recurring: RecurringPayment[];
  planned: PlannedItem[];
  includeEveryday: boolean;
}): Forecast | null {
  const { today, days, transactions, categories, recurring, planned } = input;
  const accounts = spendingAccounts(input.accounts);
  if (accounts.length === 0) return null;
  const scope = new Set(accounts.map((a) => a.id));
  const end = addDays(today, days);

  const txById = new Map(transactions.map((t) => [t.id, t]));
  const notes: string[] = [];
  const events: ForecastEvent[] = [];
  const lateNames: string[] = [];
  let onCard = 0;
  let elsewhere = 0;

  for (const r of recurring) {
    if (r.status === "cancelled" || r.possiblyStopped) continue;
    // Where the payment actually leaves from: the account of its latest transaction. A payment
    // added by hand has none, and is taken to be from the accounts being forecast.
    const from = r.txIds.length ? txById.get(r.txIds[0])?.accountId : undefined;
    if (from && !scope.has(from)) {
      const account = input.accounts.find((a) => a.id === from);
      if (account && ACCOUNT_KINDS[account.kind].class === "liability") onCard++;
      else elsewhere++;
      continue;
    }
    if (r.nextDate < today) {
      lateNames.push(r.merchant);
      continue;
    }
    for (const o of occurrencesBetween(r, today, end)) {
      events.push({
        date: o.date,
        label: r.merchant,
        amountCents: r.direction === "in" ? r.amountCents : -r.amountCents,
        kind: kindOf(r),
        variable: r.variable,
      });
    }
  }

  for (const p of planned) {
    if (p.date < today || p.date > end) continue;
    events.push({
      date: p.date,
      label: p.name,
      amountCents: p.direction === "in" ? p.amountCents : -p.amountCents,
      kind: "planned",
      variable: false,
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.amountCents - b.amountCents);

  const startCents = accounts.reduce((s, a) => s + a.balanceCents, 0);
  const daily = input.includeEveryday ? everydayDailyCents(transactions, categories, recurring, scope, today) : null;
  const dailyCents = daily?.dailyCents ?? 0;

  const byDate = new Map<string, number>();
  for (const e of events) byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.amountCents);

  const points: ForecastPoint[] = [];
  let running = startCents;
  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i);
    running += byDate.get(date) ?? 0;
    // Everyday spending starts tomorrow; today's has already happened.
    points.push({ date, balanceCents: running - dailyCents * i });
  }

  const totals: Record<ForecastKind, number> = { income: 0, bill: 0, subscription: 0, debt: 0, transfer: 0, planned: 0 };
  for (const e of events) totals[e.kind] += e.amountCents;

  const lowest = points.reduce((low, p) => (p.balanceCents < low.balanceCents ? p : low), points[0]);
  const firstBelowZero = points.find((p) => p.balanceCents < 0)?.date ?? null;

  if (onCard > 0) {
    notes.push(
      `${onCard} ${onCard === 1 ? "payment is" : "payments are"} charged to a credit card, so ${
        onCard === 1 ? "it reaches" : "they reach"
      } these accounts through the card payment rather than on its own.`,
    );
  }
  if (elsewhere > 0) {
    notes.push(`${elsewhere} recurring ${elsewhere === 1 ? "item is" : "items are"} in accounts this forecast doesn't cover.`);
  }
  if (lateNames.length > 0) {
    notes.push(
      `Expected but not seen yet, and left out: ${lateNames.slice(0, 3).join(", ")}${lateNames.length > 3 ? ` and ${lateNames.length - 3} more` : ""}.`,
    );
  }
  if (input.includeEveryday && daily && daily.months === 0) {
    notes.push("There isn't enough past spending on these accounts to estimate everyday spending, so none is included.");
  } else if (daily && daily.months < 3) {
    notes.push(`Everyday spending is estimated from ${daily.months} complete ${daily.months === 1 ? "month" : "months"} of history.`);
  }

  return {
    accounts,
    startCents,
    endCents: points[points.length - 1].balanceCents,
    days,
    points,
    events,
    everydayCents: dailyCents * days,
    lowest,
    firstBelowZero,
    totals,
    notes,
  };
}

/** How many days from today until `date`, for wording. */
export function daysFromToday(date: string, today: string): number {
  return daysBetween(today, date);
}
