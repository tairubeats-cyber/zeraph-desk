/**
 * Recurring payments: found in the transaction history, plus any the user
 * added by hand. Detection is a CALCULATION on what the provider reported; the
 * dates it produces for the future are expectations from a pattern, and every
 * screen that shows them says so.
 */
import type {
  Category,
  Frequency,
  ManualRecurring,
  RecurringMark,
  RecurringPayment,
  ResolvedTransaction,
} from "./types";
import { addDays, addMonths, daysBetween, dayOfMonth } from "./money";

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  semimonthly: "Twice a month",
  monthly: "Monthly",
  quarterly: "Every 3 months",
  yearly: "Yearly",
};

export const PER_YEAR: Record<Frequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};

/** Typical gap in days, and how far a real gap may stray and still count as "on schedule". */
const CADENCE: Record<Frequency, { days: number; tolerance: number }> = {
  weekly: { days: 7, tolerance: 1 },
  biweekly: { days: 14, tolerance: 2 },
  semimonthly: { days: 15.2, tolerance: 4 },
  monthly: { days: 30.4, tolerance: 4 },
  quarterly: { days: 91, tolerance: 8 },
  yearly: { days: 365, tolerance: 15 },
};

/** Categories whose recurring payments are bills rather than subscriptions, unless the user says otherwise. */
const BILL_CATEGORIES = new Set(["housing", "utilities", "insurance", "debt"]);

export const DEFAULT_MARK = (key: string): RecurringMark => ({
  key,
  status: "active",
  necessity: "unset",
  autopay: "unset",
  isBill: null,
});

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Strip store numbers, reference digits and punctuation so "FUELSTOP #1289" and "#1044" are one payee. */
function normalizeDescription(description: string): string {
  return description
    .toUpperCase()
    .replace(/[#\d]+/g, " ")
    .replace(/[^A-Z& ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function recurringKey(t: Pick<ResolvedTransaction, "merchant" | "description" | "amountCents">): string {
  return `${t.merchant}|${normalizeDescription(t.description)}|${t.amountCents > 0 ? "in" : "out"}`;
}

/** Days of the month that recur, merging near neighbours (the 14th and 15th are one payday). */
function dayClusters(days: number[]): number[] {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const d of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && d - last[last.length - 1] <= 2) last.push(d);
    else clusters.push([d]);
  }
  return clusters.map((c) => Math.round(median(c)));
}

function classify(medianGap: number, days: number[]): { frequency: Frequency; monthDays: number[] } | null {
  if (medianGap >= 6 && medianGap <= 8) return { frequency: "weekly", monthDays: [] };
  if (medianGap >= 12 && medianGap <= 18) {
    const clusters = dayClusters(days);
    if (clusters.length === 2) return { frequency: "semimonthly", monthDays: clusters };
    if (medianGap <= 15) return { frequency: "biweekly", monthDays: [] };
    return null;
  }
  if (medianGap >= 27 && medianGap <= 34) return { frequency: "monthly", monthDays: [Math.round(median(days))] };
  if (medianGap >= 85 && medianGap <= 95) return { frequency: "quarterly", monthDays: [Math.round(median(days))] };
  if (medianGap >= 355 && medianGap <= 375) return { frequency: "yearly", monthDays: [Math.round(median(days))] };
  return null;
}

/** The date this pattern says comes after `from`. */
export function stepDate(frequency: Frequency, from: string, monthDays: number[]): string {
  switch (frequency) {
    case "weekly":
      return addDays(from, 7);
    case "biweekly":
      return addDays(from, 14);
    case "monthly":
      return addMonths(from, 1, monthDays[0]);
    case "quarterly":
      return addMonths(from, 3, monthDays[0]);
    case "yearly":
      return addMonths(from, 12, monthDays[0]);
    case "semimonthly": {
      // The earliest of the two paydays that falls after `from`, this month or next.
      const candidates = [0, 1].flatMap((offset) => monthDays.map((d) => addMonths(from, offset, d)));
      return candidates.filter((c) => c > from).sort()[0];
    }
  }
}

type Detected = Omit<RecurringPayment, "status" | "necessity" | "autopay" | "isBill">;

/**
 * Find repeating payments. A group of transactions counts when it has at
 * least three, the gaps between them sit close to a known cadence, and the
 * amounts are either steady or vary only moderately (a utility bill). That
 * rules out groceries and coffee, which recur in name but not in rhythm.
 * History shorter than a year can't reveal yearly charges; those need adding by hand.
 */
export function detectRecurring(
  txs: ResolvedTransaction[],
  categories: Map<string, Category>,
  today: string,
): Detected[] {
  const groups = new Map<string, ResolvedTransaction[]>();
  for (const t of txs) {
    const key = recurringKey(t);
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }

  const out: Detected[] = [];
  for (const [key, list] of groups) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const gaps = sorted.slice(1).map((t, i) => daysBetween(sorted[i].date, t.date));
    const shape = classify(median(gaps), sorted.map((t) => dayOfMonth(t.date)));
    if (!shape) continue;

    const { days, tolerance } = CADENCE[shape.frequency];
    const onSchedule = gaps.filter((g) => Math.abs(g - days) <= tolerance).length / gaps.length;
    if (onSchedule < 0.75) continue;

    const magnitudes = sorted.map((t) => Math.abs(t.amountCents));
    const mid = median(magnitudes);
    const spread = (Math.max(...magnitudes) - Math.min(...magnitudes)) / mid;
    if (spread > 0.5) continue;

    const last = sorted[sorted.length - 1];
    const next = stepDate(shape.frequency, last.date, shape.monthDays);
    // More than two cycles of silence: probably ended, and we shouldn't keep projecting it.
    const possiblyStopped = daysBetween(last.date, today) > days * 2.2;

    // The category most often chosen for this payee wins, so one stray edit doesn't flip it.
    const tally = new Map<string, number>();
    for (const t of sorted) tally.set(t.categoryId, (tally.get(t.categoryId) ?? 0) + 1);
    const categoryId = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const typical = Math.round(magnitudes.reduce((s, m) => s + m, 0) / magnitudes.length);

    out.push({
      key,
      source: "detected",
      merchant: last.merchant,
      categoryId,
      direction: last.amountCents > 0 ? "in" : "out",
      kind: categories.get(categoryId)?.kind ?? "expense",
      frequency: shape.frequency,
      amountCents: Math.abs(last.amountCents),
      typicalCents: typical,
      variable: spread > 0.1,
      annualCents: typical * PER_YEAR[shape.frequency],
      lastDate: last.date,
      nextDate: next,
      occurrences: sorted.length,
      possiblyStopped,
      monthDays: shape.monthDays,
      txIds: [...sorted].reverse().map((t) => t.id),
    });
  }
  return out;
}

function fromManual(m: ManualRecurring, categories: Map<string, Category>): Detected {
  return {
    key: `manual:${m.id}`,
    source: "manual",
    merchant: m.name,
    categoryId: m.categoryId,
    direction: m.direction,
    kind: categories.get(m.categoryId)?.kind ?? "expense",
    frequency: m.frequency,
    amountCents: m.amountCents,
    typicalCents: m.amountCents,
    variable: false,
    annualCents: m.amountCents * PER_YEAR[m.frequency],
    lastDate: null,
    nextDate: m.nextDate,
    occurrences: 0,
    possiblyStopped: false,
    monthDays: [Number(m.nextDate.slice(8, 10))],
    txIds: [],
  };
}

/** Detected plus manual, with the user's marks applied on top. */
export function buildRecurring(
  txs: ResolvedTransaction[],
  categories: Map<string, Category>,
  manual: ManualRecurring[],
  marks: Map<string, RecurringMark>,
  today: string,
): RecurringPayment[] {
  return [...detectRecurring(txs, categories, today), ...manual.map((m) => fromManual(m, categories))].map((d) => {
    const mark = marks.get(d.key) ?? DEFAULT_MARK(d.key);
    return {
      ...d,
      status: mark.status,
      necessity: mark.necessity,
      autopay: mark.autopay,
      isBill: mark.isBill ?? (d.direction === "out" && BILL_CATEGORIES.has(d.categoryId)),
    };
  });
}

/** Cancelled or apparently-ended payments aren't expected any more. */
export function isExpected(r: RecurringPayment): boolean {
  return r.status !== "cancelled" && !r.possiblyStopped;
}

export interface Occurrence {
  date: string;
  payment: RecurringPayment;
}

/** Every date in [from, to] the pattern expects, oldest first. Capped so a bad pattern can't loop forever. */
export function occurrencesBetween(r: RecurringPayment, from: string, to: string): Occurrence[] {
  if (!isExpected(r)) return [];
  const out: Occurrence[] = [];
  let date = r.nextDate;
  for (let i = 0; i < 400 && date <= to; i++) {
    if (date >= from) out.push({ date, payment: r });
    const following = stepDate(r.frequency, date, r.monthDays);
    if (following <= date) break;
    date = following;
  }
  return out;
}

export type BillState =
  | { kind: "due"; date: string; inDays: number }
  | { kind: "not_seen"; date: string; daysLate: number }
  | { kind: "stopped"; lastDate: string | null }
  | { kind: "cancelled" };

/** Where a recurring payment stands right now, in plain terms. */
export function billState(r: RecurringPayment, today: string): BillState {
  if (r.status === "cancelled") return { kind: "cancelled" };
  if (r.possiblyStopped) return { kind: "stopped", lastDate: r.lastDate };
  const inDays = daysBetween(today, r.nextDate);
  if (inDays >= 0) return { kind: "due", date: r.nextDate, inDays };
  return { kind: "not_seen", date: r.nextDate, daysLate: -inDays };
}
