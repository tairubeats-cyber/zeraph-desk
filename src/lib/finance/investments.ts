/**
 * The investment workspace's arithmetic. Values and prices come from the
 * provider; everything here is CALCULATION on them (or, for returns, a
 * calculation whose method is stated). There is no trading here and no advice:
 * this describes what's held and how it has moved.
 *
 * Returns use the Modified Dietz method: growth divided by the starting value
 * plus each deposit weighted by how long it was invested. It accounts for WHEN
 * money went in, so a big deposit late in a period doesn't look like a big
 * gain. It is an estimate of the return, not the exact time-weighted figure a
 * broker computes from daily valuations.
 */
import {
  ACCOUNT_KINDS,
  type AssetClass,
  type BalancePoint,
  type FinancialAccount,
  type InvestmentActivity,
  type Position,
} from "./types";
import { balanceLookup, historyByAccount, historyStart, type Range } from "./networth";
import { addDays, daysBetween } from "./money";

export const positionValue = (p: Position): number => Math.round(p.quantity * p.priceCents);
export const positionDayChange = (p: Position): number => Math.round(p.quantity * (p.priceCents - p.previousCloseCents));

/** Brokerage and retirement accounts: the ones the workspace is about. */
export function investmentAccounts(accounts: FinancialAccount[]): FinancialAccount[] {
  return accounts.filter((a) => ACCOUNT_KINDS[a.kind].group === "investments");
}

export interface PortfolioSummary {
  /** What the accounts report, in total. */
  valueCents: number;
  /** Today's change across the holdings the provider gave prices for. null when there are none. */
  dailyChangeCents: number | null;
  /** As a share of yesterday's value of those same holdings. */
  dailyPct: number | null;
  /** Accounts with no holdings listed, so their value can't be split up. */
  withoutHoldings: FinancialAccount[];
  /** Accounts whose listed holdings don't add up to the balance. */
  mismatched: FinancialAccount[];
}

/** A cent or two of rounding isn't a mismatch; a dollar is. */
const TOLERANCE_CENTS = 100;

export function portfolioSummary(accounts: FinancialAccount[], positions: Position[]): PortfolioSummary {
  const inv = investmentAccounts(accounts);
  const ids = new Set(inv.map((a) => a.id));
  const mine = positions.filter((p) => ids.has(p.accountId));
  const withoutHoldings = inv.filter((a) => !mine.some((p) => p.accountId === a.id));
  const mismatched = inv.filter((a) => {
    const held = mine.filter((p) => p.accountId === a.id);
    return held.length > 0 && Math.abs(held.reduce((s, p) => s + positionValue(p), 0) - a.balanceCents) > TOLERANCE_CENTS;
  });
  const change = mine.reduce((s, p) => s + positionDayChange(p), 0);
  const covered = mine.reduce((s, p) => s + positionValue(p), 0);
  const before = covered - change;
  return {
    valueCents: inv.reduce((s, a) => s + a.balanceCents, 0),
    dailyChangeCents: mine.length ? change : null,
    dailyPct: mine.length && before > 0 ? change / before : null,
    withoutHoldings,
    mismatched,
  };
}

export type AllocationKey = AssetClass | "unclassified";

export interface AllocationSlice {
  key: AllocationKey;
  cents: number;
  fraction: number;
}

/** Where the money sits by asset class. An account with no holdings listed is its own "not broken down" slice, never guessed at. */
export function allocation(accounts: FinancialAccount[], positions: Position[]): AllocationSlice[] {
  const inv = investmentAccounts(accounts);
  const ids = new Set(inv.map((a) => a.id));
  const by = new Map<AllocationKey, number>();
  for (const p of positions) {
    if (!ids.has(p.accountId)) continue;
    by.set(p.assetClass, (by.get(p.assetClass) ?? 0) + positionValue(p));
  }
  for (const a of inv) {
    if (!positions.some((p) => p.accountId === a.id)) by.set("unclassified", (by.get("unclassified") ?? 0) + a.balanceCents);
  }
  const total = [...by.values()].reduce((s, v) => s + v, 0);
  return [...by.entries()]
    .filter(([, cents]) => cents > 0)
    .map(([key, cents]) => ({ key, cents, fraction: total > 0 ? cents / total : 0 }))
    .sort((a, b) => b.cents - a.cents);
}

export interface HoldingRow {
  position: Position;
  account: FinancialAccount;
  valueCents: number;
  dayChangeCents: number;
  /** Value minus what was paid, when the provider reports the cost. */
  gainCents: number | null;
  /** Share of the whole portfolio. */
  share: number;
}

export function holdingRows(accounts: FinancialAccount[], positions: Position[]): HoldingRow[] {
  const byId = new Map(investmentAccounts(accounts).map((a) => [a.id, a]));
  const mine = positions.filter((p) => byId.has(p.accountId));
  const total = mine.reduce((s, p) => s + positionValue(p), 0);
  return mine
    .map((p) => {
      const valueCents = positionValue(p);
      return {
        position: p,
        account: byId.get(p.accountId) as FinancialAccount,
        valueCents,
        dayChangeCents: positionDayChange(p),
        gainCents: p.costBasisCents === null ? null : valueCents - p.costBasisCents,
        share: total > 0 ? valueCents / total : 0,
      };
    })
    .sort((a, b) => b.valueCents - a.valueCents);
}

export interface Concentration {
  /** The largest single holding, funds included. */
  largest: HoldingRow | null;
  /** The largest single company. Funds spread risk across many, so they aren't counted here. */
  largestStock: HoldingRow | null;
}

export function concentration(rows: HoldingRow[]): Concentration {
  return {
    largest: rows.find((r) => r.position.type !== "cash") ?? null,
    largestStock: rows.find((r) => r.position.type === "stock") ?? null,
  };
}

// --- Money in, and how it has performed --------------------------------------------

/** Net money put in over a stretch: contributions minus withdrawals, after `from` up to and including `to`. */
export function netContributions(activity: InvestmentActivity[], ids: Set<string>, from: string, to: string): number {
  let sum = 0;
  for (const a of activity) {
    if (!ids.has(a.accountId) || a.date <= from || a.date > to) continue;
    if (a.kind === "contribution") sum += a.amountCents;
    else if (a.kind === "withdrawal") sum -= a.amountCents;
  }
  return sum;
}

export function dividendsBetween(activity: InvestmentActivity[], ids: Set<string>, from: string, to: string): number {
  return activity
    .filter((a) => a.kind === "dividend" && ids.has(a.accountId) && a.date > from && a.date <= to)
    .reduce((s, a) => s + a.amountCents, 0);
}

export interface ContributionSummary {
  /** Net money put in over the last 12 months. */
  last12Cents: number;
  /** Average per month over those 12. */
  monthlyCents: number;
  /** Net money put in over everything on record. */
  totalCents: number;
  dividends12Cents: number;
  /** The earliest date on record, or null. */
  since: string | null;
  perAccount: { accountId: string; last12Cents: number; totalCents: number }[];
}

export function contributionSummary(accounts: FinancialAccount[], activity: InvestmentActivity[], today: string): ContributionSummary {
  const inv = investmentAccounts(accounts);
  const ids = new Set(inv.map((a) => a.id));
  const year = addDays(today, -365);
  const mine = activity.filter((a) => ids.has(a.accountId));
  const since = mine.reduce<string | null>((m, a) => (m === null || a.date < m ? a.date : m), null);
  const last12 = netContributions(activity, ids, year, today);
  return {
    last12Cents: last12,
    monthlyCents: Math.round(last12 / 12),
    totalCents: netContributions(activity, ids, "0000-01-01", today),
    dividends12Cents: dividendsBetween(activity, ids, year, today),
    since,
    perAccount: inv.map((a) => {
      const one = new Set([a.id]);
      return { accountId: a.id, last12Cents: netContributions(activity, one, year, today), totalCents: netContributions(activity, one, "0000-01-01", today) };
    }),
  };
}

export interface PerformancePoint {
  date: string;
  valueCents: number;
  /** Starting value plus net money put in since: what the value would be with no growth at all. */
  putInCents: number;
}

export interface Performance {
  from: string;
  points: PerformancePoint[];
  startCents: number;
  endCents: number;
  netContributionsCents: number;
  /** End minus start minus money put in. Negative is a decline. */
  growthCents: number;
  dividendsCents: number;
  /** Modified Dietz over the whole stretch; null when it can't be worked out. */
  returnPct: number | null;
  /** The same expressed per year; only when the stretch is a year or longer. */
  annualizedPct: number | null;
  clipped: boolean;
  dataStart: string | null;
  notes: string[];
}

/**
 * How the investment accounts, together, moved from the start of `range` to today.
 * Returns null when there is no balance history to measure from.
 */
export function performance(
  accounts: FinancialAccount[],
  history: BalancePoint[],
  activity: InvestmentActivity[],
  today: string,
  range: Range,
): Performance | null {
  const inv = investmentAccounts(accounts);
  const ids = new Set(inv.map((a) => a.id));
  const mine = history.filter((p) => ids.has(p.accountId));
  const dataStart = historyStart(mine);
  if (inv.length === 0 || dataStart === null) return null;

  const requested = range.days === null ? dataStart : addDays(today, -range.days);
  const from = requested < dataStart ? dataStart : requested;
  const clipped = range.days !== null && requested < dataStart;
  const total = Math.max(0, daysBetween(from, today));

  const lookup = balanceLookup(historyByAccount(mine), today);
  const flows = activity
    .filter((a) => ids.has(a.accountId) && a.date > from && a.date <= today && a.kind !== "dividend")
    .map((a) => ({ date: a.date, cents: a.kind === "contribution" ? a.amountCents : -a.amountCents }))
    .sort((x, y) => x.date.localeCompare(y.date));

  const points: PerformancePoint[] = [];
  let startCents = 0;
  let putIn = 0;
  let next = 0;
  for (let i = 0; i <= total; i++) {
    const date = addDays(from, i);
    const value = inv.reduce((s, a) => s + lookup(a, date), 0);
    if (i === 0) {
      startCents = value;
      putIn = value;
    }
    while (next < flows.length && flows[next].date <= date) putIn += flows[next++].cents;
    points.push({ date, valueCents: value, putInCents: putIn });
  }

  const endCents = points[points.length - 1].valueCents;
  const netContributionsCents = flows.reduce((s, f) => s + f.cents, 0);
  const growthCents = endCents - startCents - netContributionsCents;

  // Each flow counts for the share of the period it was invested.
  let weighted = 0;
  for (const f of flows) weighted += total > 0 ? f.cents * (daysBetween(f.date, today) / total) : 0;
  const base = startCents + weighted;
  const returnPct = total > 0 && base > 0 ? growthCents / base : null;
  const annualizedPct = returnPct !== null && total >= 365 && returnPct > -1 ? Math.pow(1 + returnPct, 365 / total) - 1 : null;

  const notes: string[] = [];
  const noHistory = inv.filter((a) => !mine.some((p) => p.accountId === a.id));
  if (noHistory.length > 0) {
    notes.push(`${noHistory.map((a) => a.name).join(", ")} ${noHistory.length === 1 ? "has" : "have"} no balance history, so ${noHistory.length === 1 ? "it's" : "they're"} held at today's balance throughout.`);
  }
  const noActivity = inv.filter((a) => !activity.some((x) => x.accountId === a.id));
  if (noActivity.length > 0) {
    notes.push(`No deposits are on record for ${noActivity.map((a) => a.name).join(", ")}, so anything put in there shows up as growth.`);
  }

  return {
    from,
    points,
    startCents,
    endCents,
    netContributionsCents,
    growthCents,
    dividendsCents: dividendsBetween(activity, ids, from, today),
    returnPct,
    annualizedPct,
    clipped,
    dataStart,
    notes,
  };
}
