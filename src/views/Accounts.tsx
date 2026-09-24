import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { LoadFailed, LoadingBlock, SampleNotice } from "@/components/finance/parts";
import type { Finance } from "@/lib/finance/useFinance";
import { accountTotals } from "@/lib/finance/analysis";
import { formatMoney } from "@/lib/finance/money";
import {
  ACCOUNT_GROUPS,
  ACCOUNT_KINDS,
  type Connection,
  type ConnectionStatus,
} from "@/lib/finance/types";
import { cn } from "@/lib/utils";

const STATUS: Record<ConnectionStatus, { label: string; tone: string }> = {
  sample: { label: "Sample data", tone: "bg-surface-secondary text-ink-secondary" },
  connected: { label: "Connected", tone: "bg-success-soft text-success" },
  needs_attention: { label: "Needs attention", tone: "bg-warning-soft text-warning" },
  disconnected: { label: "Disconnected", tone: "bg-surface-secondary text-ink-secondary" },
};

function updated(c: Connection | undefined): string {
  if (!c?.lastSyncedAt) return "Never synced";
  return new Date(c.lastSyncedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function Accounts({ finance }: { finance: Finance }) {
  const { status, snapshot } = finance;

  const grouped = useMemo(() => {
    if (!snapshot) return null;
    const institutions = new Map(snapshot.institutions.map((i) => [i.id, i.name]));
    const connections = new Map(snapshot.connections.map((c) => [c.id, c]));
    return ACCOUNT_GROUPS.map((g) => ({
      ...g,
      accounts: snapshot.accounts.filter((a) => ACCOUNT_KINDS[a.kind].group === g.key),
    }))
      .filter((g) => g.accounts.length > 0)
      .map((g) => ({
        ...g,
        totalCents: g.accounts.reduce((sum, a) => sum + a.balanceCents, 0),
        owed: ACCOUNT_KINDS[g.accounts[0].kind].class === "liability",
        institutions,
        connections,
      }));
  }, [snapshot]);

  if (status === "error") return <LoadFailed message={finance.error ?? ""} onRetry={finance.reload} />;
  if (!snapshot || !grouped || status === "loading") return <LoadingBlock label="Loading accounts…" />;

  const totals = accountTotals(snapshot.accounts);

  return (
    <div>
      <PageHeader title="Accounts" description="Everything you own and owe, by kind of account." />
      {finance.origin === "sample" && <SampleNotice />}

      <Card className="mb-4 grid grid-cols-3 gap-4 p-5 max-md:grid-cols-1">
        {[
          ["Assets", totals.assetsCents],
          ["Owed", totals.liabilitiesCents],
          ["Net worth", totals.netWorthCents],
        ].map(([label, cents]) => (
          <div key={label as string}>
            <p className="text-label text-ink-tertiary">{label}</p>
            <p className="mt-0.5 text-heading tabular-nums text-ink">{formatMoney(cents as number)}</p>
          </div>
        ))}
      </Card>

      <div className="space-y-6">
        {grouped.map((g) => (
          <section key={g.key} aria-labelledby={`grp-${g.key}`}>
            <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
              <h2 id={`grp-${g.key}`} className="text-heading text-ink">
                {g.label}
              </h2>
              <p className="text-label font-normal tabular-nums text-ink-tertiary">
                {formatMoney(g.totalCents)}
                {g.owed ? " owed" : ""}
              </p>
            </div>
            <Card>
              <ul className="divide-y divide-line">
                {g.accounts.map((a) => {
                  const conn = g.connections.get(a.connectionId);
                  const st = STATUS[conn?.status ?? "disconnected"];
                  const info = ACCOUNT_KINDS[a.kind];
                  return (
                    <li key={a.id} className="flex items-center gap-4 px-5 py-4 max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-1">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-medium text-ink">{a.name}</p>
                        <p className="truncate text-label font-normal text-ink-tertiary">
                          {g.institutions.get(a.institutionId) ?? "Unknown institution"} · {info.label}
                          {a.mask ? ` ••${a.mask}` : ""}
                        </p>
                      </div>
                      <div className="text-right max-md:order-3 max-md:w-full max-md:text-left">
                        <p className="text-body font-medium tabular-nums text-ink">
                          {formatMoney(a.balanceCents, { cents: true })}
                          {info.class === "liability" && <span className="ml-1 text-label font-normal text-ink-tertiary">owed</span>}
                        </p>
                        <p className="text-meta text-ink-tertiary">{updated(conn)}</p>
                      </div>
                      <span
                        className={cn(
                          "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-meta font-medium",
                          st.tone,
                        )}
                      >
                        {st.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </section>
        ))}
      </div>

      <Card className="mt-8 p-5">
        <h2 className="text-heading text-ink">Connecting real accounts</h2>
        <p className="mt-2 max-w-[62ch] text-body text-ink-secondary">
          ZeraphDesk can't connect to a bank yet. That needs a financial-data provider, which hasn't been set up, so
          nothing on this screen came from a real institution.
        </p>
      </Card>
    </div>
  );
}
