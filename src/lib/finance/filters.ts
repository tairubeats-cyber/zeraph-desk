import type { ResolvedTransaction } from "./types";
import { monthKey, parseISODate, shiftMonth, toISODate } from "./money";

export type Period = "this_month" | "last_month" | "last_90" | "all";
export type Direction = "all" | "in" | "out";
export type SortKey = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

export interface TxFilters {
  query: string;
  categoryId: string;
  accountId: string;
  period: Period;
  direction: Direction;
  flaggedOnly: boolean;
  sort: SortKey;
}

export const ALL = "all";

export const DEFAULT_FILTERS: TxFilters = {
  query: "",
  categoryId: ALL,
  accountId: ALL,
  period: "this_month",
  direction: "all",
  flaggedOnly: false,
  sort: "date_desc",
};

export const PERIOD_LABELS: Record<Period, string> = {
  this_month: "This month",
  last_month: "Last month",
  last_90: "Last 90 days",
  all: "All time",
};

export const SORT_LABELS: Record<SortKey, string> = {
  date_desc: "Newest first",
  date_asc: "Oldest first",
  amount_desc: "Largest first",
  amount_asc: "Smallest first",
};

function inPeriod(date: string, period: Period, today: string): boolean {
  switch (period) {
    case "this_month":
      return monthKey(date) === monthKey(today);
    case "last_month":
      return monthKey(date) === shiftMonth(monthKey(today), -1);
    case "last_90": {
      const start = toISODate(new Date(parseISODate(today).getTime() - 90 * 86_400_000));
      return date >= start;
    }
    case "all":
      return true;
  }
}

/** Filter and sort. `categoryName` lets the search box match the category as well as the merchant. */
export function applyFilters(
  txs: ResolvedTransaction[],
  f: TxFilters,
  today: string,
  categoryName: (id: string) => string,
): ResolvedTransaction[] {
  const q = f.query.trim().toLowerCase();
  const out = txs.filter((t) => {
    if (!inPeriod(t.date, f.period, today)) return false;
    if (f.categoryId !== ALL && t.categoryId !== f.categoryId) return false;
    if (f.accountId !== ALL && t.accountId !== f.accountId) return false;
    if (f.direction === "in" && t.amountCents <= 0) return false;
    if (f.direction === "out" && t.amountCents >= 0) return false;
    if (f.flaggedOnly && !t.flagged) return false;
    if (q) {
      const hay = `${t.merchant} ${t.description} ${t.note} ${categoryName(t.categoryId)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const by: Record<SortKey, (a: ResolvedTransaction, b: ResolvedTransaction) => number> = {
    date_desc: (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
    date_asc: (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    amount_desc: (a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents),
    amount_asc: (a, b) => Math.abs(a.amountCents) - Math.abs(b.amountCents),
  };
  return out.sort(by[f.sort]);
}
