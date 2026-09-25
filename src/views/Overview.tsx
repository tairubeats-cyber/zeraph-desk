import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { CashFlowChart } from "@/components/finance/CashFlowChart";
import {
  BasisTag,
  CategoryGlyph,
  LoadFailed,
  LoadingBlock,
  SampleNotice,
  TransactionRow,
} from "@/components/finance/parts";
import type { Finance } from "@/lib/finance/useFinance";
import type { Plans } from "@/lib/finance/usePlans";
import type { Planning } from "@/lib/finance/usePlanning";
import type { Intel } from "@/lib/finance/useIntel";
import { ProgressBar } from "@/components/finance/inputs";
import { upcoming } from "@/lib/finance/cashflow";
import { goalProgress } from "@/lib/finance/goals";
import { flowForMonth, spendingByCategory } from "@/lib/finance/analysis";
import { netWorthNow } from "@/lib/finance/networth";
import { dayOfMonth, formatMoney, monthKey, monthLabel, parseISODate, recentMonthKeys, shiftMonth } from "@/lib/finance/money";
import type { TxFilters } from "@/lib/finance/filters";
import type { ViewKey } from "@/nav";

interface Props {
  finance: Finance;
  plans: Plans;
  planning: Planning;
  intel: Intel;
  onOpen: (view: ViewKey, filters?: Partial<TxFilters>) => void;
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** "$120 more than" / "$80 less than" — neutral, no judgement. */
function difference(nowCents: number, thenCents: number): string {
  const d = nowCents - thenCents;
  if (d === 0) return "The same as";
  return `${formatMoney(Math.abs(d))} ${d > 0 ? "more than" : "less than"}`;
}

export function Overview({ finance, plans, planning, intel, onOpen }: Props) {
  const { status, snapshot, transactions, categoriesById, today } = finance;

  const view = useMemo(() => {
    if (!snapshot) return null;
    const month = monthKey(today);
    const lastMonth = shiftMonth(month, -1);
    const day = dayOfMonth(today);
    const flow = flowForMonth(transactions, categoriesById, month);
    const flowLastToDate = flowForMonth(transactions, categoriesById, lastMonth, day);
    return {
      month,
      totals: netWorthNow(snapshot.accounts, planning.holdings),
      flow,
      spendingLastToDate: flowLastToDate.spendingCents,
      months: recentMonthKeys(today, 6).map((m) => ({ month: m, ...flowForMonth(transactions, categoriesById, m) })),
      thisMonth: spendingByCategory(transactions, categoriesById, month),
      lastMonthToDate: new Map(
        spendingByCategory(transactions, categoriesById, lastMonth, day).map((r) => [r.categoryId, r.cents]),
      ),
      accounts: new Map(snapshot.accounts.map((a) => [a.id, a.name])),
    };
  }, [snapshot, transactions, categoriesById, today, planning.holdings]);

  const ahead = useMemo(() => upcoming(plans.recurring, today, 14), [plans.recurring, today]);
  const goalRows = useMemo(
    () => plans.goals.map((g) => ({ goal: g, p: goalProgress(g, plans.contributions, today) })).slice(0, 3),
    [plans.goals, plans.contributions, today],
  );

  if (status === "error") return <LoadFailed message={finance.error ?? ""} onRetry={finance.reload} />;
  if (!view || status === "loading" || planning.status === "loading") return <LoadingBlock label="Loading your finances…" />;

  const { totals, flow, months, thisMonth } = view;
  const monthName = monthLabel(view.month);
  const top = thisMonth.slice(0, 6);
  const topMax = top[0]?.cents ?? 1;
  const recent = transactions.slice(0, 6);

  return (
    <div>
      <PageHeader title={greeting()} description="Here's your financial picture." />
      {finance.origin === "sample" && <SampleNotice onOpenAccounts={() => onOpen("accounts")} />}

      <Card as="section" aria-labelledby="nw" className="p-6 max-md:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="nw" className="text-label text-ink-tertiary">
            Net worth
          </h2>
          <div className="flex items-center gap-2">
            <BasisTag basis="calculation" />
            <Button variant="tertiary" size="sm" onClick={() => onOpen("net-worth")}>
              See it over time
            </Button>
          </div>
        </div>
        <p className="mt-2 text-display tabular-nums text-ink max-md:text-title">{formatMoney(totals.netWorthCents)}</p>
        <p className="mt-2 text-body text-ink-tertiary">
          {formatMoney(totals.assetsCents)} in assets, {formatMoney(totals.liabilitiesCents)} owed
        </p>

        <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-line pt-5">
          {[
            ["Cash", totals.cashCents],
            ["Investments", totals.investmentsCents],
            ["Debt", totals.liabilitiesCents],
          ].map(([label, cents]) => (
            <div key={label as string}>
              <dt className="text-label text-ink-tertiary">{label}</dt>
              <dd className="mt-0.5 text-heading tabular-nums text-ink">{formatMoney(cents as number)}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card as="section" aria-labelledby="cf" className="p-6 max-md:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="cf" className="text-heading text-ink">
              Cash flow, {monthName} so far
            </h2>
            <BasisTag basis="calculation" />
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-4">
            <div>
              <dt className="text-label text-ink-tertiary">Income</dt>
              <dd className="mt-0.5 text-heading tabular-nums text-ink">{formatMoney(flow.incomeCents)}</dd>
            </div>
            <div>
              <dt className="text-label text-ink-tertiary">Spending</dt>
              <dd className="mt-0.5 text-heading tabular-nums text-ink">{formatMoney(flow.spendingCents)}</dd>
            </div>
            <div>
              <dt className="text-label text-ink-tertiary">{flow.surplusCents >= 0 ? "Surplus" : "Shortfall"}</dt>
              <dd className="mt-0.5 text-heading tabular-nums text-ink">{formatMoney(Math.abs(flow.surplusCents))}</dd>
            </div>
          </dl>
          <p className="mt-2 text-label font-normal text-ink-tertiary">
            {difference(flow.spendingCents, view.spendingLastToDate)} the {formatMoney(view.spendingLastToDate)} spent by this
            point last month.
          </p>
          <div className="mt-5">
            <CashFlowChart months={months} currentMonth={view.month} />
          </div>
          <p className="mt-4 text-meta text-ink-tertiary">
            Transfers, card payments and investment contributions aren't counted as spending.
          </p>
        </Card>

        <Card as="section" aria-labelledby="wg" className="p-6 max-md:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="wg" className="text-heading text-ink">
              Where it went
            </h2>
            <BasisTag basis="calculation" />
          </div>
          {top.length === 0 ? (
            <p className="mt-4 text-body text-ink-tertiary">No spending recorded yet this month.</p>
          ) : (
            <ul className="mt-3 -mx-2">
              {top.map((row) => {
                const before = view.lastMonthToDate.get(row.categoryId);
                const name = categoriesById.get(row.categoryId)?.name ?? "Other";
                return (
                  <li key={row.categoryId}>
                    <button
                      onClick={() => onOpen("transactions", { categoryId: row.categoryId, period: "this_month" })}
                      className="flex w-full items-center gap-3 rounded-control px-2 py-2.5 text-left transition-colors duration-150 ease-standard hover:bg-surface-secondary"
                    >
                      <CategoryGlyph categoryId={row.categoryId} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-body font-medium text-ink">{name}</span>
                          <span className="text-body tabular-nums text-ink">{formatMoney(row.cents)}</span>
                        </span>
                        <span
                          aria-hidden="true"
                          className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-secondary"
                        >
                          <span
                            className="block h-full rounded-full bg-chart-muted"
                            style={{ width: `${Math.max(3, (row.cents / topMax) * 100)}%` }}
                          />
                        </span>
                        {before !== undefined && (
                          <span className="mt-1 block text-meta text-ink-tertiary">
                            {row.cents === before ? "Same as" : `${formatMoney(row.cents - before, { signed: true })} vs.`} this
                            point last month
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card as="section" aria-labelledby="wl" className="mt-4 p-6 max-md:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="wl" className="text-heading text-ink">
            {intel.items.length === 0 ? "Nothing needs a look" : `${intel.items.length} ${intel.items.length === 1 ? "thing" : "things"} worth a look`}
          </h2>
          <Button variant="tertiary" size="sm" onClick={() => onOpen("action-center")}>
            Open Action Center
          </Button>
        </div>
        {intel.items.length > 0 && (
          <ul className="mt-2 divide-y divide-line">
            {intel.items.slice(0, 3).map(({ insight }) => (
              <li key={insight.id}>
                <button
                  onClick={() => onOpen("action-center")}
                  className="flex w-full items-start gap-3 py-3 text-left transition-colors duration-150 ease-standard hover:bg-surface-secondary"
                >
                  <span
                    aria-hidden="true"
                    className={"mt-2 h-2 w-2 shrink-0 rounded-full " + (insight.severity === "attention" ? "bg-warning" : "bg-chart-muted")}
                  />
                  <span className="min-w-0">
                    <span className="block text-body font-medium text-ink">{insight.title}</span>
                    <span className="block text-label font-normal text-ink-tertiary">{insight.summary}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card as="section" aria-labelledby="cu" className="p-6 max-md:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="cu" className="text-heading text-ink">
              Coming up
            </h2>
            <BasisTag basis="projection" />
          </div>
          {ahead.occurrences.length === 0 ? (
            <p className="mt-3 text-body text-ink-tertiary">Nothing expected in the next 14 days.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {ahead.occurrences.slice(0, 5).map((o) => (
                <li key={o.payment.key + o.date} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-body font-medium text-ink">{o.payment.merchant}</span>
                    <span className="block text-label font-normal text-ink-tertiary">
                      {parseISODate(o.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    </span>
                  </span>
                  <span className={"text-body tabular-nums " + (o.payment.direction === "in" ? "text-success" : "text-ink")}>
                    {formatMoney(o.payment.direction === "in" ? o.payment.amountCents : -o.payment.amountCents, { signed: true })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Button variant="tertiary" size="sm" className="-ml-3 mt-2" onClick={() => onOpen("bills")}>
            See all bills
          </Button>
        </Card>

        <Card as="section" aria-labelledby="gl" className="p-6 max-md:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="gl" className="text-heading text-ink">
              Goals
            </h2>
          </div>
          {goalRows.length === 0 ? (
            <p className="mt-3 text-body text-ink-tertiary">No goals yet. Set a target and track how it's going.</p>
          ) : (
            <ul className="mt-3 space-y-4">
              {goalRows.map(({ goal, p }) => (
                <li key={goal.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-body font-medium text-ink">{goal.name}</span>
                    <span className="text-body tabular-nums text-ink-secondary">{Math.round(p.fraction * 100)}%</span>
                  </div>
                  <ProgressBar fraction={p.fraction} className="mt-1.5" />
                </li>
              ))}
            </ul>
          )}
          <Button variant="tertiary" size="sm" className="-ml-3 mt-3" onClick={() => onOpen("goals")}>
            {goalRows.length === 0 ? "Create a goal" : "See all goals"}
          </Button>
        </Card>
      </div>

      <Card as="section" aria-labelledby="ra" className="mt-4">
        <div className="flex items-center justify-between gap-3 px-6 pb-2 pt-5 max-md:px-5">
          <h2 id="ra" className="text-heading text-ink">
            Recent transactions
          </h2>
          <Button variant="tertiary" size="sm" onClick={() => onOpen("transactions", { period: "all" })}>
            See all
          </Button>
        </div>
        <ul className="divide-y divide-line pb-2">
          {recent.map((t) => (
            <li key={t.id}>
              <TransactionRow showDate tx={t} category={categoriesById.get(t.categoryId)} accountName={view.accounts.get(t.accountId) ?? ""} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
