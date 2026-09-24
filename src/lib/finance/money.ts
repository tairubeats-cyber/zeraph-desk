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
