import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { AskLink } from "@/components/finance/AskLink";
import { BasisTag, CategoryGlyph, SampleNotice } from "@/components/finance/parts";
import { MoneyInput, ProgressBar, Stat } from "@/components/finance/inputs";
import { gate } from "@/components/finance/gate";
import type { Finance } from "@/lib/finance/useFinance";
import type { Plans } from "@/lib/finance/usePlans";
import { averageMonthlySpend, budgetRows, type BudgetRow } from "@/lib/finance/budget";
import { formatMoney, monthKey, monthLabel } from "@/lib/finance/money";

/** Plain wording for how a category stands: no shame, just the difference. */
function standing(remaining: number): string {
  return remaining >= 0 ? `${formatMoney(remaining)} left` : `${formatMoney(-remaining)} over`;
}

function Cell({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <span className="text-meta text-ink-tertiary md:sr-only">{label}</span>
      <div className="tabular-nums">{children}</div>
    </div>
  );
}

export function Budgets({ finance, plans }: { finance: Finance; plans: Plans }) {
  const { today, transactions, categories, categoriesById } = finance;

  const rows = useMemo(
    () => budgetRows(transactions, categories, plans.recurring, plans.budgets, today),
    [transactions, categories, plans.recurring, plans.budgets, today],
  );

  const ordered = useMemo(() => {
    const rank = (r: BudgetRow) => (r.budgetCents !== null ? 0 : r.actualCents > 0 ? 1 : 2);
    return [...rows].sort((a, b) => rank(a) - rank(b) || b.actualCents - a.actualCents);
  }, [rows]);

  const suggestions = useMemo(() => {
    const avg = averageMonthlySpend(transactions, categoriesById, today);
    return new Map([...avg].filter(([id, cents]) => cents > 0 && !plans.budgets.has(id)));
  }, [transactions, categoriesById, today, plans.budgets]);

  const blocked = gate(finance, plans);
  if (blocked) return blocked;

  const budgeted = rows.filter((r) => r.budgetCents !== null);
  const total = {
    budget: budgeted.reduce((s, r) => s + (r.budgetCents ?? 0), 0),
    actual: budgeted.reduce((s, r) => s + r.actualCents, 0),
    projected: budgeted.reduce((s, r) => s + r.projectedCents, 0),
  };
  const remaining = total.budget - total.actual;

  return (
    <div>
      <PageHeader
        title="Budgets"
        description={`Monthly limits by category, for ${monthLabel(monthKey(today))}.`}
        actions={
          <>
            <AskLink label="Ask about budgets" question="Am I within my budgets?" />
            {suggestions.size > 0 && (
              <Button variant="secondary" onClick={() => void plans.setBudgets(suggestions)}>
                Fill from my averages
              </Button>
            )}
          </>
        }
      />
      {finance.origin === "sample" && <SampleNotice />}

      {budgeted.length === 0 ? (
        <Card className="px-6 py-10 text-center">
          <p className="text-heading text-ink">No budgets yet</p>
          <p className="mx-auto mt-1 max-w-[52ch] text-body text-ink-tertiary">
            Type a monthly amount next to any category below. Or start from what you've usually spent: "Fill from my
            averages" sets a budget for each category using your last three full months, and you can change any of them.
          </p>
        </Card>
      ) : (
        <Card as="section" aria-labelledby="bg-sum" className="p-6 max-md:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="bg-sum" className="text-heading text-ink">
              Across your budgets
            </h2>
            <span className="flex gap-1.5">
              <BasisTag basis="calculation" />
              <BasisTag basis="projection" />
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Budgeted" value={formatMoney(total.budget)} />
            <Stat label="Spent" value={formatMoney(total.actual)} />
            <Stat label={remaining >= 0 ? "Remaining" : "Over"} value={formatMoney(Math.abs(remaining))} />
            <Stat label="Projected" value={formatMoney(total.projected)} hint="by the end of the month" />
          </dl>
          <ProgressBar
            fraction={total.budget > 0 ? total.actual / total.budget : 0}
            tone={remaining < 0 ? "warning" : "accent"}
            className="mt-5"
          />
        </Card>
      )}

      <Card as="section" aria-label="Categories" className="mt-4">
        <div
          aria-hidden="true"
          className="hidden grid-cols-[minmax(0,1.6fr)_140px_repeat(3,minmax(0,1fr))] gap-4 border-b border-line px-5 py-3 text-label text-ink-tertiary md:grid"
        >
          <span>Category</span>
          <span className="text-right">Budget / month</span>
          <span className="text-right">Spent</span>
          <span className="text-right">Remaining</span>
          <span className="text-right">Projected</span>
        </div>
        <ul className="divide-y divide-line">
          {ordered.map((r) => {
            const name = categoriesById.get(r.categoryId)?.name ?? "Other";
            const over = r.remainingCents !== null && r.remainingCents < 0;
            return (
              <li
                key={r.categoryId}
                className="grid gap-x-4 gap-y-2 px-5 py-3.5 max-md:grid-cols-2 md:grid-cols-[minmax(0,1.6fr)_140px_repeat(3,minmax(0,1fr))] md:items-center"
              >
                <div className="flex min-w-0 items-center gap-3 max-md:col-span-2">
                  <CategoryGlyph categoryId={r.categoryId} />
                  <span className="truncate text-body font-medium text-ink">{name}</span>
                </div>
                <div className="max-md:col-span-2">
                  <MoneyInput
                    aria-label={`Monthly budget for ${name}`}
                    placeholder="Set"
                    value={r.budgetCents}
                    onCommit={(cents) => void plans.setBudget(r.categoryId, cents)}
                  />
                </div>
                <Cell label="Spent" className="md:text-right">
                  <span className="text-body text-ink">{formatMoney(r.actualCents)}</span>
                </Cell>
                <Cell label="Remaining" className="md:text-right">
                  <span className={"text-body " + (over ? "text-warning" : "text-ink")}>
                    {r.remainingCents === null ? <span className="text-ink-tertiary">n/a</span> : standing(r.remainingCents)}
                  </span>
                </Cell>
                <Cell label="Projected" className="max-md:col-span-2 md:text-right">
                  <span className="text-body text-ink">{formatMoney(r.projectedCents)}</span>
                </Cell>
                {r.budgetCents !== null && r.budgetCents > 0 && (
                  <div className="col-span-full">
                    <ProgressBar fraction={r.actualCents / r.budgetCents} tone={over ? "warning" : "accent"} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <p className="mt-4 max-w-[70ch] px-1 text-meta text-ink-tertiary">
        Spent is what's happened so far this month. Projected is an estimate: what's spent so far, plus recurring
        payments still expected this month, plus your everyday pace carried to the end of the month. Transfers aren't
        counted as spending.
      </p>
    </div>
  );
}
