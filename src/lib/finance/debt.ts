/**
 * Debt payoff arithmetic. These are ESTIMATES: they assume the rate and the
 * payment stay exactly as entered, that interest compounds monthly, and that
 * no new charges are added. Real statements round and time things slightly
 * differently, so the payoff dates here are close, never exact.
 */
import { ACCOUNT_KINDS, type BalancePoint, type DebtTerms, type FinancialAccount, type PayoffStrategy } from "./types";
import { addMonths, daysInMonth, parseISODate, toISODate } from "./money";

/** A debt with everything the arithmetic needs. Debts missing a rate or payment can't be modelled. */
export interface DebtInput {
  id: string;
  name: string;
  balanceCents: number;
  aprBps: number;
  /** What's paid each month, at least. */
  paymentCents: number;
}

/** Fifty years: past this the debt isn't being paid off at that payment in any useful sense. */
export const CAP_MONTHS = 600;

/**
 * The debts that can be modelled: a liability account with a balance, a rate
 * and a payment. The payment is what the user says they pay, else the minimum.
 */
export function modellableDebts(accounts: FinancialAccount[], terms: Map<string, DebtTerms>): DebtInput[] {
  const out: DebtInput[] = [];
  for (const a of accounts) {
    if (ACCOUNT_KINDS[a.kind].class !== "liability" || a.balanceCents <= 0) continue;
    const t = terms.get(a.id);
    const payment = t?.paymentCents ?? t?.minPaymentCents ?? null;
    if (!t || t.aprBps === null || payment === null || payment <= 0) continue;
    out.push({ id: a.id, name: a.name, balanceCents: a.balanceCents, aprBps: t.aprBps, paymentCents: payment });
  }
  return out;
}

export interface DebtPayoff {
  id: string;
  /** Months from now until this debt is gone, or null if it isn't within the cap. */
  months: number | null;
  payoffDate: string | null;
  /** Interest added over the whole simulation. Not meaningful when `months` is null. */
  interestCents: number;
}

export interface PayoffResult {
  /** When the last debt is gone, or null if any is still there at the cap. */
  months: number | null;
  payoffDate: string | null;
  totalInterestCents: number;
  perDebt: DebtPayoff[];
  /** Index m is the state after m months; index 0 is today. Paid and interest are cumulative. */
  balance: number[];
  paid: number[];
  interest: number[];
}

export interface PayoffOptions {
  /** Extra money each month on top of the payments already being made. */
  extraCents?: number;
  strategy?: PayoffStrategy;
  /** When a debt is gone, its payment goes to the next one instead of staying in the budget. */
  rollover?: boolean;
  /** Which debt the extra goes to first. Otherwise the strategy decides. */
  focusId?: string | null;
}

function monthlyInterest(balance: number, aprBps: number): number {
  return Math.round((balance * aprBps) / 10_000 / 12);
}

/**
 * Month-by-month payoff of one or several debts. Each month: interest is
 * added, every debt gets its own payment, then the extra (and, when rolling
 * over, the payments of debts already gone) goes to the debt the strategy
 * picks, spilling to the next when it's cleared.
 */
export function simulatePayoff(debts: DebtInput[], today: string, opts: PayoffOptions = {}): PayoffResult {
  const extra = Math.max(0, opts.extraCents ?? 0);
  const strategy = opts.strategy ?? "avalanche";
  const rollover = opts.rollover ?? false;

  const state = debts.map((d) => ({ ...d, bal: d.balanceCents, gone: d.balanceCents <= 0, months: null as number | null, interest: 0 }));
  const balance = [state.reduce((s, d) => s + d.bal, 0)];
  const paid = [0];
  const interest = [0];
  let paidTotal = 0;
  let interestTotal = 0;

  for (let m = 1; m <= CAP_MONTHS && state.some((d) => !d.gone); m++) {
    for (const d of state) {
      if (d.gone) continue;
      const i = monthlyInterest(d.bal, d.aprBps);
      d.bal += i;
      d.interest += i;
      interestTotal += i;
    }

    let pool = extra + (rollover ? state.filter((d) => d.gone).reduce((s, d) => s + d.paymentCents, 0) : 0);
    for (const d of state) {
      if (d.gone) continue;
      const pay = Math.min(d.paymentCents, d.bal);
      d.bal -= pay;
      paidTotal += pay;
    }

    const order = state
      .filter((d) => !d.gone && d.bal > 0)
      .sort((a, b) => {
        if (opts.focusId) {
          if (a.id === opts.focusId) return -1;
          if (b.id === opts.focusId) return 1;
        }
        return strategy === "avalanche" ? b.aprBps - a.aprBps || a.bal - b.bal : a.bal - b.bal || b.aprBps - a.aprBps;
      });
    for (const d of order) {
      if (pool <= 0) break;
      const pay = Math.min(pool, d.bal);
      d.bal -= pay;
      pool -= pay;
      paidTotal += pay;
    }

    for (const d of state) {
      if (!d.gone && d.bal <= 0) {
        d.gone = true;
        d.months = m;
      }
    }
    balance.push(state.reduce((s, d) => s + d.bal, 0));
    paid.push(paidTotal);
    interest.push(interestTotal);
  }

  const finished = state.every((d) => d.gone);
  const months = finished ? Math.max(0, ...state.map((d) => d.months ?? 0)) : null;
  return {
    months,
    payoffDate: months === null ? null : addMonths(today, months),
    totalInterestCents: interestTotal,
    perDebt: state.map((d) => ({
      id: d.id,
      months: d.months,
      payoffDate: d.months === null ? null : addMonths(today, d.months),
      interestCents: d.interest,
    })),
    balance,
    paid,
    interest,
  };
}

/** The value of a cumulative series after `m` months, holding its last value once the simulation ended. */
export function valueAt(series: number[], m: number): number {
  return series[Math.min(m, series.length - 1)];
}

export interface LoanSchedule {
  /** The regular monthly payment. The last one is smaller if rounding leaves a remainder. */
  paymentCents: number;
  /** Index m is what's owed after m payments; index 0 is the amount borrowed. */
  balance: number[];
  /** Interest charged in month m (index 0 unused). */
  interest: number[];
  /** What's paid in month m (index 0 unused). */
  paid: number[];
}

/** The level monthly payment on a fixed-rate loan: the standard annuity formula, rounded up to the cent. */
export function loanPayment(principalCents: number, aprBps: number, termMonths: number): number {
  if (principalCents <= 0 || termMonths <= 0) return 0;
  const r = aprBps / 10_000 / 12;
  if (r === 0) return Math.ceil(principalCents / termMonths);
  return Math.ceil((principalCents * r) / (1 - Math.pow(1 + r, -termMonths)));
}

export function loanSchedule(principalCents: number, aprBps: number, termMonths: number): LoanSchedule {
  const paymentCents = loanPayment(principalCents, aprBps, termMonths);
  const balance = [principalCents];
  const interest = [0];
  const paid = [0];
  let bal = principalCents;
  for (let m = 1; m <= termMonths && bal > 0; m++) {
    const i = monthlyInterest(bal, aprBps);
    const pay = Math.min(paymentCents, bal + i);
    bal = bal + i - pay;
    balance.push(bal);
    interest.push(i);
    paid.push(pay);
  }
  return { paymentCents, balance, interest, paid };
}

/** The next date a monthly payment falls due on `dueDay`, today included, short months clamped. */
export function nextDueDate(dueDay: number, today: string): string {
  const now = parseISODate(today);
  const inMonth = (offset: number) => {
    const y = now.getFullYear();
    const m = now.getMonth() + offset;
    const first = new Date(y, m, 1);
    const last = daysInMonth(first.getFullYear(), first.getMonth() + 1);
    return toISODate(new Date(first.getFullYear(), first.getMonth(), Math.min(dueDay, last)));
  };
  const thisMonth = inMonth(0);
  return thisMonth >= today ? thisMonth : inMonth(1);
}

/**
 * CALCULATION: how much of the largest balance on record has been paid off.
 * "Largest on record" is only as far back as the history goes, and the screen
 * says so; it isn't the original loan amount unless the history reaches that far.
 */
export function payoffProgress(
  account: FinancialAccount,
  history: BalancePoint[],
): { startCents: number; paidDownCents: number; fraction: number; since: string } | null {
  let peak = account.balanceCents;
  let since: string | null = null;
  let earliest: string | null = null;
  for (const p of history) {
    if (p.accountId !== account.id) continue;
    if (earliest === null || p.date < earliest) earliest = p.date;
    if (p.balanceCents > peak) {
      peak = p.balanceCents;
      since = p.date;
    }
  }
  if (earliest === null) return null;
  const paidDownCents = Math.max(0, peak - account.balanceCents);
  return { startCents: peak, paidDownCents, fraction: peak > 0 ? paidDownCents / peak : 0, since: since ?? earliest };
}
