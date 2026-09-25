import { useCallback, useEffect, useMemo, useState } from "react";
import { FileUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Select, SelectField } from "@/components/ui/select";
import { MoneyInput } from "@/components/finance/inputs";
import { db, newEvent } from "@/lib/db";
import type { Finance } from "@/lib/finance/useFinance";
import {
  EMPTY_MAP,
  assignIds,
  detectColumns,
  detectDateOrder,
  guessColumnsFromData,
  interpretRows,
  looksLikeHeader,
  parseCsv,
  type ColumnMap,
  type DateOrder,
} from "@/lib/finance/csv";
import { formatMoney, parseISODate, toISODate } from "@/lib/finance/money";
import { ACCOUNT_KINDS, type AccountKind, type BalancePoint, type ImportedAccount, type Transaction } from "@/lib/finance/types";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const PREVIEW_ROWS = 8;

const fullDate = (iso: string) =>
  parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const ORDER_LABELS: Record<DateOrder, string> = {
  ymd: "Year first, like 2025-03-04",
  mdy: "Month first, like 03/04/2025 for March 4",
  dmy: "Day first, like 04/03/2025 for March 4",
};

interface ImportResult {
  account: string;
  fileName: string;
  added: number;
  skipped: number;
  invalid: number;
  balance: string | null;
}

function slugId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------------------------------------

function AddAccountForm({ today, first, onSave, onCancel }: { today: string; first: boolean; onSave: (a: ImportedAccount, date: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [kind, setKind] = useState<AccountKind>("checking");
  const [mask, setMask] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const owed = ACCOUNT_KINDS[kind].class === "liability";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the account a name, like Everyday Checking.");
    if (!institution.trim()) return setError("Say which bank or lender it's with.");
    if (balance === null) return setError(owed ? "Enter how much is owed right now (0 if nothing)." : "Enter the balance right now.");
    if (mask && !/^\d{1,4}$/.test(mask)) return setError("The last digits should be up to four numbers.");
    onSave(
      { id: slugId("srcacct"), name: name.trim(), kind, institution: institution.trim(), mask: mask || null, balanceCents: balance, createdAt: new Date().toISOString() },
      date || today,
    );
  }

  return (
    <form noValidate onSubmit={submit} className="grid gap-3 md:grid-cols-2">
      {first && (
        <p role="note" className="rounded-control bg-warning-soft px-3 py-2 text-body text-ink md:col-span-2">
          Adding your first account replaces the sample data with your own. You can go back to the sample by removing imported data.
        </p>
      )}
      <div>
        <label htmlFor="acct-name" className="text-label text-ink">
          Account name
        </label>
        <Input id="acct-name" className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="Everyday Checking" />
      </div>
      <div>
        <label htmlFor="acct-inst" className="text-label text-ink">
          Bank or lender
        </label>
        <Input id="acct-inst" className="mt-1.5" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Harbor Bank" />
      </div>
      <SelectField label="Kind of account" value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
        {(Object.keys(ACCOUNT_KINDS) as AccountKind[]).map((k) => (
          <option key={k} value={k}>
            {ACCOUNT_KINDS[k].label}
          </option>
        ))}
      </SelectField>
      <div>
        <label htmlFor="acct-mask" className="text-label text-ink">
          Last four digits <span className="font-normal text-ink-tertiary">(optional)</span>
        </label>
        <Input id="acct-mask" inputMode="numeric" maxLength={4} className="mt-1.5" value={mask} onChange={(e) => setMask(e.target.value)} placeholder="4821" />
      </div>
      <div>
        <label htmlFor="acct-bal" className="text-label text-ink">
          {owed ? "Amount owed" : "Balance"}
        </label>
        <MoneyInput live id="acct-bal" className="mt-1.5" value={balance} onCommit={setBalance} placeholder="0" />
      </div>
      <div>
        <label htmlFor="acct-date" className="text-label text-ink">
          As of
        </label>
        <Input id="acct-date" type="date" max={today} className="mt-1.5" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-label text-danger md:col-span-2">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 md:col-span-2">
        <Button variant="tertiary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Add account
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------

function ImportWizard({ account, finance, onDone, onCancel }: { account: ImportedAccount; finance: Finance; onDone: (r: ImportResult) => void; onCancel: () => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<string[][] | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [map, setMap] = useState<ColumnMap>(EMPTY_MAP);
  const [order, setOrder] = useState<DateOrder>("mdy");
  const [outIsNegative, setOutIsNegative] = useState(ACCOUNT_KINDS[account.kind].class === "asset");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const known = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of finance.categories) {
      m.set(c.id, c.id);
      m.set(c.name.toLowerCase(), c.id);
    }
    return m;
  }, [finance.categories]);

  async function chooseFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return setError("That file is bigger than 8 MB. A bank export is usually much smaller; try a shorter date range.");
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length < 2 && !(parsed.length === 1 && !looksLikeHeader(parsed[0]))) return setError("There are no transactions in that file.");
      const header = looksLikeHeader(parsed[0]);
      const detected = header ? detectColumns(parsed[0]) : guessColumnsFromData(parsed);
      setFileName(file.name);
      setRows(parsed);
      setHasHeader(header);
      setMap(detected);
      settleOrder(parsed, header, detected);
    } catch {
      setError("I couldn't read that file. Export it from your bank as CSV and try again.");
    }
  }

  /** Detect the date order from the chosen date column; leave the current choice alone if the file can't settle it. */
  function settleOrder(all: string[][], header: boolean, m: ColumnMap) {
    if (m.date === null) return;
    const found = detectDateOrder(all.slice(header ? 1 : 0, 400).map((r) => r[m.date as number] ?? ""));
    if (found !== "ambiguous" && found !== "unreadable") setOrder(found);
  }

  const headers = rows && hasHeader ? rows[0] : null;
  const width = rows ? Math.max(...rows.slice(0, 50).map((r) => r.length)) : 0;
  const columnName = (i: number) => (headers && headers[i]?.trim() ? headers[i].trim() : `Column ${i + 1}`);
  const dateOrderAmbiguous = useMemo(() => {
    if (!rows || map.date === null) return false;
    const found = detectDateOrder(rows.slice(hasHeader ? 1 : 0, 400).map((r) => r[map.date as number] ?? ""));
    return found === "ambiguous";
  }, [rows, map.date, hasHeader]);

  const result = useMemo(
    () => (rows ? interpretRows(rows, hasHeader, map, { order, outIsNegative, knownCategories: known }) : null),
    [rows, hasHeader, map, order, outIsNegative, known],
  );

  const ready = !!result && result.rows.length > 0 && map.date !== null && (map.amount !== null || map.debit !== null || map.credit !== null);
  const dates = result?.rows.map((r) => r.date).sort() ?? [];
  const moneyIn = result?.rows.filter((r) => r.amountCents > 0).reduce((s, r) => s + r.amountCents, 0) ?? 0;
  const moneyOut = result?.rows.filter((r) => r.amountCents < 0).reduce((s, r) => s - r.amountCents, 0) ?? 0;

  async function run() {
    if (!result || !ready || !fileName) return;
    setBusy(true);
    setError(null);
    try {
      const batchId = slugId("imp");
      const withIds = assignIds(account.id, result.rows);
      const txs: Transaction[] = withIds.map(({ id, row }) => ({
        id,
        accountId: account.id,
        date: row.date,
        merchant: row.merchant,
        description: row.description,
        amountCents: row.amountCents,
        // Only what the file itself said is stored. A guess from the words is worked out when the data is read,
        // so a better guesser improves rows already imported.
        categoryHint: row.fileCategory,
        pending: false,
      }));
      const added = await db.insertSrcTransactions(account.id, txs, batchId);

      let balanceNote: string | null = null;
      if (result.balancesByDate.size > 0) {
        const liability = ACCOUNT_KINDS[account.kind].class === "liability";
        const adjusted = new Map([...result.balancesByDate].map(([d, c]) => [d, liability ? Math.abs(c) : c]));
        await db.setSrcBalances(account.id, adjusted);
        balanceNote = `Balances for ${adjusted.size} ${adjusted.size === 1 ? "day" : "days"} were read from the file's balance column.`;
      }
      const record = { id: batchId, accountId: account.id, at: new Date().toISOString(), fileName, rowsTotal: result.rows.length + result.invalid.length, added, skipped: result.rows.length - added, invalid: result.invalid.length };
      await db.logSrcImport(record);
      await db.log(newEvent("data_imported", account.id, { added, skipped: record.skipped, invalid: record.invalid }));
      onDone({ account: account.name, fileName, added, skipped: record.skipped, invalid: record.invalid, balance: balanceNote });
    } catch (err) {
      setError(`The import didn't finish: ${typeof err === "string" ? err : err instanceof Error ? err.message : "something went wrong"}. Nothing is lost; importing the same file again picks up where it stopped.`);
    } finally {
      setBusy(false);
    }
  }

  const colSelect = (label: string, key: keyof ColumnMap, optional: boolean, id: string) => (
    <div>
      <label htmlFor={id} className="text-label text-ink">
        {label}
      </label>
      <Select id={id} className="mt-1.5" value={map[key] === null ? "" : String(map[key])} onChange={(e) => {
        const next = { ...map, [key]: e.target.value === "" ? null : Number(e.target.value) };
        setMap(next);
        if (key === "date" && rows) settleOrder(rows, hasHeader, next);
      }}>
        <option value="">{optional ? "None" : "Choose a column"}</option>
        {Array.from({ length: width }, (_, i) => (
          <option key={i} value={i}>
            {columnName(i)}
          </option>
        ))}
      </Select>
    </div>
  );

  return (
    <Card as="section" aria-label={`Import transactions into ${account.name}`} className="mt-3 p-6 max-md:p-5">
      <h3 className="text-heading text-ink">Import into {account.name}</h3>
      <p className="mt-1 max-w-[62ch] text-body text-ink-tertiary">
        Download your transactions from your bank as a CSV file, then choose it here. The file is read on this computer and isn't uploaded anywhere.
      </p>

      <div className="mt-4">
        <label htmlFor="imp-file" className="text-label text-ink">
          Bank export (CSV)
        </label>
        <input
          id="imp-file"
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          onChange={(e) => void chooseFile(e.target.files?.[0])}
          className="mt-1.5 block w-full text-body text-ink-secondary file:mr-3 file:h-9 file:rounded-control file:border file:border-line-strong file:bg-surface file:px-4 file:text-body file:font-medium file:text-ink hover:file:bg-surface-hover"
        />
      </div>

      {error && (
        <p role="alert" className="mt-3 text-label text-danger">
          {error}
        </p>
      )}

      {rows && result && (
        <div className="mt-5 border-t border-line pt-5">
          <div className="flex items-center gap-2">
            <input
              id="imp-header"
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => {
                const header = e.target.checked;
                setHasHeader(header);
                const m = header ? detectColumns(rows[0]) : guessColumnsFromData(rows);
                setMap(m);
                settleOrder(rows, header, m);
              }}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <label htmlFor="imp-header" className="text-body text-ink">
              The first row is headings
            </label>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {colSelect("Date", "date", false, "imp-date")}
            {colSelect("Description", "description", true, "imp-desc")}
            {colSelect("Amount", "amount", true, "imp-amount")}
            {map.amount === null && (
              <>
                {colSelect("Money out (debit)", "debit", true, "imp-debit")}
                {colSelect("Money in (credit)", "credit", true, "imp-credit")}
              </>
            )}
            {colSelect("Balance after each transaction", "balance", true, "imp-balance")}
            {colSelect("Category", "category", true, "imp-cat")}
            <SelectField label="How the dates are written" value={order} onChange={(e) => setOrder(e.target.value as DateOrder)}>
              {(Object.keys(ORDER_LABELS) as DateOrder[]).map((o) => (
                <option key={o} value={o}>
                  {ORDER_LABELS[o]}
                </option>
              ))}
            </SelectField>
            {map.amount !== null && (
              <SelectField label="Which sign means money out" value={outIsNegative ? "neg" : "pos"} onChange={(e) => setOutIsNegative(e.target.value === "neg")}>
                <option value="neg">Negative numbers are money out (most bank accounts)</option>
                <option value="pos">Positive numbers are money out (many credit cards)</option>
              </SelectField>
            )}
          </div>
          {dateOrderAmbiguous && (
            <p role="note" className="mt-3 rounded-control bg-warning-soft px-3 py-2 text-body text-ink">
              Every date in this file could be read either way round, so I can't tell whether 03/04/2025 is March 4 or April 3. Check the preview and choose how the dates are written.
            </p>
          )}

          <h4 className="mt-5 text-label text-ink-tertiary">Preview</h4>
          {result.rows.length === 0 ? (
            <p className="mt-2 text-body text-ink-secondary">No rows can be read with these choices yet. Check the columns above.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[520px] text-body">
                <caption className="sr-only">The first rows as they would be imported</caption>
                <thead>
                  <tr className="text-left text-label text-ink-tertiary">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Date</th>
                    <th scope="col" className="px-3 py-1.5 font-medium">Description</th>
                    <th scope="col" className="px-3 py-1.5 font-medium">Category guess</th>
                    <th scope="col" className="py-1.5 pl-3 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result.rows.slice(0, PREVIEW_ROWS).map((r) => (
                    <tr key={r.line}>
                      <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums text-ink-secondary">{fullDate(r.date)}</td>
                      <td className="max-w-[16rem] truncate px-3 py-1.5 text-ink">{r.merchant}</td>
                      <td className="px-3 py-1.5 text-ink-tertiary">{r.categoryHint ? (finance.categoriesById.get(r.categoryHint)?.name ?? "Other") : "Other"}</td>
                      <td className="py-1.5 pl-3 text-right tabular-nums text-ink">{formatMoney(r.amountCents, { cents: true, signed: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-body text-ink-secondary">
            {result.rows.length} {result.rows.length === 1 ? "transaction" : "transactions"} can be imported
            {dates.length > 0 && `, from ${fullDate(dates[0])} to ${fullDate(dates[dates.length - 1])}`}: {formatMoney(moneyIn)} in and {formatMoney(moneyOut)} out.
            {result.invalid.length > 0 && ` ${result.invalid.length} ${result.invalid.length === 1 ? "row" : "rows"} can't be read and will be skipped.`}
          </p>
          {result.invalid.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-label font-normal text-ink-tertiary">
              {result.invalid.slice(0, 3).map((x) => (
                <li key={x.line}>
                  Line {x.line}: {x.reason}
                </li>
              ))}
              {result.invalid.length > 3 && <li>and {result.invalid.length - 3} more.</li>}
            </ul>
          )}
          <p className="mt-3 text-meta text-ink-tertiary">
            Check that purchases show as money out (a minus sign). Categories are first guesses from the words on each line; you can change any of them under Transactions.
          </p>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="tertiary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void run()} disabled={!ready} loading={busy}>
          {ready && result ? `Import ${result.rows.length} ${result.rows.length === 1 ? "transaction" : "transactions"}` : "Import"}
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

type Mode = { kind: "none" } | { kind: "add" } | { kind: "import"; id: string } | { kind: "balance"; id: string } | { kind: "remove"; id: string } | { kind: "clear" };

export function FinancialData({ finance, onNotify }: { finance: Finance; onNotify: (message: string) => void }) {
  const today = toISODate(new Date());
  const [accounts, setAccounts] = useState<ImportedAccount[] | null>(null);
  const [balances, setBalances] = useState<BalancePoint[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: "none" });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [balanceValue, setBalanceValue] = useState<number | null>(null);
  const [balanceDate, setBalanceDate] = useState(today);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([db.srcAccounts(), db.srcBalances()]);
    setAccounts(a);
    setBalances(b);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    await load();
    await finance.reload();
  }

  const asOf = (id: string) => balances.filter((b) => b.accountId === id).map((b) => b.date).sort().pop() ?? null;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    if (finance.source === "import") for (const t of finance.transactions) m.set(t.accountId, (m.get(t.accountId) ?? 0) + 1);
    return m;
  }, [finance.source, finance.transactions]);

  async function addAccount(a: ImportedAccount, date: string) {
    try {
      await db.saveSrcAccount(a);
      await db.setSrcBalances(a.id, new Map([[date, a.balanceCents]]));
      await db.log(newEvent("data_imported", a.id, { added: 0, skipped: 0, invalid: 0 }));
      setMode({ kind: "import", id: a.id });
      await refresh();
    } catch (err) {
      onNotify(`That didn't save. ${typeof err === "string" ? err : err instanceof Error ? err.message : ""}`);
    }
  }

  async function saveBalance(id: string) {
    if (balanceValue === null) return;
    try {
      await db.setSrcBalances(id, new Map([[balanceDate || today, balanceValue]]));
      setMode({ kind: "none" });
      await refresh();
      onNotify("Balance updated");
    } catch (err) {
      onNotify(`That didn't save. ${typeof err === "string" ? err : err instanceof Error ? err.message : ""}`);
    }
  }

  async function removeAccount(id: string) {
    await db.deleteSrcAccount(id);
    setMode({ kind: "none" });
    await refresh();
    onNotify("Account removed");
  }

  async function clearAll() {
    await db.clearSrc();
    setMode({ kind: "none" });
    setResult(null);
    await refresh();
    onNotify("Imported data removed. Showing the sample again.");
  }

  const list = accounts ?? [];
  const sample = finance.source === "sample";

  return (
    <div>
      <Card className="p-5 md:p-6">
        <p className="max-w-[62ch] text-body text-ink-secondary">
          {sample ? (
            <>
              <span className="font-medium text-ink">You're looking at sample data.</span> ZeraphDesk can't connect to a bank. To use your own numbers, add an account and
              import the CSV file your bank lets you download. The file is read on this computer and isn't uploaded anywhere.
            </>
          ) : (
            <>
              <span className="font-medium text-ink">You're looking at data you imported.</span> Balances are what you entered or what the file's balance column said,
              and nothing updates until you import again. ZeraphDesk can't connect to a bank.
            </>
          )}
        </p>
        {mode.kind !== "add" && (
          <Button variant={sample ? "primary" : "secondary"} className="mt-4" onClick={() => setMode({ kind: "add" })}>
            <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Add an account
          </Button>
        )}
        {mode.kind === "add" && (
          <div className="mt-5 border-t border-line pt-5">
            <AddAccountForm today={today} first={list.length === 0} onCancel={() => setMode({ kind: "none" })} onSave={(a, d) => void addAccount(a, d)} />
          </div>
        )}
      </Card>

      {result && (
        <p role="status" className="mt-3 rounded-card border border-line bg-surface px-4 py-3 text-body text-ink-secondary shadow-card">
          <span className="font-medium text-ink">
            Imported {result.added} new {result.added === 1 ? "transaction" : "transactions"} into {result.account}.
          </span>{" "}
          {result.skipped > 0 && `${result.skipped} were already there and weren't added again. `}
          {result.invalid > 0 && `${result.invalid} couldn't be read and were skipped. `}
          {result.balance ?? "The balance is the one you entered; update it if it has changed."} Categories are first guesses you can change under Transactions.
        </p>
      )}

      {list.length > 0 && (
        <ul className="mt-3 space-y-3">
          {list.map((a) => {
            const owed = ACCOUNT_KINDS[a.kind].class === "liability";
            const when = asOf(a.id);
            return (
              <li key={a.id}>
                <Card className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-body font-medium text-ink">{a.name}</p>
                      <p className="text-label font-normal text-ink-tertiary">
                        {a.institution} · {ACCOUNT_KINDS[a.kind].label}
                        {a.mask ? ` ••${a.mask}` : ""} · {counts.get(a.id) ?? 0} {(counts.get(a.id) ?? 0) === 1 ? "transaction" : "transactions"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-body font-medium tabular-nums text-ink">
                        {formatMoney(a.balanceCents, { cents: true })}
                        {owed && <span className="text-label font-normal text-ink-tertiary"> owed</span>}
                      </p>
                      {when && <p className="text-meta text-ink-tertiary">as of {fullDate(when)}</p>}
                    </div>
                  </div>

                  {mode.kind === "balance" && mode.id === a.id ? (
                    <form
                      noValidate
                      className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveBalance(a.id);
                      }}
                    >
                      <div className="w-40">
                        <label htmlFor={`bal-${a.id}`} className="text-label text-ink">
                          {owed ? "Amount owed now" : "Balance now"}
                        </label>
                        <MoneyInput live id={`bal-${a.id}`} className="mt-1.5" value={balanceValue} onCommit={setBalanceValue} placeholder="0" />
                      </div>
                      <div>
                        <label htmlFor={`bald-${a.id}`} className="block text-label text-ink">
                          As of
                        </label>
                        <Input id={`bald-${a.id}`} type="date" max={today} className="mt-1.5 w-40" value={balanceDate} onChange={(e) => setBalanceDate(e.target.value)} />
                      </div>
                      <Button type="submit" variant="primary" disabled={balanceValue === null}>
                        Save balance
                      </Button>
                      <Button variant="tertiary" onClick={() => setMode({ kind: "none" })}>
                        Cancel
                      </Button>
                    </form>
                  ) : mode.kind === "remove" && mode.id === a.id ? (
                    <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
                      <span className="mr-1 text-label text-ink-secondary">Remove this account and everything imported into it?</span>
                      <Button variant="tertiary" size="sm" onClick={() => setMode({ kind: "none" })}>
                        Keep it
                      </Button>
                      <Button variant="secondary" size="sm" className="text-danger" onClick={() => void removeAccount(a.id)}>
                        Remove account
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-wrap items-center justify-end gap-1 border-t border-line pt-3">
                      <Button variant="secondary" size="sm" onClick={() => { setResult(null); setMode({ kind: "import", id: a.id }); }}>
                        <FileUp className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                        <span className="sr-only">Import transactions into {a.name}: </span>
                        Import transactions
                      </Button>
                      <Button variant="tertiary" size="sm" aria-label={`Update the balance of ${a.name}`} onClick={() => { setBalanceValue(null); setBalanceDate(today); setMode({ kind: "balance", id: a.id }); }}>
                        Update balance
                      </Button>
                      <Button variant="tertiary" size="sm" aria-label={`Remove ${a.name}`} onClick={() => setMode({ kind: "remove", id: a.id })}>
                        Remove
                      </Button>
                    </div>
                  )}
                  {mode.kind === "import" && mode.id === a.id && (
                    <ImportWizard
                      account={a}
                      finance={finance}
                      onCancel={() => setMode({ kind: "none" })}
                      onDone={(r) => {
                        setResult(r);
                        setMode({ kind: "none" });
                        void refresh();
                      }}
                    />
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {list.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {mode.kind === "clear" ? (
            <>
              <span className="mr-1 text-label text-ink-secondary">Remove every imported account, transaction and balance, and go back to the sample?</span>
              <Button variant="tertiary" size="sm" onClick={() => setMode({ kind: "none" })}>
                Keep them
              </Button>
              <Button variant="secondary" size="sm" className="text-danger" onClick={() => void clearAll()}>
                Remove imported data
              </Button>
            </>
          ) : (
            <Button variant="tertiary" size="sm" onClick={() => setMode({ kind: "clear" })}>
              Remove all imported data
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
