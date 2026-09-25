/**
 * Long-term projection. Every number here is a PROJECTION built from
 * assumptions the person entered: how much they add, how fast they assume it
 * grows, how long. Markets don't grow steadily, so a single line would claim
 * more certainty than anyone has. The screen therefore shows a range (the
 * assumed rate and two points either side) and says what it assumes.
 */
import type { LongTermAssumptions } from "./types";

export const DEFAULT_LONG_TERM: LongTermAssumptions = {
  monthlyCents: null,
  returnBps: 500,
  years: 20,
  targetCents: null,
  inflationBps: 0,
};

/** How far either side of the assumed rate the range reaches, in basis points. */
export const RANGE_SPREAD_BPS = 200;

export const MAX_YEARS = 60;

/** Read saved assumptions, filling anything missing or unreasonable from the defaults. */
export function mergeLongTerm(saved: unknown): LongTermAssumptions {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<LongTermAssumptions>;
  const cents = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const bps = (v: unknown, fallback: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : fallback;
  const years = Number(s.years);
  return {
    monthlyCents: cents(s.monthlyCents),
    returnBps: bps(s.returnBps, DEFAULT_LONG_TERM.returnBps, 2_000),
    years: Number.isInteger(years) && years >= 1 && years <= MAX_YEARS ? years : DEFAULT_LONG_TERM.years,
    targetCents: cents(s.targetCents),
    inflationBps: bps(s.inflationBps, DEFAULT_LONG_TERM.inflationBps, 1_500),
  };
}

export interface YearPoint {
  year: number;
  /** Future dollars. */
  nominalCents: number;
  /** What that buys in today's money, at the assumed inflation. Equal to nominal at 0%. */
  realCents: number;
  /** Starting value plus everything added: the line with no growth. */
  contributedCents: number;
}

export interface Projection {
  returnBps: number;
  years: YearPoint[];
}

/** Growth compounds monthly and each month's deposit lands at the month's end. */
export function project(
  startCents: number,
  monthlyCents: number,
  returnBps: number,
  years: number,
  inflationBps: number,
): Projection {
  const r = returnBps / 10_000 / 12;
  const out: YearPoint[] = [{ year: 0, nominalCents: startCents, realCents: startCents, contributedCents: startCents }];
  let balance = startCents;
  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) balance = balance * (1 + r) + monthlyCents;
    out.push({
      year: y,
      nominalCents: Math.round(balance),
      realCents: Math.round(balance / Math.pow(1 + inflationBps / 10_000, y)),
      contributedCents: startCents + monthlyCents * 12 * y,
    });
  }
  return { returnBps, years: out };
}

/** The three rates shown: the assumed one and two points either side (never below zero). */
export function projectRange(
  startCents: number,
  monthlyCents: number,
  a: LongTermAssumptions,
): { low: Projection; mid: Projection; high: Projection } {
  const run = (bps: number) => project(startCents, monthlyCents, bps, a.years, a.inflationBps);
  return {
    low: run(Math.max(0, a.returnBps - RANGE_SPREAD_BPS)),
    mid: run(a.returnBps),
    high: run(a.returnBps + RANGE_SPREAD_BPS),
  };
}

/**
 * Whole months until the balance first reaches `targetCents` at this rate, or
 * null if it doesn't within `MAX_YEARS`. Compared in future dollars.
 */
export function monthsToTarget(startCents: number, monthlyCents: number, returnBps: number, targetCents: number): number | null {
  if (startCents >= targetCents) return 0;
  const r = returnBps / 10_000 / 12;
  let balance = startCents;
  for (let m = 1; m <= MAX_YEARS * 12; m++) {
    balance = balance * (1 + r) + monthlyCents;
    if (balance >= targetCents) return m;
  }
  return null;
}
