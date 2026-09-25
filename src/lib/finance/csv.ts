/**
 * Reading a bank's CSV export. Everything here is pure: text in, rows out. The
 * file is read on this computer and never uploaded.
 *
 * Banks disagree on almost everything: which column holds the date, whether
 * money out is negative, whether dates are month-first, whether there are
 * separate debit and credit columns. So nothing is assumed silently. Columns
 * are guessed from the headings and the person can change them; the date order
 * is detected, and when a file can't settle it (every date is 03/04/2025) the
 * person is asked. A row that can't be read is reported, never guessed at.
 */

export type DateOrder = "ymd" | "mdy" | "dmy";

/** Split CSV text into rows of cells. Handles quotes, doubled quotes, CRLF, a BOM, and , ; tab | delimiters. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  // The delimiter is whichever appears most in the first line, outside quotes.
  const counts = new Map<string, number>();
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "," || ch === ";" || ch === "\t" || ch === "|")) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  const delimiter = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Blank lines carry nothing.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// --- Columns ----------------------------------------------------------------------

export interface ColumnMap {
  date: number | null;
  description: number | null;
  /** One signed column... */
  amount: number | null;
  /** ...or separate columns for money out and money in. */
  debit: number | null;
  credit: number | null;
  balance: number | null;
  category: number | null;
}

export const EMPTY_MAP: ColumnMap = { date: null, description: null, amount: null, debit: null, credit: null, balance: null, category: null };

const HEADINGS: Record<keyof ColumnMap, RegExp> = {
  date: /^(transaction |posting |post |trans\.? )?date$|^posted( date)?$|^date posted$/i,
  description: /^(description|memo|details|payee|merchant|name|narrative|transaction( description)?|original description)$/i,
  amount: /^(amount|transaction amount|amt|value)$/i,
  debit: /^(debit|debits|withdrawal|withdrawals|money out|paid out|charge)$/i,
  credit: /^(credit|credits|deposit|deposits|money in|paid in|payment)$/i,
  balance: /^(running )?balance$|^available balance$/i,
  category: /^category$/i,
};

/** Guess which column is which from the heading row. Anything not recognised stays null for the person to choose. */
export function detectColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = { ...EMPTY_MAP };
  const used = new Set<number>();
  // Most specific first, so "Transaction Date" isn't taken for a description.
  for (const key of ["date", "balance", "amount", "debit", "credit", "category", "description"] as (keyof ColumnMap)[]) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && HEADINGS[key].test(h.trim()));
    if (i >= 0) {
      map[key] = i;
      used.add(i);
    }
  }
  // A single amount column and debit/credit columns don't mix: prefer separate columns only when there's no amount.
  if (map.amount !== null) {
    map.debit = null;
    map.credit = null;
  }
  return map;
}

/** Whether the first row looks like headings (words) rather than a transaction (a date and a number). */
export function looksLikeHeader(row: string[]): boolean {
  if (row.length === 0) return false;
  const dateish = row.some((c) => /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(c.trim()));
  const numeric = row.some((c) => parseAmount(c) !== null && /\d/.test(c) && !/[a-z]/i.test(c));
  return !(dateish && numeric);
}

// --- Dates and amounts ---------------------------------------------------------------

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(y, m, 0).getDate();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Read one date in the given order; null if it isn't a real calendar date. Two-digit years mean 20xx. */
export function parseDate(raw: string, order: DateOrder): string | null {
  const s = raw.trim().replace(/\s+\d{1,2}:\d{2}.*$/, "");
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    return isRealDate(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
  }
  const m3 = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (!m3) return null;
  const a = Number(m3[1]);
  const b = Number(m3[2]);
  let y = Number(m3[3]);
  if (m3[3].length === 2) y += 2000;
  if (order === "ymd") return null; // a day-first or month-first date can't be read as year-first
  const [month, day] = order === "mdy" ? [a, b] : [b, a];
  return isRealDate(y, month, day) ? `${y}-${pad(month)}-${pad(day)}` : null;
}

/**
 * Work out the order of a column of dates. Year-first is unmistakable. For the
 * rest, a value like 25/03/2025 can only be day-first and 03/25/2025 only
 * month-first; if every date fits both, the answer is "ambiguous" and the
 * person decides.
 */
export function detectDateOrder(samples: string[]): DateOrder | "ambiguous" | "unreadable" {
  const cells = samples.map((s) => s.trim()).filter(Boolean);
  if (cells.length === 0) return "unreadable";
  if (cells.every((c) => /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(c))) return "ymd";
  let mdy = 0;
  let dmy = 0;
  let unreadable = 0;
  for (const c of cells) {
    const a = parseDate(c, "mdy") !== null;
    const b = parseDate(c, "dmy") !== null;
    if (!a && !b) unreadable++;
    if (a && !b) mdy++;
    if (b && !a) dmy++;
  }
  if (unreadable > cells.length / 2) return "unreadable";
  if (mdy > 0 && dmy === 0) return "mdy";
  if (dmy > 0 && mdy === 0) return "dmy";
  if (mdy > 0 && dmy > 0) return "ambiguous";
  return "ambiguous";
}

/** Read an amount into integer cents: "$1,234.56", "(12.34)", "12.34-", "-12.34", "1.234,56". null if it isn't a number. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (s === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$€£\s]/g, "");
  // "12.34DR" is a debit (money out); "12.34CR" is a credit.
  const suffix = s.match(/(CR|DR)$/i);
  if (suffix) {
    if (suffix[1].toUpperCase() === "DR") negative = !negative;
    s = s.slice(0, -2);
  }
  if (s.startsWith("-") || s.startsWith("−")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  // 1.234,56 (comma decimal) versus 1,234.56.
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return negative ? -cents : cents;
}

// --- Reading rows into transactions ----------------------------------------------------

export interface ImportOptions {
  order: DateOrder;
  /** With one amount column: true when money going out is written as a negative number. */
  outIsNegative: boolean;
  /** Lets a category column in the file line up with ZeraphDesk's own (lowercased name or id to id). */
  knownCategories?: Map<string, string>;
}

export interface ParsedRow {
  /** The row's line in the file, counting the heading row, for error messages. */
  line: number;
  date: string;
  description: string;
  merchant: string;
  /** Negative is money out. */
  amountCents: number;
  /** The category to show: the file's own if it matched one of ours, else a guess from the words. */
  categoryHint: string | null;
  /** Only the file's own category, when it named one of ours. This is what gets stored; guesses are recomputed. */
  fileCategory: string | null;
  balanceCents: number | null;
}

export interface Interpretation {
  rows: ParsedRow[];
  invalid: { line: number; reason: string }[];
  /** The account balance implied by the file's balance column, at the latest date in it. */
  latestBalance: { date: string; cents: number } | null;
  /** The last balance each day, when the file has a balance column. */
  balancesByDate: Map<string, number>;
}

const NOISE = /^(pos (purchase|debit)|debit card purchase|checkcard|purchase authorized on|recurring payment|ach (debit|credit)|online payment|external withdrawal|card purchase)\s*[-:]?\s*/i;

/** A tidier name for a statement line: noise words, store numbers and trailing dates removed. */
export function cleanMerchant(description: string): string {
  let s = description.replace(/\s+/g, " ").trim();
  s = s.replace(NOISE, "");
  s = s.replace(/\s+#?\d{3,}\b.*$/, "").replace(/\s+\d{1,2}\/\d{1,2}(\/\d{2,4})?$/, "").replace(/[\s*-]+$/, "");
  if (s === "") s = description.trim();
  // ALL CAPS statement lines read better in title case.
  if (s === s.toUpperCase() && /[A-Z]/.test(s)) s = s.toLowerCase().replace(/(^|[\s&/-])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
  return s.slice(0, 80);
}

const RULES: { id: string; words: RegExp }[] = [
  // Deliberately strict: a line wrongly called a transfer disappears from spending, which is worse than one left as "Other".
  // "AUTOPAY" alone is not here; utilities and insurance use it too.
  { id: "transfers", words: /\b(transfer|xfer|payment,? thank you|credit card (payment|pmt|autopay)|card (payment|pmt)|crd autopay|autopay payment|pymt to .*card|payment to .*card)\b/i },
  { id: "investments", words: /\b(vanguard|fidelity|schwab|robinhood|brokerage|etrade|e\*trade|wealthfront|betterment|401k|ira contribution)\b/i },
  { id: "income", words: /\b(payroll|direct dep|direct deposit|salary|paycheck|interest paid|interest earned|dividend|tax refund)\b/i },
  { id: "subscriptions", words: /\b(netflix|spotify|hulu|disney\s?plus|hbo|youtube (premium|tv)|apple\.com\/bill|itunes|icloud|google (one|storage)|subscription|membership|patreon|audible|dropbox|adobe)\b/i },
  { id: "housing", words: /\b(rent|mortgage|landlord|apartments?|property mgmt|hoa)\b/i },
  { id: "utilities", words: /\b(electric|power (co|company)|power\s*(&|and)\s*light|light (co|company)|gas (co|company)|water (dept|bill|utility)|utility|utilities|internet|comcast|xfinity|verizon|at&t|t-mobile|spectrum|fiber|wireless|natural gas|sewer)\b/i },
  { id: "insurance", words: /\b(insurance|geico|state farm|progressive|allstate|premium)\b/i },
  { id: "debt", words: /\b(loan pmt|loan payment|student loan|auto loan|navient|nelnet|sallie mae)\b/i },
  { id: "healthcare", words: /\b(pharmacy|cvs|walgreens|rite aid|dental|dentist|clinic|hospital|medical|doctor|urgent care|optometr)\b/i },
  { id: "travel", words: /\b(airline|airlines|airways|delta air|united air|american air|southwest|jetblue|hotel|marriott|hilton|hyatt|airbnb|expedia|booking\.com)\b/i },
  { id: "transportation", words: /\b(uber(?! eats)|lyft|shell|chevron|exxon|mobil|bp\b|fuel|gasoline|gas station|parking|transit|metro card|toll|amtrak)\b/i },
  { id: "dining", words: /\b(restaurant|cafe|coffee|starbucks|mcdonald|burger|pizza|grill|kitchen|diner|bistro|taqueria|sushi|doordash|uber eats|grubhub|bar & grill|bakery)\b/i },
  { id: "food", words: /\b(grocer|grocery|supermarket|market|kroger|safeway|whole foods|trader joe|aldi|publix|wegmans|costco|food (lion|mart))\b/i },
  { id: "entertainment", words: /\b(cinema|theater|theatre|movie|ticket|concert|steam games|playstation|xbox|nintendo)\b/i },
  { id: "shopping", words: /\b(amazon|amzn|target|walmart|best buy|ikea|home depot|lowe's|etsy|ebay|store)\b/i },
];

/** A first guess at a category from the words on the statement line. The person can change any of them. */
export function guessCategory(description: string, amountCents: number): string | null {
  for (const r of RULES) if (r.words.test(description)) return r.id;
  return amountCents > 0 ? "income" : null;
}

/** Turn the file's rows into transactions, reporting every row that couldn't be read. */
export function interpretRows(rows: string[][], hasHeader: boolean, map: ColumnMap, opts: ImportOptions): Interpretation {
  const out: ParsedRow[] = [];
  const invalid: { line: number; reason: string }[] = [];
  const start = hasHeader ? 1 : 0;
  const cell = (r: string[], i: number | null) => (i === null ? "" : (r[i] ?? "").trim());

  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    if (map.date === null) {
      invalid.push({ line, reason: "No date column is chosen." });
      continue;
    }
    const date = parseDate(cell(r, map.date), opts.order);
    if (date === null) {
      invalid.push({ line, reason: `"${cell(r, map.date).slice(0, 24)}" isn't a date I can read.` });
      continue;
    }

    let cents: number | null = null;
    if (map.amount !== null) {
      const raw = parseAmount(cell(r, map.amount));
      if (raw === null) {
        invalid.push({ line, reason: `"${cell(r, map.amount).slice(0, 24)}" isn't an amount I can read.` });
        continue;
      }
      cents = opts.outIsNegative ? raw : -raw;
    } else {
      const out1 = cell(r, map.debit) === "" ? null : parseAmount(cell(r, map.debit));
      const in1 = cell(r, map.credit) === "" ? null : parseAmount(cell(r, map.credit));
      if (out1 === null && in1 === null) {
        invalid.push({ line, reason: "No amount in the money-out or money-in column." });
        continue;
      }
      cents = (in1 !== null ? Math.abs(in1) : 0) - (out1 !== null ? Math.abs(out1) : 0);
    }

    const description = cell(r, map.description).replace(/\s+/g, " ");
    const catRaw = cell(r, map.category).toLowerCase();
    const known = opts.knownCategories?.get(catRaw) ?? null;
    out.push({
      line,
      date,
      description: description || "(no description)",
      merchant: cleanMerchant(description || "(no description)"),
      amountCents: cents,
      categoryHint: known ?? guessCategory(description, cents),
      fileCategory: known,
      balanceCents: map.balance === null || cell(r, map.balance) === "" ? null : parseAmount(cell(r, map.balance)),
    });
  }

  // The balance column gives the last balance of each day; the file may run newest-first or oldest-first.
  const balancesByDate = new Map<string, number>();
  let latestBalance: Interpretation["latestBalance"] = null;
  const withBalance = out.filter((x) => x.balanceCents !== null);
  if (withBalance.length > 0) {
    const newestFirst = out.length > 1 && out[0].date > out[out.length - 1].date;
    // Within a day, the last row in time order is the last in an oldest-first file and the first in a newest-first one.
    const ordered = newestFirst ? [...withBalance].reverse() : withBalance;
    for (const x of ordered) balancesByDate.set(x.date, x.balanceCents as number);
    const latest = [...balancesByDate.keys()].sort().pop() as string;
    latestBalance = { date: latest, cents: balancesByDate.get(latest) as number };
  }
  return { rows: out, invalid, latestBalance, balancesByDate };
}

// --- Stable ids ---------------------------------------------------------------------------

/** A short stable hash (cyrb53) as hex, so re-importing the same row makes the same id. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/**
 * An id for each row that is the same every time the same row is imported, and
 * different for two genuine identical purchases on one day (a second coffee):
 * the count of identical rows earlier in the same file is part of it.
 */
export function assignIds(accountId: string, rows: ParsedRow[]): { id: string; row: ParsedRow }[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = `${accountId}|${row.date}|${row.amountCents}|${row.description.toLowerCase()}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { id: `imp-${hashText(`${base}|${n}`)}`, row };
  });
}

/**
 * For a file with no heading row: guess the columns from what's in them. A date
 * column is one where nearly every cell is a date, an amount column one where
 * nearly every cell is a number, and the description is the longest text.
 */
export function guessColumnsFromData(rows: string[][]): ColumnMap {
  const sample = rows.slice(0, 50);
  const width = Math.max(0, ...sample.map((r) => r.length));
  const map: ColumnMap = { ...EMPTY_MAP };
  const share = (col: number, test: (c: string) => boolean) => {
    const cells = sample.map((r) => (r[col] ?? "").trim()).filter((c) => c !== "");
    return cells.length === 0 ? 0 : cells.filter(test).length / cells.length;
  };
  const isDate = (c: string) => (["ymd", "mdy", "dmy"] as DateOrder[]).some((o) => parseDate(c, o) !== null);
  const isNumber = (c: string) => /\d/.test(c) && !/[a-z]{2,}/i.test(c) && parseAmount(c) !== null && !isDate(c);
  const taken = new Set<number>();
  for (let c = 0; c < width; c++) {
    if (map.date === null && share(c, isDate) >= 0.8) {
      map.date = c;
      taken.add(c);
    }
  }
  // Numeric columns. Two half-empty ones that fill each other in are money out and money in; otherwise the first is the amount.
  const filled = (col: number) => sample.filter((r) => (r[col] ?? "").trim() !== "").length / Math.max(1, sample.length);
  const numeric = Array.from({ length: width }, (_, c) => c).filter((c) => !taken.has(c) && share(c, isNumber) >= 0.8);
  const sparse = numeric.filter((c) => filled(c) <= 0.85);
  const complementary =
    sparse.length >= 2 &&
    sample.filter((r) => (r[sparse[0]] ?? "").trim() !== "" || (r[sparse[1]] ?? "").trim() !== "").length / Math.max(1, sample.length) >= 0.9 &&
    sample.every((r) => !((r[sparse[0]] ?? "").trim() !== "" && (r[sparse[1]] ?? "").trim() !== ""));
  if (complementary) {
    map.debit = sparse[0];
    map.credit = sparse[1];
    taken.add(sparse[0]);
    taken.add(sparse[1]);
  } else if (numeric.length > 0) {
    map.amount = numeric[0];
    taken.add(numeric[0]);
  }
  let best = -1;
  let bestLen = 0;
  for (let c = 0; c < width; c++) {
    if (taken.has(c) || share(c, (x) => !isNumber(x) && !isDate(x)) < 0.8) continue;
    const avg = sample.reduce((s, r) => s + (r[c] ?? "").length, 0) / Math.max(1, sample.length);
    if (avg > bestLen) {
      best = c;
      bestLen = avg;
    }
  }
  if (best >= 0) map.description = best;
  return map;
}
