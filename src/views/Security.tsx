import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { CircleAlert, Download, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/PageHeader";
import { emailConnector } from "@/connectors/email";
import { db, newEvent } from "@/lib/db";
import { simplefin } from "@/lib/finance/syncSimplefin";
import type { Finance } from "@/lib/finance/useFinance";
import type { Intel } from "@/lib/finance/useIntel";
import { toISODate } from "@/lib/finance/money";
import {
  CSV_BOM,
  buildExport,
  exportFileName,
  formatBytes,
  inventory,
  transactionsCsv,
  type TransactionLine,
} from "@/lib/privacy";

function reason(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : "Something went wrong.";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-2 px-1 text-label text-ink-tertiary">
        {title}
      </h2>
      {children}
    </section>
  );
}

type Status = { label: string; tone: "on" | "off" };

function StatusChip({ status }: { status: Status }) {
  return (
    <span
      className={
        "inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-meta font-medium " +
        (status.tone === "on" ? "bg-success-soft text-success" : "bg-surface-secondary text-ink-secondary")
      }
    >
      {status.label}
    </span>
  );
}

interface Facts {
  counts: Record<string, number>;
  folder: string | null;
  bytes: number | null;
  mail: boolean;
  bridge: boolean;
  lastSync: string | null;
  seat: boolean;
}

export function Security({ finance, intel, onNotify }: { finance: Finance; intel: Intel; onNotify: (message: string) => void }) {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [busy, setBusy] = useState<null | "json" | "csv" | "erase">(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const today = toISODate(new Date());

  const load = useCallback(async () => {
    const [counts, mail, bridge, runs, seat] = await Promise.all([
      db.tableCounts(),
      emailConnector.isConnected().catch(() => false),
      simplefin.isConnected().catch(() => false),
      db.syncRuns(),
      db.seatToken(),
    ]);
    const info = await invoke<{ folder: string; bytes: number }>("data_info").catch(() => null);
    setFacts({
      counts,
      folder: info?.folder ?? null,
      bytes: info?.bytes ?? null,
      mail,
      bridge,
      lastSync: runs.find((r) => r.kind === "sync" && r.ok)?.at ?? null,
      seat: !!seat,
    });
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(reason(err)));
  }, [load]);

  const groups = useMemo(() => (facts ? inventory(facts.counts) : []), [facts]);
  const own = finance.source === "import";

  /** Everything the person has added, imported or synced, plus their choices, as one JSON file. */
  async function exportEverything() {
    setError(null);
    setSaved(null);
    setBusy("json");
    try {
      const doc = buildExport(await db.allTables(), { appVersion: await getVersion(), exportedAt: new Date().toISOString() });
      const path = await invoke<string | null>("save_export", { fileName: exportFileName("everything", today), extension: "json", contents: JSON.stringify(doc, null, 2) });
      if (path) {
        setSaved(path);
        onNotify("Export saved");
        await db.log(newEvent("data_exported", null, { kind: "json" }));
      }
    } catch (err) {
      setError(reason(err));
    } finally {
      setBusy(null);
    }
  }

  /** The transactions, in a file any spreadsheet opens. Only what's really yours: never the sample. */
  async function exportTransactions() {
    if (!finance.snapshot || !own) return;
    setError(null);
    setSaved(null);
    setBusy("csv");
    try {
      const accounts = new Map(finance.snapshot.accounts.map((a) => [a.id, a.name]));
      const lines: TransactionLine[] = finance.transactions.map((t) => ({
        date: t.date,
        account: accounts.get(t.accountId) ?? "",
        merchant: t.merchant,
        description: t.description,
        amountCents: t.amountCents,
        category: finance.categoriesById.get(t.categoryId)?.name ?? "Other",
        note: t.note,
        flagged: t.flagged,
      }));
      const path = await invoke<string | null>("save_export", { fileName: exportFileName("transactions", today), extension: "csv", contents: CSV_BOM + transactionsCsv(lines) });
      if (path) {
        setSaved(path);
        onNotify("Export saved");
        await db.log(newEvent("data_exported", null, { kind: "csv" }));
      }
    } catch (err) {
      setError(reason(err));
    } finally {
      setBusy(null);
    }
  }

  /** Forget the logins, empty the database, and start again as if newly installed. */
  async function eraseEverything() {
    setError(null);
    setBusy("erase");
    try {
      await invoke("mail_forget");
      await simplefin.disconnect();
      await db.eraseEverything();
      window.location.reload();
    } catch (err) {
      setError(`Not everything could be deleted. ${reason(err)}`);
      setBusy(null);
      void load();
    }
  }

  const sync = facts?.lastSync ? new Date(facts.lastSync).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
  const rows: { name: string; sees: string; when: string; status: Status | null }[] = [
    {
      name: "Your email provider",
      sees: "Reads new messages in your inbox, and sends a reply only when you approve it.",
      when: "Checks for new mail about once a minute while ZeraphDesk is open.",
      status: facts ? (facts.mail ? { label: "Connected", tone: "on" } : { label: "Not connected", tone: "off" }) : null,
    },
    {
      name: "Zeraph's reply service",
      sees: "For email drafts: the message being answered and the few lines pulled from your business sheet. Never your finances. AI chat uses the same service and has its own row below.",
      when: "Each time a draft is written.",
      status: facts ? (facts.seat ? { label: "Seat token saved", tone: "on" } : { label: "No seat token", tone: "off" }) : null,
    },
    {
      name: "Claude, for AI chat",
      sees: "Your question, the earlier messages in that chat, and a summary of your finances: balances by kind of account, monthly income and spending, category totals, budgets, goals, debts and the investment mix. You can leave parts out of any message. It has no merchant names, transactions, account names or bank names. It goes through Zeraph's service, which counts tokens and doesn't keep the text. Anthropic, which runs Claude, handles it under its own terms.",
      when: "Only when you press Send on a message you reviewed in AI chat, and only if you turned it on.",
      status: intel.prefs.aiChat ? { label: "On", tone: "on" } : { label: "Off", tone: "off" },
    },
    {
      name: "SimpleFIN Bridge",
      sees: "A read-only access key and a range of dates. It sends back the names, balances and transactions of the accounts you linked. SimpleFIN knows which accounts you linked.",
      when: "Only when you press Sync.",
      status: facts ? (facts.bridge ? { label: sync ? `Connected, last synced ${sync}` : "Connected", tone: "on" } : { label: "Not connected", tone: "off" }) : null,
    },
    {
      name: "Desktop notifications",
      sees: "Your operating system shows the title and summary of a new finding, which can include amounts.",
      when: "When a new finding appears, if you turned this on.",
      status: intel.prefs.systemNotifications ? { label: "On", tone: "on" } : { label: "Off", tone: "off" },
    },
    {
      name: "Everything else",
      sees: "Nothing. Your accounts, budgets, goals, health figures, and your questions to Ask ZeraphDesk stay on this computer. The exception is what you choose to send in AI chat, above.",
      when: "Always.",
      status: null,
    },
  ];

  const confirmed = typed.trim().toLowerCase() === "delete";

  return (
    <div>
      <PageHeader title="Security" description="What ZeraphDesk holds, what can leave this computer, and your controls over it." />

      <div className="space-y-8">
        <Section title="What can leave this computer">
          <Card className="p-5 md:p-6">
            <p className="max-w-[62ch] text-body text-ink-secondary">
              Only the connections below can send or receive anything, and each does so for the reason and at the time shown. Nothing is sent to anyone else, and Zeraph doesn't use any of it to train a model.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <caption className="sr-only">Each service ZeraphDesk can talk to, what it can see, when, and whether it is on</caption>
                <thead>
                  <tr className="text-label text-ink-tertiary">
                    <th scope="col" className="py-2 pr-4 font-normal">Service</th>
                    <th scope="col" className="py-2 pr-4 font-normal">What it can see or receive</th>
                    <th scope="col" className="py-2 pr-4 font-normal">When</th>
                    <th scope="col" className="py-2 font-normal">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line align-top">
                  {rows.map((r) => (
                    <tr key={r.name} className="text-body text-ink">
                      <th scope="row" className="py-3 pr-4 font-medium">{r.name}</th>
                      <td className="py-3 pr-4 text-ink-secondary">{r.sees}</td>
                      <td className="py-3 pr-4 text-ink-secondary">{r.when}</td>
                      <td className="py-3">{r.status && <StatusChip status={r.status} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-label font-normal text-ink-tertiary">Connect or disconnect any of these under Connections.</p>
          </Card>
        </Section>

        <Section title="What ZeraphDesk holds">
          <Card className="p-5 md:p-6">
            <p className="max-w-[62ch] text-body text-ink-secondary">
              Everything is kept in one database file on this computer.
              {facts?.folder ? (
                <>
                  {" "}It's in <span className="break-all font-medium text-ink">{facts.folder}</span>
                  {facts.bytes !== null ? ` and is about ${formatBytes(facts.bytes)}` : ""}.
                </>
              ) : null}{" "}
              The sample data you may see is generated on the fly and is never stored.
            </p>
            <ul className="mt-4 grid gap-4 md:grid-cols-2">
              {groups.map((g) => (
                <li key={g.key} className="rounded-control border border-line p-4">
                  <p className="text-body font-medium text-ink">{g.label}</p>
                  <p className="mt-0.5 text-label font-normal text-ink-tertiary">{g.about}</p>
                  {g.total === 0 ? (
                    <p className="mt-2 text-label font-normal text-ink-secondary">Nothing stored.</p>
                  ) : (
                    <ul className="mt-2 space-y-0.5">
                      {g.items
                        .filter((i) => i.count > 0)
                        .map((i) => (
                          <li key={i.table} className="flex justify-between gap-3 text-label font-normal text-ink-secondary">
                            <span>{i.label}</span>
                            <span className="tabular-nums text-ink">{i.count.toLocaleString("en-US")}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </Section>

        <Section title="How it's protected">
          <Card className="space-y-3 p-5 md:p-6">
            <p className="max-w-[62ch] text-body text-ink-secondary">
              <span className="font-medium text-ink">Passwords and keys</span> (your email app password and the SimpleFIN key) are kept in this computer's keychain, not in the database. They aren't shown again after you enter them, and they aren't in an export.
            </p>
            <p className="max-w-[62ch] text-body text-ink-secondary">
              <span className="font-medium text-ink">The database itself isn't encrypted by ZeraphDesk.</span> Anyone who can open your user account on this computer can read it. Your computer's own disk encryption (BitLocker on Windows, FileVault on a Mac) protects the file when the computer is off or lost. ZeraphDesk has no app lock or PIN of its own.
            </p>
            <p className="max-w-[62ch] text-body text-ink-secondary">
              <span className="font-medium text-ink">No sign-in, so no sessions or devices.</span> ZeraphDesk has no account with Zeraph and nothing to sign out of. Each install is separate and holds only what was added to that computer.
            </p>
            <p className="max-w-[62ch] text-body text-ink-secondary">
              <span className="font-medium text-ink">No certifications.</span> ZeraphDesk hasn't been independently audited and doesn't claim bank-level security, a compliance certification, or any regulated status. It doesn't move money and it isn't a financial adviser.
            </p>
          </Card>
        </Section>

        <Section title="Export your data">
          <Card className="p-5 md:p-6">
            <p className="max-w-[62ch] text-body text-ink-secondary">
              Save a copy of what ZeraphDesk holds. You choose where the file goes, and it isn't sent anywhere. The files aren't encrypted, so keep them somewhere private.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-control border border-line p-4">
                <p className="text-body font-medium text-ink">Everything</p>
                <p className="mt-1 text-label font-normal text-ink-tertiary">Every table as stored, in one JSON file. Passwords, keys and the seat token are left out.</p>
                <Button className="mt-3" variant="secondary" loading={busy === "json"} disabled={busy !== null || !facts} onClick={() => void exportEverything()}>
                  <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                  Export everything
                </Button>
              </div>
              <div className="rounded-control border border-line p-4">
                <p className="text-body font-medium text-ink">Transactions</p>
                <p className="mt-1 text-label font-normal text-ink-tertiary">
                  {own ? "One row per transaction with its category and note, in a file a spreadsheet opens." : "You haven't added any transactions yet; the ones you see are sample data, so there's nothing of yours to export."}
                </p>
                <Button className="mt-3" variant="secondary" loading={busy === "csv"} disabled={busy !== null || !own} onClick={() => void exportTransactions()}>
                  <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                  Export transactions
                </Button>
              </div>
            </div>
            {saved && (
              <p role="status" className="mt-3 text-label font-normal text-ink-secondary">
                Saved to <span className="break-all font-medium text-ink">{saved}</span>
              </p>
            )}
          </Card>
        </Section>

        <Section title="Delete your data">
          <Card className="p-5 md:p-6">
            <p className="max-w-[62ch] text-body text-ink-secondary">
              There's no ZeraphDesk account to close; everything is on this computer. Deleting removes all of it: your accounts and transactions, choices, budgets, goals, the email desk, the activity log and saved settings, and it forgets the email and SimpleFIN logins. ZeraphDesk then starts again as if newly installed.
            </p>
            <p className="mt-2 max-w-[62ch] text-body text-ink-secondary">
              <span className="font-medium text-ink">This can't be undone.</span> Export first if you want a copy. Deleting here doesn't turn off the SimpleFIN token at bridge.simplefin.org or delete the app password in your email account; do that at those sites to revoke them for good.
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="w-56">
                <label htmlFor="sec-delete" className="text-label text-ink">
                  Type DELETE to confirm
                </label>
                <Input id="sec-delete" className="mt-1.5" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />
              </div>
              <Button variant="secondary" className="text-danger" loading={busy === "erase"} disabled={!confirmed || busy !== null} onClick={() => void eraseEverything()}>
                <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                Delete everything
              </Button>
            </div>
          </Card>
        </Section>

        {error && (
          <p role="alert" className="flex items-start gap-2 text-label font-normal text-danger">
            <CircleAlert className="mt-px h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
