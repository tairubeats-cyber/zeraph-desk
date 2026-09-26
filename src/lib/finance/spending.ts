/**
 * Spending analysis: where the money went, how that compares with earlier, who it went to, and what stands out.
 * Pure functions over resolved transactions. Every figure is a CALCULATION on what the accounts reported; nothing
 * here forecasts, and nothing judges. Wording elsewhere stays neutral ("$88 more than", never "you overspent").
 *
 * Two rules keep comparisons honest:
 *  - A month still in progress is compared with the same stretch of the earlier month (through the same day of
 *    the month), never against a whole one.
 *  - A year-over-year figure needs data from a year ago. If the transactions don't reach back that far the answer
 *    is "not available", never zero.
 */
import type { Category, ResolvedTransaction } from "./types";
import { dayOfMonth, formatMoney, friendlyDate, monthKey, monthYearLabel, shiftMonth } from "./money";
import { spendingByCategory } from "./analysis";

/** A purchase is unusual when it's at least this much and this many times the usual one for its category. */
export const UNUSUAL_MIN_CENTS = 10_000;
export const UNUSUAL_FACTOR = 3;
/** Fewer earlier purchases than this and there's no "usual" to compare with. */
export const UNUSUAL_MIN_HISTORY = 4;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** How far into `month` to look: the current month up to today, any earlier month in full. */
export function stretchFor(month: string, today: string): { throughDay: number; partial: boolean } {
  const partial = month === monthKey(today);
  return { throughDay: partial ? dayOfMonth(today) : 31, partial };
}

/** The date of the earliest transaction, or null with none. */
export function earliestDate(txs: ResolvedTransaction[]): string | null {
  let min: string | null = null;
  for (const t of txs) if (min === null || t.date < min) min = t.date;
  return min;
}

/**
 * Whether the transactions cover all of `month`. True when there is data from an earlier month, so `month` isn't
 * the one the history starts in part-way through. This is deliberately strict: it's better to say "not enough
 * history" than to compare against a month that's only partly there.
 */
export function coversMonth(txs: ResolvedTransaction[], month: string): boolean {
  const first = earliestDate(txs);
  return first !== null && monthKey(first) < month;
}

/** How many calendar months from the first transaction to `today`, counting both. */
export function monthsOfHistory(txs: ResolvedTransaction[], today: string): number {
  const first = earliestDate(txs);
  if (first === null) return 0;
  let n = 0;
  for (let m = monthKey(first); m <= monthKey(today); m = shiftMonth(m, 1)) n++;
  return n;
}

export interface Change {
  /** This minus that, in cents. */
  cents: number;
  /** As a fraction of that (0.1 is 10% more); null when that was zero, since a percentage of nothing means nothing. */
  fraction: number | null;
}

export function change(now: number, before: number): Change {
  return { cents: now - before, fraction: before > 0 ? (now - before) / before : null };
}

const MINUS = "−";

/** "+$120 (12%)", "−$120 (12%)" or "no change": a change in a few characters, for a list. */
export function signedChange(c: Change): string {
  if (c.cents === 0) return "no change";
  const pct = c.fraction === null ? "" : ` (${Math.abs(Math.round(c.fraction * 100))}%)`;
  return `${c.cents > 0 ? "+" : MINUS}${formatMoney(Math.abs(c.cents))}${pct}`;
}

/** "$120 more than", "$120 less than" or "the same as": a change as words, followed by whatever it's compared with. */
export function changePhrase(c: Change): string {
  if (c.cents === 0) return "the same as";
  const pct = c.fraction === null ? "" : ` (${Math.abs(Math.round(c.fraction * 100))}%)`;
  return `${formatMoney(Math.abs(c.cents))}${pct} ${c.cents > 0 ? "more than" : "less than"}`;
}

/** Why there's no comparison with a year earlier, in words that name the month and the first date there is data for. */
export function yearUnavailableReason(report: Pick<SpendingReport, "yearAgoMonth" | "earliest">): string {
  if (report.earliest === null) return "No transactions are loaded to compare.";
  return `Nothing is loaded from ${monthYearLabel(report.yearAgoMonth)} to compare with; the earliest transaction is from ${friendlyDate(report.earliest)}.`;
}

export interface CategoryLine {
  categoryId: string;
  cents: number;
  count: number;
  /** Share of the month's total spending, 0 to 1. */
  share: number;
  /** Against the same stretch of the month before. */
  vsPreviousMonth: (Change & { previousCents: number }) | null;
  /** Against the same month a year earlier; null when the history doesn't reach back that far. */
  vsPreviousYear: (Change & { previousCents: number }) | null;
}

export interface SpendingReport {
  month: string;
  throughDay: number;
  /** The month is still going, so it's compared with the same stretch of earlier ones. */
  partial: boolean;
  totalCents: number;
  previousMonth: { month: string; totalCents: number; change: Change } | null;
  previousYear: { month: string; totalCents: number; change: Change } | null;
  /** Whether a year-over-year comparison is possible at all with the transactions loaded. */
  yearComparisonAvailable: boolean;
  /** The month a year earlier, and the date of the first transaction loaded, so a screen can say exactly what's missing. */
  yearAgoMonth: string;
  earliest: string | null;
  lines: CategoryLine[];
  /** Calendar months the transactions span, so a screen can say how much history it has. */
  monthsOfData: number;
}

/**
 * Spending for one month, by category, with change against the month before and a year before.
 * Refunds reduce spending, and transfers (card payments, investing) aren't spending at all.
 */
export function spendingReport(
  txs: ResolvedTransaction[],
  cats: Map<string, Category>,
  month: string,
  today: string,
): SpendingReport {
  const { throughDay, partial } = stretchFor(month, today);
  const prevMonth = shiftMonth(month, -1);
  const prevYear = shiftMonth(month, -12);

  const now = spendingByCategory(txs, cats, month, throughDay);
  const total = now.reduce((s, r) => s + r.cents, 0);

  const monthAvailable = coversMonth(txs, prevMonth);
  const yearAvailable = coversMonth(txs, prevYear);

  const prevMonthRows = new Map(spendingByCategory(txs, cats, prevMonth, throughDay).map((r) => [r.categoryId, r.cents]));
  const prevYearRows = new Map(spendingByCategory(txs, cats, prevYear, throughDay).map((r) => [r.categoryId, r.cents]));
  const prevMonthTotal = [...prevMonthRows.values()].reduce((s, c) => s + c, 0);
  const prevYearTotal = [...prevYearRows.values()].reduce((s, c) => s + c, 0);

  const lines: CategoryLine[] = now.map((r) => {
    const pm = prevMonthRows.get(r.categoryId) ?? 0;
    const py = prevYearRows.get(r.categoryId) ?? 0;
    return {
      categoryId: r.categoryId,
      cents: r.cents,
      count: r.count,
      share: total > 0 ? r.cents / total : 0,
      vsPreviousMonth: monthAvailable ? { ...change(r.cents, pm), previousCents: pm } : null,
      vsPreviousYear: yearAvailable ? { ...change(r.cents, py), previousCents: py } : null,
    };
  });

  return {
    month,
    throughDay,
    partial,
    totalCents: total,
    previousMonth: monthAvailable ? { month: prevMonth, totalCents: prevMonthTotal, change: change(total, prevMonthTotal) } : null,
    previousYear: yearAvailable ? { month: prevYear, totalCents: prevYearTotal, change: change(total, prevYearTotal) } : null,
    yearComparisonAvailable: yearAvailable,
    yearAgoMonth: prevYear,
    earliest: earliestDate(txs),
    lines,
    monthsOfData: monthsOfHistory(txs, today),
  };
}

export interface TrendPoint {
  month: string;
  cents: number;
  /** False for a month before the transactions begin, or the month they begin in (which may be part-way through), where a small number would really mean "no data". */
  covered: boolean;
}

/**
 * Spending per month, oldest first, ending at `endMonth`, for one category or (with null) all of it.
 * The current month is cut off at today's day so a month in progress doesn't look like a drop.
 * Months that come before the history starts, and the one it starts in, are marked not covered rather than shown as small numbers.
 */
export function spendingTrend(
  txs: ResolvedTransaction[],
  cats: Map<string, Category>,
  categoryId: string | null,
  endMonth: string,
  today: string,
  count = 12,
): TrendPoint[] {
  const first = earliestDate(txs);
  const out: TrendPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = shiftMonth(endMonth, -i);
    const { throughDay } = stretchFor(month, today);
    const rows = spendingByCategory(txs, cats, month, throughDay);
    const cents = categoryId === null ? rows.reduce((s, r) => s + r.cents, 0) : (rows.find((r) => r.categoryId === categoryId)?.cents ?? 0);
    out.push({ month, cents, covered: first !== null && monthKey(first) < month });
  }
  return out;
}

export interface MerchantLine {
  merchant: string;
  cents: number;
  count: number;
}

/** Who the money went to in a month, largest first. Refunds net off; merchants left at zero or below are dropped. */
export function topMerchants(
  txs: ResolvedTransaction[],
  cats: Map<string, Category>,
  month: string,
  throughDay: number,
  categoryId: string | null,
  limit = 5,
): MerchantLine[] {
  const by = new Map<string, MerchantLine>();
  for (const t of txs) {
    if (monthKey(t.date) !== month || dayOfMonth(t.date) > throughDay) continue;
    if ((cats.get(t.categoryId)?.kind ?? "expense") !== "expense") continue;
    if (categoryId !== null && t.categoryId !== categoryId) continue;
    const row = by.get(t.merchant) ?? { merchant: t.merchant, cents: 0, count: 0 };
    row.cents -= t.amountCents;
    row.count += 1;
    by.set(t.merchant, row);
  }
  return [...by.values()].filter((r) => r.cents > 0).sort((a, b) => b.cents - a.cents || a.merchant.localeCompare(b.merchant)).slice(0, limit);
}

export interface UnusualPurchase {
  id: string;
  date: string;
  merchant: string;
  categoryId: string;
  cents: number;
  /** The typical purchase in that category before this one, in cents. */
  usualCents: number;
  /** How many times the usual purchase this was. */
  times: number;
}

/**
 * Purchases in the month that are far above what's normal for their category: at least $100 and at least
 * three times the median earlier purchase there, with enough history (four purchases) to call anything normal.
 * It says a purchase stands out, not that it was a mistake.
 */
export function unusualPurchases(
  txs: ResolvedTransaction[],
  cats: Map<string, Category>,
  month: string,
  throughDay: number,
  categoryId: string | null,
): UnusualPurchase[] {
  const out: UnusualPurchase[] = [];
  const spend = txs.filter((t) => t.amountCents < 0 && (cats.get(t.categoryId)?.kind ?? "expense") === "expense");
  for (const t of spend) {
    if (monthKey(t.date) !== month || dayOfMonth(t.date) > throughDay) continue;
    if (categoryId !== null && t.categoryId !== categoryId) continue;
    const prior = spend.filter((p) => p.categoryId === t.categoryId && p.date < t.date).map((p) => -p.amountCents);
    if (prior.length < UNUSUAL_MIN_HISTORY) continue;
    const usual = median(prior);
    const amount = -t.amountCents;
    if (amount < UNUSUAL_MIN_CENTS || amount < usual * UNUSUAL_FACTOR) continue;
    out.push({ id: t.id, date: t.date, merchant: t.merchant, categoryId: t.categoryId, cents: amount, usualCents: Math.round(usual), times: amount / usual });
  }
  return out.sort((a, b) => b.cents - a.cents || a.id.localeCompare(b.id));
}

/** The months a screen can offer to look at: the current one and the complete ones before it that have data. */
export function selectableMonths(txs: ResolvedTransaction[], today: string, max = 14): string[] {
  const first = earliestDate(txs);
  if (first === null) return [monthKey(today)];
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    const m = shiftMonth(monthKey(today), -i);
    if (m < monthKey(first)) break;
    out.push(m);
  }
  return out;
}
