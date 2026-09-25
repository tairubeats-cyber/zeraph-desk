import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextField } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { db, newEvent } from "@/lib/db";
import type { Finance } from "@/lib/finance/useFinance";
import { formatMoney } from "@/lib/finance/money";
import { DAILY_REQUEST_LIMIT, MAX_WINDOWS, balanceCentsFor, guessKind, requestsInLastDay, type SfAccount } from "@/lib/finance/simplefin";
import { addSyncedAccounts, discoverAccounts, simplefin, syncNow, type Discovery, type SyncOutcome } from "@/lib/finance/syncSimplefin";
import { ACCOUNT_KINDS, type AccountKind, type ImportedAccount, type SyncRun } from "@/lib/finance/types";

function reason(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : "Something went wrong.";
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

interface Pick {
  include: boolean;
  kind: AccountKind;
  owedPositive: boolean;
}

/** Only US dollars: every figure in ZeraphDesk is formatted as dollars, and converting would be a guess. */
const isDollars = (a: SfAccount) => a.currency === "USD";

type Busy = null | "claim" | "discover" | "sync" | "add";

export function SimplefinConnection({ finance, onNotify, onChanged }: { finance: Finance; onNotify: (message: string) => void; onChanged: () => void }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [linked, setLinked] = useState<ImportedAccount[]>([]);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, r, a] = await Promise.all([simplefin.isConnected(), db.syncRuns(), db.srcAccounts()]);
      setConnected(c);
      setRuns(r);
      setLinked(a.filter((x) => x.provider === "simplefin"));
    } catch (err) {
      setConnected(false);
      setError(reason(err));
    }
  }, []);

  // Accounts can be removed further down this page; when the data changes, look again (and drop a summary that no longer applies).
  const snapshot = finance.snapshot;
  useEffect(() => {
    void load();
  }, [load, snapshot]);
  useEffect(() => {
    if (linked.length === 0) setOutcome(null);
  }, [linked.length]);

  const lastSync = runs.find((r) => r.kind === "sync" && r.ok) ?? null;
  const usedToday = useMemo(() => requestsInLastDay(runs, new Date()), [runs]);
  const firstEver = finance.source === "sample";

  async function changed() {
    await load();
    await finance.reload();
    onChanged();
  }

  async function look() {
    setError(null);
    setOutcome(null);
    setBusy("discover");
    try {
      const d = await discoverAccounts();
      const next: Record<string, Pick> = {};
      for (const a of d.accounts) {
        const kind = guessKind(a.name);
        next[a.key] = { include: !d.known.has(a.key) && isDollars(a), kind, owedPositive: false };
      }
      setPicks(next);
      setDiscovery(d);
      await load();
    } catch (err) {
      setError(reason(err));
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return setError("Paste the setup token from SimpleFIN first.");
    setError(null);
    setBusy("claim");
    try {
      await simplefin.claim(token);
      setToken("");
      await db.log(newEvent("simplefin_connected", null, {}));
      await load();
    } catch (err) {
      setError(reason(err));
      setBusy(null);
      return;
    }
    setBusy(null);
    await look();
  }

  async function addChosen() {
    if (!discovery) return;
    const choices = discovery.accounts.filter((a) => picks[a.key]?.include).map((a) => ({ account: a, kind: picks[a.key].kind, owedPositive: picks[a.key].owedPositive }));
    if (choices.length === 0) return setError("Choose at least one account to add.");
    setError(null);
    setBusy("add");
    try {
      await addSyncedAccounts(choices);
      setDiscovery(null);
      setBusy("sync");
      const result = await syncNow();
      setOutcome(result);
      await changed();
      onNotify(`Added ${choices.length} ${choices.length === 1 ? "account" : "accounts"}`);
    } catch (err) {
      setError(reason(err));
      await changed();
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    setError(null);
    setOutcome(null);
    setBusy("sync");
    try {
      const result = await syncNow();
      setOutcome(result);
      await changed();
    } catch (err) {
      setError(reason(err));
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    try {
      await simplefin.disconnect();
      await db.log(newEvent("simplefin_disconnected", null, {}));
      setConfirmingDisconnect(false);
      setDiscovery(null);
      setOutcome(null);
      await load();
      onNotify("Disconnected. Your accounts and their transactions stay.");
    } catch (err) {
      setError(reason(err));
    }
  }

  if (connected === null) return null;

  const chosen = discovery ? discovery.accounts.filter((a) => picks[a.key]?.include).length : 0;

  return (
    <Card className="p-5 md:p-6">
      <div className="flex items-start justify-between gap-4 max-md:flex-col">
        <div className="min-w-0">
          <h3 className="text-heading text-ink">Link your accounts with SimpleFIN</h3>
          <p className="mt-2 max-w-[62ch] text-body text-ink-secondary">
            {connected ? (
              <>
                <span className="font-medium text-ink">Connected.</span>{" "}
                {lastSync ? `Last synced ${when(lastSync.at)}.` : "Nothing has been synced yet."} ZeraphDesk fetches balances and transactions only when you press Sync.
                It can read them and can't move money.
              </>
            ) : (
              <>
                SimpleFIN Bridge is a separate, paid service that reads your bank for you. You sign up and link your bank on their site, so ZeraphDesk never sees your
                bank login. They give you a setup token; paste it here. ZeraphDesk keeps a read-only key in your system's keychain and asks the bridge for balances and
                transactions when you press Sync. Nothing syncs on its own.
              </>
            )}
          </p>
        </div>
        {connected && !discovery && (
          <div className="flex shrink-0 flex-wrap gap-2 max-md:w-full">
            <Button variant="primary" loading={busy === "sync"} disabled={busy !== null || linked.length === 0} onClick={() => void sync()}>
              <RefreshCw className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </Button>
            <Button variant="secondary" loading={busy === "discover"} disabled={busy !== null} onClick={() => void look()}>
              {linked.length === 0 ? "Choose accounts" : "Add more accounts"}
            </Button>
          </div>
        )}
      </div>

      {!connected && (
        <form noValidate onSubmit={(e) => void connect(e)} className="mt-5 max-w-xl border-t border-line pt-5">
          <TextField
            label="Setup token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            help="From bridge.simplefin.org. Each token works once."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste the setup token"
          />
          <div className="mt-3 flex justify-end">
            <Button type="submit" variant="primary" loading={busy === "claim" || busy === "discover"} disabled={busy !== null}>
              {busy === "claim" ? "Connecting…" : busy === "discover" ? "Finding accounts…" : "Connect"}
            </Button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-4 flex items-start gap-2 text-label font-normal text-danger">
          <CircleAlert className="mt-px h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          {error}
        </p>
      )}

      {discovery && (
        <div className="mt-5 border-t border-line pt-5">
          <h4 className="text-body font-medium text-ink">Choose the accounts to add</h4>
          <p className="mt-1 max-w-[62ch] text-label font-normal text-ink-secondary">
            The bridge doesn't say what kind of account each one is, so this is a first guess from its name. Check each one: a debt counted as an asset would change your net worth.
          </p>
          {firstEver && chosen > 0 && (
            <p role="note" className="mt-3 rounded-control bg-warning-soft px-3 py-2 text-body text-ink">
              Adding your first account replaces the sample data with your own.
            </p>
          )}
          {discovery.messages.length > 0 && (
            <p role="note" className="mt-3 text-label font-normal text-ink-secondary">
              SimpleFIN says: {discovery.messages.join(" ")}
            </p>
          )}
          {discovery.accounts.length === 0 ? (
            <p className="mt-4 text-body text-ink-secondary">The bridge didn't list any accounts. Link a bank at the bridge first, then try again.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {discovery.accounts.map((a) => {
                const pick = picks[a.key];
                const known = discovery.known.has(a.key);
                const usable = isDollars(a) && !known;
                const liability = ACCOUNT_KINDS[pick.kind].class === "liability";
                const cents = balanceCentsFor(a, pick.kind, pick.owedPositive);
                return (
                  <li key={a.key} className="rounded-control border border-line p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <label className="flex min-w-0 items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0 accent-accent"
                          disabled={!usable}
                          checked={pick.include && usable}
                          onChange={(e) => setPicks({ ...picks, [a.key]: { ...pick, include: e.target.checked } })}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-body font-medium text-ink">{a.name}</span>
                          <span className="block text-label font-normal text-ink-tertiary">
                            {a.orgName}
                            {known ? " · already added" : ""}
                            {!isDollars(a) ? ` · ${a.currency || "unknown currency"}, which ZeraphDesk can't show` : ""}
                          </span>
                        </span>
                      </label>
                      <p className="text-body tabular-nums text-ink">
                        {!isDollars(a) ? `${a.balance} ${a.currency}` : cents === null ? "Balance unreadable" : formatMoney(cents, { cents: true })}
                        {cents !== null && liability && isDollars(a) && <span className="text-label font-normal text-ink-tertiary"> owed</span>}
                      </p>
                    </div>
                    {usable && pick.include && (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <label htmlFor={`kind-${a.key}`} className="text-label text-ink">
                            Kind of account
                          </label>
                          <Select
                            id={`kind-${a.key}`}
                            className="mt-1.5"
                            value={pick.kind}
                            onChange={(e) => setPicks({ ...picks, [a.key]: { ...pick, kind: e.target.value as AccountKind } })}
                          >
                            {(Object.keys(ACCOUNT_KINDS) as AccountKind[]).map((k) => (
                              <option key={k} value={k}>
                                {ACCOUNT_KINDS[k].label}
                              </option>
                            ))}
                          </Select>
                        </div>
                        {liability && (
                          <div>
                            <label htmlFor={`sign-${a.key}`} className="text-label text-ink">
                              This bank shows what you owe as
                            </label>
                            <Select
                              id={`sign-${a.key}`}
                              className="mt-1.5"
                              value={pick.owedPositive ? "positive" : "negative"}
                              onChange={(e) => setPicks({ ...picks, [a.key]: { ...pick, owedPositive: e.target.value === "positive" } })}
                            >
                              <option value="negative">A negative number (the usual way)</option>
                              <option value="positive">A positive number</option>
                            </Select>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <Button variant="tertiary" disabled={busy !== null} onClick={() => setDiscovery(null)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy === "add" || busy === "sync"} disabled={busy !== null || chosen === 0} onClick={() => void addChosen()}>
              {busy === "sync" ? "Fetching transactions…" : chosen === 1 ? "Add 1 account and sync" : `Add ${chosen} accounts and sync`}
            </Button>
          </div>
        </div>
      )}

      {outcome && (
        <div role="status" className="mt-4 text-body text-ink-secondary">
          <p>
            <span className="font-medium text-ink">
              Synced {outcome.accounts} {outcome.accounts === 1 ? "account" : "accounts"} and added {outcome.added} new {outcome.added === 1 ? "transaction" : "transactions"}.
            </span>{" "}
            Categories are first guesses you can change under Transactions.
            {outcome.unmapped > 0 && ` The bridge lists ${outcome.unmapped} more ${outcome.unmapped === 1 ? "account" : "accounts"} you haven't added.`}
          </p>
          {outcome.messages.length > 0 && <p className="mt-1">Worth a look: {outcome.messages.join(" ")}</p>}
        </div>
      )}

      {connected && !discovery && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-meta text-ink-tertiary">
              A sync uses up to {MAX_WINDOWS} of the bridge's roughly 24 daily requests. {usedToday} used in the last 24 hours (ZeraphDesk stops at {DAILY_REQUEST_LIMIT}).
            </p>
            {!confirmingDisconnect && (
              <Button variant="tertiary" size="sm" onClick={() => setConfirmingDisconnect(true)}>
                Disconnect SimpleFIN
              </Button>
            )}
          </div>
          {confirmingDisconnect && (
            <div role="group" aria-label="Disconnect SimpleFIN" className="mt-3">
              <p className="text-label font-normal text-ink-secondary">
                Forget the connection on this computer? Your accounts and transactions stay. To stop the bridge from sharing your data, also turn the token off in your account at
                bridge.simplefin.org.
              </p>
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="tertiary" size="sm" onClick={() => setConfirmingDisconnect(false)}>
                  Keep it
                </Button>
                <Button variant="secondary" size="sm" className="text-danger" onClick={() => void disconnect()}>
                  Disconnect
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {!connected && linked.length > 0 && (
        <p className="mt-4 text-label font-normal text-ink-secondary">
          {linked.length} {linked.length === 1 ? "account is" : "accounts are"} linked but SimpleFIN isn't connected, so they won't update. Paste a new setup token to reconnect.
        </p>
      )}
    </Card>
  );
}
