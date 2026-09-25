/**
 * Reading what SimpleFIN Bridge sends back. Pure: text in, plain values out. The network call and the
 * keychain live in Rust (simplefin.rs); saving lives in syncSimplefin.ts.
 *
 * The bridge speaks two shapes of the same protocol. Version 1 has `errors` (strings) and an `org` on each
 * account; version 2 has `errlist` (objects), a `connections` list and a `conn_id` on each account. Both are
 * read here, so it doesn't matter which one the bridge answers with.
 */
import { cleanMerchant, hashText } from "./csv";
import type { AccountKind, Transaction } from "./types";
import { ACCOUNT_KINDS } from "./types";

export interface SfTransaction {
  id: string;
  /** Unix seconds; 0 while pending. */
  posted: number;
  /** A decimal string, negative for money out. */
  amount: string;
  description: string;
  /** The cleaner name of who was paid, when the bank gives one. */
  payee: string;
  memo: string;
  pending: boolean;
}

export interface SfAccount {
  /** The bridge's id, made unique across connections (`conn_id:id` when the bridge sends a connection). */
  key: string;
  name: string;
  orgName: string;
  currency: string;
  balance: string;
  /** Unix seconds, 0 when the bridge didn't say. */
  balanceDate: number;
  transactions: SfTransaction[];
}

export interface SfReply {
  accounts: SfAccount[];
  /** What the bridge said needs attention, in its own words. */
  messages: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const seconds = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export function parseSimplefin(body: string): SfReply {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error("SimpleFIN's reply wasn't in a form ZeraphDesk can read.");
  }
  if (!isObject(json) || !Array.isArray(json.accounts)) throw new Error("SimpleFIN's reply wasn't in a form ZeraphDesk can read.");

  const messages: string[] = [];
  if (Array.isArray(json.errors)) for (const e of json.errors) if (typeof e === "string" && e.trim()) messages.push(e.trim());
  if (Array.isArray(json.errlist)) {
    for (const e of json.errlist) {
      const m = isObject(e) ? text(e.msg).trim() : "";
      if (m) messages.push(m);
    }
  }

  const connectionNames = new Map<string, string>();
  if (Array.isArray(json.connections)) {
    for (const c of json.connections) if (isObject(c) && text(c.conn_id)) connectionNames.set(text(c.conn_id), text(c.name) || text(c.org_url));
  }

  const accounts: SfAccount[] = [];
  for (const raw of json.accounts) {
    if (!isObject(raw)) continue;
    const id = text(raw.id);
    if (!id) continue;
    const connId = text(raw.conn_id);
    const org = isObject(raw.org) ? raw.org : null;
    const orgName = (org && (text(org.name) || text(org.domain))) || connectionNames.get(connId) || "Your bank";
    const transactions: SfTransaction[] = [];
    if (Array.isArray(raw.transactions)) {
      for (const t of raw.transactions) {
        if (!isObject(t) || !text(t.id)) continue;
        transactions.push({
          id: text(t.id),
          posted: seconds(t.posted),
          amount: text(t.amount),
          description: text(t.description),
          payee: text(t.payee),
          memo: text(t.memo),
          pending: t.pending === true,
        });
      }
    }
    accounts.push({
      key: connId ? `${connId}:${id}` : id,
      name: text(raw.name).trim() || "Account",
      orgName: orgName.trim(),
      currency: text(raw.currency).trim().toUpperCase(),
      balance: text(raw.balance),
      balanceDate: seconds(raw["balance-date"]),
      transactions,
    });
  }
  return { accounts, messages };
}

/**
 * A decimal string to whole cents, without going through floating point. Null if it isn't a plain number.
 * Anything past the second decimal place is rounded (half away from zero).
 */
export function decimalToCents(raw: string): number | null {
  const m = /^\s*([+-]?)(\d*)(?:\.(\d*))?\s*$/.exec(raw);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return null;
  const whole = m[2] === "" ? "0" : m[2];
  if (whole.length > 12) return null;
  const frac = (m[3] ?? "").padEnd(3, "0");
  let cents = Number(whole) * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1;
  return m[1] === "-" && cents !== 0 ? -cents : cents;
}

/**
 * The calendar date a Unix time falls on, read in UTC. Banks send a posting date as midnight UTC, so reading
 * it in a US time zone would call every posting the day before.
 */
export function utcDate(secondsSinceEpoch: number): string {
  return new Date(secondsSinceEpoch * 1000).toISOString().slice(0, 10);
}

export interface MappedTransactions {
  rows: Transaction[];
  /** Pending lines. They aren't stored: what's pending can change or vanish before it posts. */
  pending: number;
  /** Lines whose amount or date couldn't be read. */
  invalid: number;
}

export function mapTransactions(accountId: string, account: SfAccount): MappedTransactions {
  const rows: Transaction[] = [];
  const seen = new Map<string, number>();
  let pending = 0;
  let invalid = 0;
  for (const t of account.transactions) {
    if (t.pending || t.posted <= 0) {
      pending++;
      continue;
    }
    const cents = decimalToCents(t.amount);
    if (cents === null) {
      invalid++;
      continue;
    }
    const tidy = (v: string) => v.replace(/\s+/g, " ").trim();
    const description = tidy(t.description) || tidy(t.memo) || tidy(t.payee) || "(no description)";
    // The bridge promises a line's id is unique within its account. If one repeats anyway, the repeats are told apart
    // by their order, so none is silently dropped and the same line still gets the same id on every fetch.
    const nth = seen.get(t.id) ?? 0;
    seen.set(t.id, nth + 1);
    rows.push({
      // The bridge's id for a line is stable, so the same line syncs once however many times it is fetched.
      id: `sf-${hashText(nth === 0 ? `${account.key}|${t.id}` : `${account.key}|${t.id}|${nth}`)}`,
      accountId,
      date: utcDate(t.posted),
      merchant: cleanMerchant(tidy(t.payee) || description),
      description,
      amountCents: cents,
      categoryHint: null,
      pending: false,
    });
  }
  return { rows, pending, invalid };
}

/**
 * The bridge doesn't say what kind of account something is, so this is a first guess from its name. The person
 * sees it and can change it before anything is saved; a wrong kind would turn a debt into an asset.
 */
export function guessKind(name: string): AccountKind {
  const n = name.toLowerCase();
  if (/mortgage|home loan/.test(n)) return "mortgage";
  if (/student/.test(n)) return "student_loan";
  if (/\bauto\b|\bcar\b|vehicle/.test(n) && /loan|financ|lease/.test(n)) return "auto_loan";
  if (/\bloan\b|line of credit|\bloc\b/.test(n)) return "personal_loan";
  if (/credit|visa|mastercard|master card|amex|american express|discover|\bcard\b/.test(n) && !/debit/.test(n)) return "credit_card";
  if (/401|403\(b\)|\bira\b|roth|retire|pension|\brsp\b/.test(n)) return "retirement";
  if (/brokerage|invest|trading|stock/.test(n)) return "brokerage";
  if (/saving|money market|\bmm\b|\bhysa\b/.test(n)) return "savings";
  return "checking";
}

/** The balance to record, as the app stores it: an asset as it is, a debt as the (positive) amount owed. */
export function balanceCentsFor(account: SfAccount, kind: AccountKind, owedPositive: boolean): number | null {
  const cents = decimalToCents(account.balance);
  if (cents === null) return null;
  if (ACCOUNT_KINDS[kind].class === "asset") return cents;
  return owedPositive ? cents : -cents;
}

// --- when and how much to ask -------------------------------------------------------------------

const DAY = 86_400;
/** The bridge limits a window to 90 days but warns above 45 ("may be capped in the future"), so windows stay at 45. */
export const WINDOW_DAYS = 45;
export const MAX_WINDOWS = 4;
/** The bridge allows about 24 requests a day. This leaves room for a retry. */
export const DAILY_REQUEST_LIMIT = 20;
/** Banks post late and sometimes revise, so each sync looks back past the last one. */
export const OVERLAP_DAYS = 14;

export interface Window {
  start: number;
  end: number;
}

/** How far back one sync reaches: about six months. */
export const MAX_LOOKBACK_DAYS = WINDOW_DAYS * MAX_WINDOWS;

/**
 * The date windows to fetch, newest first, each within the bridge's limit and touching the next (start is
 * inclusive, end is not, so nothing is missed or read twice). The first sync reaches back about six months; later
 * ones start a couple of weeks before the last complete sync.
 */
export function planWindows(nowSeconds: number, lastSyncAt: string | null): Window[] {
  const end = Math.floor(nowSeconds / DAY) * DAY + DAY;
  const span = WINDOW_DAYS * DAY;
  let from = end - MAX_WINDOWS * span;
  if (lastSyncAt) {
    const last = Date.parse(lastSyncAt);
    if (Number.isFinite(last)) from = Math.max(from, Math.floor(last / 1000 / DAY) * DAY - OVERLAP_DAYS * DAY);
  }
  const windows: Window[] = [];
  for (let hi = end; hi > from && windows.length < MAX_WINDOWS; hi -= span) windows.push({ start: Math.max(from, hi - span), end: hi });
  return windows;
}

/** Requests made in the last 24 hours, from the sync log. */
export function requestsInLastDay(runs: { at: string; requests: number }[], now: Date): number {
  const since = now.getTime() - DAY * 1000;
  return runs.filter((r) => Date.parse(r.at) > since).reduce((sum, r) => sum + r.requests, 0);
}
