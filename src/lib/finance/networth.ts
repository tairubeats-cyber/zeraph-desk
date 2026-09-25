/**
 * Net worth, today and over time. Everything here is CALCULATION: arithmetic on
 * the balances a provider reported and the values the user entered.
 *
 * One rule covers every gap in the data: a balance on a day is the latest one
 * known on or before it; before the first one known, the first is carried
 * backward; with none at all, today's is used. Each place that rule had to fill
 * a gap is reported in `notes`, so a chart never quietly claims to know a past
 * it doesn't.
 */
import {
  ACCOUNT_KINDS,
  HOLDING_KINDS,
  type AccountGroup,
  type BalancePoint,
  type FinancialAccount,
  type Holding,
} from "./types";
import { accountTotals, type Totals } from "./analysis";
import { addDays, daysBetween } from "./money";

export interface NetWorthTotals extends Totals {
  /** Homes, vehicles and anything else the user entered as an asset. */
  otherAssetsCents: number;
  /** Debts the user entered that aren't accounts. */
  otherDebtCents: number;
}

/** What a holding was worth on a date, by the rule above. null if no value was ever entered. */
export function holdingValueOn(h: Holding, date: string): number | null {
  if (h.values.length === 0) return null;
  let found = h.values[0].valueCents;
  for (const v of h.values) {
    if (v.date <= date) found = v.valueCents;
    else break;
  }
  return found;
}

export function holdingLatest(h: Holding): number | null {
  return h.values.length ? h.values[h.values.length - 1].valueCents : null;
}

/** Net worth as of today: the accounts plus everything the user entered by hand. */
export function netWorthNow(accounts: FinancialAccount[], holdings: Holding[]): NetWorthTotals {
  const t = accountTotals(accounts);
  let otherAssets = 0;
  let otherDebt = 0;
  for (const h of holdings) {
    const v = holdingLatest(h);
    if (v === null) continue;
    if (HOLDING_KINDS[h.kind].class === "asset") otherAssets += v;
    else otherDebt += v;
  }
  const assetsCents = t.assetsCents + otherAssets;
  const liabilitiesCents = t.liabilitiesCents + otherDebt;
  return {
    ...t,
    assetsCents,
    liabilitiesCents,
    netWorthCents: assetsCents - liabilitiesCents,
    otherAssetsCents: otherAssets,
    otherDebtCents: otherDebt,
  };
}

export interface SeriesPoint {
  date: string;
  assetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
}

/** Where a slice of net worth sits, for the breakdown. */
export type Slice = AccountGroup | "other_assets" | "other_debt";

export const SLICE_LABELS: Record<Slice, string> = {
  cash: "Cash",
  investments: "Investments",
  credit: "Credit cards",
  loans: "Loans",
  other_assets: "Homes, vehicles and other assets",
  other_debt: "Other debts",
};

const SLICE_ORDER: Slice[] = ["cash", "investments", "other_assets", "credit", "loans", "other_debt"];

/** Per account, its history sorted oldest first, or an empty list. */
function historyByAccount(history: BalancePoint[]): Map<string, BalancePoint[]> {
  const by = new Map<string, BalancePoint[]>();
  for (const p of history) {
    const list = by.get(p.accountId);
    if (list) list.push(p);
    else by.set(p.accountId, [p]);
  }
  for (const list of by.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return by;
}

/** The earliest date any account has a balance for, or null when there's no history at all. */
export function historyStart(history: BalancePoint[]): string | null {
  let earliest: string | null = null;
  for (const p of history) if (earliest === null || p.date < earliest) earliest = p.date;
  return earliest;
}

export interface Range {
  key: "today" | "30d" | "90d" | "1y" | "5y" | "all";
  label: string;
  /** Days back, or null for "as far back as there's data". */
  days: number | null;
}

export const RANGES: Range[] = [
  { key: "today", label: "Today", days: 0 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "1y", label: "1 year", days: 365 },
  { key: "5y", label: "5 years", days: 1826 },
  { key: "all", label: "All time", days: null },
];

export interface NetWorthHistory {
  points: SeriesPoint[];
  /** The first day shown. */
  from: string;
  /** True when the range asked for reaches back past the data, so `from` is later than requested. */
  clipped: boolean;
  /** The earliest day any data exists for, or null. */
  dataStart: string | null;
  /** Plain-language caveats about how the numbers were filled in. */
  notes: string[];
  /** Per slice, its value on the first and last day shown. */
  slices: { slice: Slice; startCents: number; endCents: number; owed: boolean }[];
}

/**
 * Net worth day by day from the start of `range` to today, plus the change in
 * each slice. Today always uses the balances the accounts report now, so the last
 * point matches the figure shown everywhere else.
 */
export function netWorthHistory(
  accounts: FinancialAccount[],
  history: BalancePoint[],
  holdings: Holding[],
  today: string,
  range: Range,
): NetWorthHistory {
  const by = historyByAccount(history);
  const dataStart = historyStart(history);
  const requested = range.days === null ? (dataStart ?? today) : addDays(today, -range.days);
  const from = dataStart && requested < dataStart ? dataStart : requested;
  const clipped = range.days !== null && dataStart !== null && requested < dataStart;

  // A cursor per account, so walking the days forward stays linear.
  const cursors = new Map<string, number>();
  const balanceOn = (a: FinancialAccount, date: string): number => {
    const list = by.get(a.id);
    if (!list || list.length === 0 || date >= today) return a.balanceCents;
    let i = cursors.get(a.id) ?? 0;
    // Never step back: dates only go forward in this walk.
    while (i + 1 < list.length && list[i + 1].date <= date) i++;
    cursors.set(a.id, i);
    return list[i].date <= date ? list[i].balanceCents : list[0].balanceCents;
  };

  const sliceOf = (a: FinancialAccount): Slice => ACCOUNT_KINDS[a.kind].group;
  const slicesAt = (date: string): Map<Slice, number> => {
    const m = new Map<Slice, number>();
    for (const a of accounts) m.set(sliceOf(a), (m.get(sliceOf(a)) ?? 0) + balanceOn(a, date));
    for (const h of holdings) {
      const v = holdingValueOn(h, date);
      if (v === null) continue;
      const s: Slice = HOLDING_KINDS[h.kind].class === "asset" ? "other_assets" : "other_debt";
      m.set(s, (m.get(s) ?? 0) + v);
    }
    return m;
  };
  const owed = (s: Slice) => s === "credit" || s === "loans" || s === "other_debt";

  const points: SeriesPoint[] = [];
  const total = Math.max(0, daysBetween(from, today));
  let firstSlices = new Map<Slice, number>();
  let lastSlices = new Map<Slice, number>();
  for (let i = 0; i <= total; i++) {
    const date = addDays(from, i);
    const m = slicesAt(date);
    if (i === 0) firstSlices = m;
    lastSlices = m;
    let assets = 0;
    let liabilities = 0;
    for (const [s, v] of m) {
      if (owed(s)) liabilities += v;
      else assets += v;
    }
    points.push({ date, assetsCents: assets, liabilitiesCents: liabilities, netWorthCents: assets - liabilities });
  }

  const notes: string[] = [];
  const noHistory = accounts.filter((a) => !by.has(a.id));
  if (history.length === 0) {
    notes.push("This data source doesn't include past balances, so every account is shown at today's balance.");
  } else if (noHistory.length > 0) {
    notes.push(
      `${noHistory.map((a) => a.name).join(", ")} ${noHistory.length === 1 ? "has" : "have"} no balance history, so ${
        noHistory.length === 1 ? "it's" : "they're"
      } shown at today's balance throughout.`,
    );
  }
  const late = accounts.filter((a) => {
    const list = by.get(a.id);
    return list && dataStart && list[0].date > dataStart && list[0].date > from;
  });
  if (late.length > 0) {
    notes.push(
      `History for ${late.map((a) => a.name).join(", ")} starts later than the rest, so earlier days use its first known balance.`,
    );
  }
  const entered = holdings.filter((h) => h.values.length > 0 && h.values[0].date > from);
  if (entered.length > 0) {
    notes.push(
      `${entered.map((h) => h.name).join(", ")}: values you entered are carried back to before the date you first entered them.`,
    );
  }

  const keys = new Set<Slice>([...firstSlices.keys(), ...lastSlices.keys()]);
  const slices = SLICE_ORDER.filter((s) => keys.has(s)).map((s) => ({
    slice: s,
    startCents: firstSlices.get(s) ?? 0,
    endCents: lastSlices.get(s) ?? 0,
    owed: owed(s),
  }));

  return { points, from, clipped, dataStart, notes, slices };
}

/** Thin a long series to at most `max` points for drawing, always keeping the first and last. */
export function thin<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}
