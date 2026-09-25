import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { AskLink } from "@/components/finance/AskLink";
import { CashFlowChart } from "@/components/finance/CashFlowChart";
import { BasisTag, CategoryGlyph, SampleNotice } from "@/components/finance/parts";
import { ProgressBar, Stat } from "@/components/finance/inputs";
import { gate } from "@/components/finance/gate";
import type { Finance } from "@/lib/finance/useFinance";
import type { Plans } from "@/lib/finance/usePlans";
import { average, completeMonths, monthlyFlows, spendingSplit, upcoming } from "@/lib/finance/cashflow";
import { formatMoney, monthKey, monthLabel, parseISODate } from "@/lib/finance/money";
import type { ViewKey } from "@/nav";

const pct = (rate: number | null) => (rate === null ? "n/a" : `${Math.round(rate * 100)}%`);
const signed = (cents: number) => formatMoney(cents, { signed: true });

export function CashFlow({
  finance,
  plans,
  onOpen,
}: {
  finance: Finance;
  plans: Plans;
  onOpen: (view: ViewKey) => void;
}) {
  const { today, transactions, categoriesById } = finance;

  const flows = useMemo(() => monthlyFlows(transactions, categoriesById, today), [transactions, categoriesById, today]);
  const complete = useMemo(() => completeMonths(flows, today), [flows, today]);
  const split = useMemo(
    () => spendingSplit(transactions, categoriesById, plans.recurring, today),
    [transactions, categoriesById, plans.recurring, today],
  );
  const ahead = useMemo(() => upcoming(plans.recurring, today, 30), [plans.recurring, today]);

  const blocked = gate(finance, plans);
  if (blocked) return blocked;

  const current = flows[flows.length - 1];
  const avgSurplus = average(complete.map((f) => f.surplusCents));
  const recent = complete.slice(-3);
  const earlier = complete.slice(0, -3);
  const avgRate = (() => {
    const income = complete.reduce((s, f) => s + f.incomeCents, 0);
    return income > 0 ? complete.reduce((s, f) => s + f.surplusCents, 0) / income : null;
  })();

  const splitTotal = split.recurringCents + split.otherCents;
  const large = ahead.occurrences
    .filter((o) => o.payment.direction === "out" && o.payment.kind === "expense")
    .sort((a, b) => b.payment.amountCents - a.payment.amountCents)
    .slice(0, 5);

  return (
    <div>
      <PageHeader
        title="Cash Flow"
        description="What came in, what went out, and what's left over."
        actions={<AskLink label="Ask what changed" question="What changed compared with last month?" />}
      />
      {finance.origin === "sample" && <SampleNotice />}

      <Card as="section" aria-labelledby="cf-now" className="p-6 max-md:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="cf-now" className="text-heading text-ink">
            {monthLabel(monthKey(today))} so far
          </h2>
          <BasisTag basis="calculation" />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Income" value={formatMoney(current.incomeCents)} />
          <Stat label="Spending" value={formatMoney(current.spendingCents)} />
          <Stat
            label={current.surplusCents >= 0 ? "Surplus" : "Shortfall"}
            value={formatMoney(Math.abs(current.surplusCents))}
          />
          <Stat
            label="Average surplus"
            value={formatMoney(avgSurplus)}
            hint={`over the last ${complete.length} full months`}
          />
        </dl>
      </Card>

      <Card as="section" aria-labelledby="cf-months" className="mt-4 p-6 max-md:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="cf-months" className="text-heading text-ink">
            Month by month
          </h2>
          <BasisTag basis="calculation" />
        </div>
        <div className="mt-4">
          <CashFlowChart months={flows} currentMonth={monthKey(today)} />
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[420px] text-body">
            <caption className="sr-only">Income, spending, surplus and savings rate for each month</caption>
            <thead>
              <tr className="text-left text-label text-ink-tertiary">
                <th scope="col" className="pb-2 font-medium">
                  Month
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Income
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Spending
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Left over
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Saved
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {[...flows].reverse().map((f) => (
                <tr key={f.month}>
                  <th scope="row" className="py-2 text-left font-medium text-ink">
                    {monthLabel(f.month)}
                    {f.month === monthKey(today) && <span className="font-normal text-ink-tertiary"> (so far)</span>}
                  </th>
                  <td className="py-2 text-right text-ink">{formatMoney(f.incomeCents)}</td>
                  <td className="py-2 text-right text-ink">{formatMoney(f.spendingCents)}</td>
                  <td className={"py-2 text-right " + (f.surplusCents >= 0 ? "text-success" : "text-ink")}>
                    {signed(f.surplusCents)}
                  </td>
                  <td className="py-2 text-right text-ink-secondary">{pct(f.savingsRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-meta text-ink-tertiary">
          "Saved" is what's left over as a share of income. Transfers, card payments and investment contributions aren't
          counted as spending, so money moved to savings or investments is still part of what's left over.
        </p>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card as="section" aria-labelledby="cf-trend" className="p-6 max-md:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="cf-trend" className="text-heading text-ink">
              Trend
            </h2>
            <BasisTag basis="calculation" />
          </div>
          {recent.length >= 2 && earlier.length >= 1 ? (
            <>
              <p className="mt-3 text-body text-ink-secondary">
                Left over averaged {formatMoney(average(recent.map((f) => f.surplusCents)))} a month across the last{" "}
                {recent.length} full months, compared with {formatMoney(average(earlier.map((f) => f.surplusCents)))} in the{" "}
                {earlier.length} before.
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4">
                <Stat label="Average saved" value={pct(avgRate)} hint="of income, full months" />
                <Stat
                  label="Change"
                  value={signed(average(recent.map((f) => f.surplusCents)) - average(earlier.map((f) => f.surplusCents)))}
                  hint="per month, recent vs earlier"
                />
              </dl>
            </>
          ) : (
            <p className="mt-3 text-body text-ink-tertiary">A trend needs at least three full months of history.</p>
          )}
        </Card>

        <Card as="section" aria-labelledby="cf-split" className="p-6 max-md:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="cf-split" className="text-heading text-ink">
              What's already spoken for
            </h2>
            <BasisTag basis="calculation" />
          </div>
          {splitTotal === 0 ? (
            <p className="mt-3 text-body text-ink-tertiary">Not enough history yet.</p>
          ) : (
            <>
              <p className="mt-3 text-body text-ink-secondary">
                In a typical month about {Math.round((split.recurringCents / splitTotal) * 100)}% of spending was recurring
                payments.
              </p>
              <ProgressBar fraction={split.recurringCents / splitTotal} tone="muted" className="mt-4" />
              <dl className="mt-4 grid grid-cols-2 gap-4">
                <Stat label="Recurring" value={formatMoney(split.recurringCents)} hint="rent, loans, bills, subscriptions" />
                <Stat label="Everything else" value={formatMoney(split.otherCents)} hint="food, dining, fuel, one-offs" />
              </dl>
            </>
          )}
          <Button variant="tertiary" size="sm" className="-ml-3 mt-3" onClick={() => onOpen("recurring")}>
            See recurring payments
          </Button>
        </Card>
      </div>

      <Card as="section" aria-labelledby="cf-ahead" className="mt-4 p-6 max-md:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="cf-ahead" className="text-heading text-ink">
            Larger payments coming up
          </h2>
          <BasisTag basis="projection" />
        </div>
        {large.length === 0 ? (
          <p className="mt-3 text-body text-ink-tertiary">No recurring payments expected in the next 30 days.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {large.map((o) => (
              <li key={o.payment.key + o.date} className="flex items-center gap-3 py-2.5">
                <CategoryGlyph categoryId={o.payment.categoryId} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-ink">{o.payment.merchant}</span>
                  <span className="block text-label font-normal text-ink-tertiary">
                    {parseISODate(o.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  </span>
                </span>
                <span className="text-body tabular-nums text-ink">
                  {o.payment.variable ? "about " : ""}
                  {formatMoney(o.payment.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-meta text-ink-tertiary">
          The biggest bills and subscriptions expected in the next 30 days, from repeating patterns. Not a guarantee.
        </p>
        <Button variant="tertiary" size="sm" className="-ml-3 mt-1" onClick={() => onOpen("bills")}>
          See all upcoming bills
        </Button>
      </Card>
    </div>
  );
}
