const WHOLE = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const CENTS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export interface MoneyOptions {
  /** Show cents. Defaults to whole dollars for big figures. */
  cents?: boolean;
  /** Prefix "+" for positive amounts. Negative amounts always get a proper minus. */
  signed?: boolean;
}

export function formatMoney(amountCents: number, { cents = false, signed = false }: MoneyOptions = {}): string {
  const fmt = cents ? CENTS : WHOLE;
  const body = fmt.format(Math.abs(amountCents) / 100);
  if (amountCents < 0) return `−${body}`;
  if (signed && amountCents > 0) return `+${body}`;
  return body;
}

// --- Dates. Transactions carry a local calendar date, so nothing here uses UTC. ---

export function toISODate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The last `count` month keys ending at (and including) the month of `today`, oldest first. */
export function recentMonthKeys(today: string, count: number): string[] {
  const current = monthKey(today);
  return Array.from({ length: count }, (_, i) => shiftMonth(current, i - (count - 1)));
}

/** "September 2025": a month with its year, for a comparison with another year where the bare name would be ambiguous. */
export function monthYearLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** "Sep 27, 2023". */
export function friendlyDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function monthLabel(key: string, style: "long" | "short" = "long"): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: style });
}

export function dayHeading(iso: string, today: string): string {
  if (iso === today) return "Today";
  const yesterday = toISODate(new Date(parseISODate(today).getTime() - 86_400_000));
  if (iso === yesterday) return "Yesterday";
  return parseISODate(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Whole days from `a` to `b` (negative if `b` is earlier). Uses calendar dates, so DST can't skew it. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Move by whole months, landing on `day` (or the date's own day) clamped to the target month's length. */
export function addMonths(iso: string, months: number, day?: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const last = daysInMonth(target.getFullYear(), target.getMonth() + 1);
  target.setDate(Math.min(day ?? d, last));
  return toISODate(target);
}

export function endOfMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return toISODate(new Date(y, m - 1, daysInMonth(y, m)));
}

/**
 * Read what someone typed into a money field: "1,250", "$1250.5", "12.34".
 * Returns integer cents, or null if it isn't a usable non-negative amount.
 */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === "" || cleaned === ".") return null;
  return Math.round(Number(cleaned) * 100);
}

/** The inverse, for filling a field: 125000 becomes "1250" and 1234 becomes "12.34". */
export function moneyInputValue(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/**
 * Read an interest rate someone typed: "19.99", "19.99%", "6". Returns basis
 * points (19.99% is 1999), or null if it isn't a rate between 0% and 100%.
 */
export function parseRateBps(input: string): number | null {
  const cleaned = input.replace(/[%\s]/g, "");
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === "" || cleaned === ".") return null;
  const bps = Math.round(Number(cleaned) * 100);
  return bps <= 10_000 ? bps : null;
}

/** The inverse, for filling a field: 1999 becomes "19.99" and 600 becomes "6". */
export function rateInputValue(bps: number): string {
  return bps % 100 === 0 ? String(bps / 100) : (bps / 100).toFixed(2).replace(/0$/, "");
}
