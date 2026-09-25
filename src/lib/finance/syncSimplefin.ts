/**
 * The SimpleFIN steps that touch the outside world: connect, look at the accounts, sync. Each is called by a
 * click. Rust makes the requests and holds the access URL; this file decides what to ask for, and saves what
 * comes back through the same tables an imported file uses.
 */
import { invoke } from "@tauri-apps/api/core";
import { db, newEvent } from "../db";
import {
  DAILY_REQUEST_LIMIT,
  OVERLAP_DAYS,
  balanceCentsFor,
  mapTransactions,
  parseSimplefin,
  planWindows,
  requestsInLastDay,
  utcDate,
  type SfAccount,
} from "./simplefin";
import { toISODate } from "./money";
import type { AccountKind, SyncRun } from "./types";

function reason(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : "Something went wrong.";
}

export const simplefin = {
  isConnected: () => invoke<boolean>("simplefin_connected"),

  /** Trade the setup token for a saved connection. Returns the bridge's host name. */
  claim: (setupToken: string) => invoke<string>("simplefin_claim", { setupToken }),

  /** Forget the connection on this computer. */
  disconnect: () => invoke<void>("simplefin_disconnect"),
};

function runId() {
  return `sync-${crypto.randomUUID()}`;
}

async function budgetError(needed: number): Promise<string | null> {
  const used = requestsInLastDay(await db.syncRuns(), new Date());
  if (used + needed > DAILY_REQUEST_LIMIT) {
    return "SimpleFIN allows only about 24 requests a day, and today's are used up. Try again tomorrow.";
  }
  return null;
}

export interface Discovery {
  accounts: SfAccount[];
  /** Accounts already set up in ZeraphDesk, by bridge key. */
  known: Set<string>;
  messages: string[];
}

/** One request for the accounts and their balances, without transactions. Nothing is saved. */
export async function discoverAccounts(): Promise<Discovery> {
  const blocked = await budgetError(1);
  if (blocked) throw new Error(blocked);
  const at = new Date().toISOString();
  try {
    const reply = parseSimplefin(await invoke<string>("simplefin_accounts", { start: null, end: null, balancesOnly: true }));
    await db.logSyncRun({ id: runId(), kind: "discover", at, ok: true, complete: true, requests: 1, accounts: reply.accounts.length, added: 0, message: reply.messages.join(" ") || null });
    const known = new Set((await db.srcAccounts()).filter((a) => a.provider === "simplefin" && a.externalId).map((a) => a.externalId as string));
    return { accounts: reply.accounts, known, messages: reply.messages };
  } catch (err) {
    await db.logSyncRun({ id: runId(), kind: "discover", at, ok: false, complete: true, requests: 1, accounts: 0, added: 0, message: reason(err) });
    throw new Error(reason(err));
  }
}

export interface Choice {
  account: SfAccount;
  kind: AccountKind;
  owedPositive: boolean;
}

/** Set up the accounts the person chose. The balance is the bridge's, dated when the bridge says it was true. */
export async function addSyncedAccounts(choices: Choice[]): Promise<number> {
  const today = toISODate(new Date());
  let added = 0;
  for (const c of choices) {
    const cents = balanceCentsFor(c.account, c.kind, c.owedPositive);
    if (cents === null) continue;
    const id = `srcacct-${crypto.randomUUID()}`;
    await db.saveSrcAccount({
      id,
      name: c.account.name,
      kind: c.kind,
      institution: c.account.orgName,
      mask: null,
      balanceCents: cents,
      createdAt: new Date().toISOString(),
      provider: "simplefin",
      externalId: c.account.key,
      owedPositive: c.owedPositive,
    });
    await db.setSrcBalances(id, new Map([[c.account.balanceDate > 0 ? utcDate(c.account.balanceDate) : today, cents]]));
    await db.log(newEvent("account_synced_added", id, { count: 1 }));
    added++;
  }
  return added;
}

export interface SyncOutcome {
  ok: boolean;
  added: number;
  accounts: number;
  /** In the bridge's own words, plus anything ZeraphDesk noticed. */
  messages: string[];
  /** Accounts the bridge lists that haven't been set up here. */
  unmapped: number;
}

/** Fetch transactions and balances for every synced account and save what's new. */
export async function syncNow(): Promise<SyncOutcome> {
  const accounts = (await db.srcAccounts()).filter((a) => a.provider === "simplefin" && a.externalId);
  if (accounts.length === 0) throw new Error("No SimpleFIN accounts are set up yet.");

  const runs = await db.syncRuns();
  // Look back from the last sync that covered its whole range; a partial one leaves its gap to be fetched again.
  const lastComplete = runs.find((r) => r.kind === "sync" && r.ok && r.complete)?.at ?? null;
  const windows = planWindows(Date.now() / 1000, lastComplete);
  const blocked = await budgetError(windows.length);
  if (blocked) throw new Error(blocked);

  const at = new Date().toISOString();
  const messages: string[] = [];
  const reach = windows[windows.length - 1].start;
  if (lastComplete && Date.parse(lastComplete) / 1000 - OVERLAP_DAYS * 86_400 < reach) {
    messages.push(`It had been a while since the last sync, so transactions before ${utcDate(reach)} may be missing.`);
  }
  const replies = [];
  let requests = 0;
  let complete = true;
  for (const w of windows) {
    requests++;
    try {
      replies.push(parseSimplefin(await invoke<string>("simplefin_accounts", { start: w.start, end: w.end, balancesOnly: false })));
    } catch (err) {
      if (replies.length === 0) {
        await db.logSyncRun({ id: runId(), kind: "sync", at, ok: false, complete: false, requests, accounts: 0, added: 0, message: reason(err) });
        throw new Error(reason(err));
      }
      // The newest part arrived and is kept. The run is marked incomplete, so the next sync covers the missing stretch again.
      messages.push(`Older transactions couldn't be fetched this time, so the next sync will try again. ${reason(err)}`);
      complete = false;
      break;
    }
  }

  for (const m of replies[0].messages) if (!messages.includes(m)) messages.push(m);

  const latest = new Map(replies[0].accounts.map((a) => [a.key, a]));
  let added = 0;
  let synced = 0;
  for (const local of accounts) {
    const sf = latest.get(local.externalId as string);
    if (!sf) {
      messages.push(`${local.name} wasn't in SimpleFIN's reply. Its last balance is unchanged.`);
      continue;
    }
    synced++;
    const cents = balanceCentsFor(sf, local.kind, local.owedPositive);
    if (cents === null) messages.push(`${local.name} had a balance ZeraphDesk couldn't read, so it's unchanged.`);
    else await db.setSrcBalances(local.id, new Map([[sf.balanceDate > 0 ? utcDate(sf.balanceDate) : toISODate(new Date()), cents]]));

    const rows = new Map<string, ReturnType<typeof mapTransactions>["rows"][number]>();
    let invalid = 0;
    for (const reply of replies) {
      const theirs = reply.accounts.find((a) => a.key === sf.key);
      if (!theirs) continue;
      const mapped = mapTransactions(local.id, theirs);
      invalid += mapped.invalid;
      for (const r of mapped.rows) rows.set(r.id, r);
    }
    if (invalid > 0) messages.push(`${invalid} ${invalid === 1 ? "line" : "lines"} in ${local.name} couldn't be read and ${invalid === 1 ? "was" : "were"} skipped.`);
    added += await db.insertSrcTransactions(local.id, [...rows.values()], `sync-${at}`);
  }

  const known = new Set(accounts.map((a) => a.externalId));
  const unmapped = replies[0].accounts.filter((a) => !known.has(a.key)).length;
  const ok = synced > 0;
  await db.logSyncRun({ id: runId(), kind: "sync", at, ok, complete, requests, accounts: synced, added, message: messages.join(" ") || null });
  await db.log(newEvent("account_synced", null, { added, accounts: synced, requests }));
  return { ok, added, accounts: synced, messages, unmapped };
}

export type { SyncRun };
