/**
 * Pure calculations over resolved transactions and accounts. Everything here
 * is a CALCULATION in the sense of `Basis`: arithmetic on data the provider
 * reported. No forecasting, no interpretation.
 */
import {
  ACCOUNT_KINDS,
  type Category,
  type FinancialAccount,
  type ResolvedTransaction,
  type Transaction,
  type TransactionOverride,
} from "./types";
import { FALLBACK_CATEGORY_ID } from "./categories";
import { dayOfMonth, monthKey } from "./money";

export function categoryMap(categories: Category[]): Map<string, Category> {
  return new Map(categories.map((c) => [c.id, c]));
}

/** Apply the user's edits. A category that no longer exists falls back to "Other". */
export function resolveTransactions(
  transactions: Transaction[],
  categories: Category[],
  overrides: Map<string, TransactionOverride>,
): ResolvedTransaction[] {
  const known = categoryMap(categories);
  return transactions.map((t) => {
    const o = overrides.get(t.id);
    const wanted = o?.categoryId ?? t.categoryHint ?? FALLBACK_CATEGORY_ID;
    return {
      ...t,
      categoryId: known.has(wanted) ? wanted : FALLBACK_CATEGORY_ID,
      note: o?.note ?? "",
      flagged: o?.flagged ?? false,
      recategorized: o?.categoryId != null,
    };
  });
}

export interface Totals {
  assetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
  cashCents: number;
  investmentsCents: number;
}

export function accountTotals(accounts: FinancialAccount[]): Totals {
  const t: Totals = { assetsCents: 0, liabilitiesCents: 0, netWorthCents: 0, cashCents: 0, investmentsCents: 0 };
  for (const a of accounts) {
    const info = ACCOUNT_KINDS[a.kind];
    if (info.class === "asset") {
      t.assetsCents += a.balanceCents;
      if (info.group === "cash") t.cashCents += a.balanceCents;
      if (info.group === "investments") t.investmentsCents += a.balanceCents;
    } else {
      t.liabilitiesCents += a.balanceCents;
    }
  }
  t.netWorthCents = t.assetsCents - t.liabilitiesCents;
  return t;
}

export interface Flow {
  incomeCents: number;
  spendingCents: number;
  surplusCents: number;
}

/** Whether a transaction counts toward the given kind, by its (resolved) category. */
function kindOf(t: ResolvedTransaction, cats: Map<string, Category>) {
  return cats.get(t.categoryId)?.kind ?? "expense";
}

/**
 * Income and spending for one month. Transfers (including investment
 * contributions and card payments) are neither. Refunds reduce spending.
 * `throughDay` cuts the month off at that day so a partial month can be
 * compared with the same stretch of an earlier one.
 */
export function flowForMonth(
  txs: ResolvedTransaction[],
  cats: Map<string, Category>,
  month: string,
  throughDay = 31,
): Flow {
  let income = 0;
  let spending = 0;
  for (const t of txs) {
    if (monthKey(t.date) !== month || dayOfMonth(t.date) > throughDay) continue;
    const kind = kindOf(t, cats);
    if (kind === "income") income += t.amountCents;
    else if (kind === "expense") spending -= t.amountCents;
  }
  return { incomeCents: income, spendingCents: spending, surplusCents: income - spending };
}

export interface CategorySpend {
  categoryId: string;
  cents: number;
  count: number;
}

export function spendingByCategory(
  txs: ResolvedTransaction[],
  cats: Map<string, Category>,
  month: string,
  throughDay = 31,
): CategorySpend[] {
  const by = new Map<string, CategorySpend>();
  for (const t of txs) {
    if (monthKey(t.date) !== month || dayOfMonth(t.date) > throughDay) continue;
    if (kindOf(t, cats) !== "expense") continue;
    const row = by.get(t.categoryId) ?? { categoryId: t.categoryId, cents: 0, count: 0 };
    row.cents -= t.amountCents;
    row.count += 1;
    by.set(t.categoryId, row);
  }
  return [...by.values()].filter((r) => r.cents > 0).sort((a, b) => b.cents - a.cents);
}

export interface MerchantStats {
  count: number;
  /** Net money out to this merchant across the loaded history. */
  spentCents: number;
  firstDate: string;
  lastDate: string;
}

export function merchantStats(txs: ResolvedTransaction[], merchant: string): MerchantStats | null {
  let stats: MerchantStats | null = null;
  for (const t of txs) {
    if (t.merchant !== merchant) continue;
    if (!stats) stats = { count: 0, spentCents: 0, firstDate: t.date, lastDate: t.date };
    stats.count += 1;
    stats.spentCents -= t.amountCents;
    if (t.date < stats.firstDate) stats.firstDate = t.date;
    if (t.date > stats.lastDate) stats.lastDate = t.date;
  }
  return stats;
}
