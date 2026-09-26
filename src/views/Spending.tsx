import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { AskLink } from "@/components/finance/AskLink";
import { LineChart } from "@/components/finance/LineChart";
import { BasisTag, CategoryGlyph, SampleNotice } from "@/components/finance/parts";
import { Stat } from "@/components/finance/inputs";
import { gate } from "@/components/finance/gate";
import type { Finance } from "@/lib/finance/useFinance";
import type { Plans } from "@/lib/finance/usePlans";
import type { TxFilters } from "@/lib/finance/filters";
import { formatMoney, monthKey, monthLabel, monthYearLabel, parseISODate, shiftMonth } from "@/lib/finance/money";
import { FREQUENCY_LABELS } from "@/lib/finance/recurring";
import {
  changePhrase,
  selectableMonths,
  signedChange,
  spendingReport,
  spendingTrend,
  topMerchants,
  unusualPurchases,
  yearUnavailableReason,
  type Change,
  type SpendingReport,
} from "@/lib/finance/spending";
import type { ViewKey } from "@/nav";

const shortDate = (iso: string) => parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** One sentence comparing this month with an earlier one, or saying why it can't. */
/** "$180 (4%) more than the same days of August ($4,350)", or "... than May ($155)" when the month is over. */
function Comparison({ partial, against, unavailable, monthText = monthLabel }: { partial: boolean; against: { month: string; totalCents: number; change: Change } | null; unavailable: string; monthText?: (month: string) => string }) {
  if (!against) return <p className="text-body text-ink-tertiary">{unavailable}</p>;
  return (
    <p className="text-body text-ink-secondary">
      <span className="font-medium text-ink">{changePhrase(against.change)}</span> {partial ? "the same days of " : ""}
      {monthText(against.month)} <span className="whitespace-nowrap">({formatMoney(against.totalCents)})</span>
    </p>
  );
}

/** A category's comparison in the same shape as the whole month's, so one component words both. */
function asAgainst(month: string, v: { cents: number; fraction: number | null; previousCents: number } | null | undefined) {
  return v ? { month, totalCents: v.previousCents, change: { cents: v.cents, fraction: v.fraction } } : null;
}

function ChangeLine({ label, vs }: { label: string; vs: { cents: number; fraction: number | null; previousCents: number } | null }) {
  if (!vs) return null;
  return (
    <span className="block text-meta text-ink-tertiary">
      {signedChange(vs)} vs. {label} ({formatMoney(vs.previousCents)})
    </span>
  );
}

export function Spending({ finance, plans, onOpen }: { finance: Finance; plans: Plans; onOpen: (view: ViewKey, filters?: Partial<TxFilters>) => void }) {
  const { today, transactions, categoriesById } = finance;
  const current = monthKey(today);
  const [month, setMonth] = useState(current);
  const [selected, setSelected] = useState<string | null>(null);

  const months = useMemo(() => selectableMonths(transactions, today), [transactions, today]);
  const shownMonth = months.includes(month) ? month : current;
  const report: SpendingReport = useMemo(() => spendingReport(transactions, categoriesById, shownMonth, today), [transactions, categoriesById, shownMonth, today]);
  const trend = useMemo(() => spendingTrend(transactions, categoriesById, selected, shownMonth, today, 12).filter((p) => p.covered), [transactions, categoriesById, selected, shownMonth, today]);
  const merchants = useMemo(() => topMerchants(transactions, categoriesById, shownMonth, report.throughDay, selected, 5), [transactions, categoriesById, shownMonth, report.throughDay, selected]);
  const unusual = useMemo(() => unusualPurchases(transactions, categoriesById, shownMonth, report.throughDay, selected), [transactions, categoriesById, shownMonth, report.throughDay, selected]);

  const blocked = gate(finance, plans);
  if (blocked) return blocked;

  const line = selected ? report.lines.find((l) => l.categoryId === selected) : null;
  const selectedName = selected ? (categoriesById.get(selected)?.name ?? "Other") : null;
  const when = report.partial ? `so far in ${monthLabel(shownMonth)}` : `in ${monthLabel(shownMonth)}`;
  const period: Partial<TxFilters>["period"] = shownMonth === current ? "this_month" : shownMonth === shiftMonth(current, -1) ? "last_month" : "last_90";
  const recurringHere = selected
    ? plans.recurring.filter((r) => r.direction === "out" && r.categoryId === selected).sort((a, b) => b.annualCents - a.annualCents)
    : [];

  const headline = selected ? (line ? line.cents : 0) : report.totalCents;

  return (
    <div>
      <PageHeader
        title="Spending"
        description="Where the money went, and how it compares with earlier."
        actions={<AskLink label="Ask what changed" question="What changed compared with last month?" />}
      />
      {finance.origin === "sample" && <SampleNotice />}

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="w-56">
          <label htmlFor="sp-month" className="text-label text-ink">
            Month
          </label>
          <Select id="sp-month" className="mt-1.5" value={shownMonth} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthYearLabel(m)}
                {m === current ? " (so far)" : ""}
              </option>
            ))}
          </Select>
        </div>
        {selected && (
          <Button variant="secondary" onClick={() => setSelected(null)}>
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            All categories
          </Button>
        )}
      </div>

      <Card as="section" aria-labelledby="sp-total" className="p-6 max-md:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="sp-total" className="text-heading text-ink">
            {selected ? `${selectedName}` : "Total spending"} {when}
          </h2>
          <BasisTag basis="calculation" />
        </div>
        {report.totalCents === 0 ? (
          <p className="mt-4 text-body text-ink-tertiary">No spending is recorded {report.partial ? "yet this month" : `for ${monthLabel(shownMonth)}`}.</p>
        ) : (
          <>
            <p className="mt-3 text-title tabular-nums text-ink">{formatMoney(headline)}</p>
            {selected && line && (
              <p className="mt-1 text-label text-ink-tertiary">
                {Math.round(line.share * 100)}% of all spending {when} · {line.count} {line.count === 1 ? "transaction" : "transactions"}
              </p>
            )}
            <div className="mt-4 space-y-1.5">
              {selected && !line ? (
                <p className="text-body text-ink-tertiary">Nothing was spent on {selectedName?.toLowerCase()} {when}.</p>
              ) : (
                <>
                  <Comparison
                    partial={report.partial}
                    against={selected ? asAgainst(shiftMonth(shownMonth, -1), line?.vsPreviousMonth) : report.previousMonth}
                    unavailable={`Needs transactions from before ${monthLabel(shiftMonth(shownMonth, -1))} to compare with.`}
                  />
                  <Comparison
                    partial={report.partial}
                    against={selected ? asAgainst(report.yearAgoMonth, line?.vsPreviousYear) : report.previousYear}
                    monthText={monthYearLabel}
                    unavailable={yearUnavailableReason(report)}
                  />
                </>
              )}
            </div>
            {report.partial && <p className="mt-3 text-meta text-ink-tertiary">Compared over the same days of the month, so a month that isn't over isn't measured against a whole one.</p>}
          </>
        )}
      </Card>

      {trend.length >= 2 && (
        <Card as="section" aria-labelledby="sp-trend" className="mt-4 p-6 max-md:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="sp-trend" className="text-heading text-ink">
              {selected ? `${selectedName} by month` : "Spending by month"}
            </h2>
            <BasisTag basis="calculation" />
          </div>
          <div className="mt-4">
            <LineChart
              labels={trend.map((p) => monthLabel(p.month))}
              series={[{ name: selected ? `${selectedName} spending` : "Spending", values: trend.map((p) => p.cents) }]}
              xLabels={trend.map((p, index) => ({ index, text: monthLabel(p.month, "short") })).filter((_, i, all) => i % Math.max(1, Math.ceil(all.length / 6)) === 0 || i === all.length - 1)}
              nonNegative
              caption={`${selected ? `${selectedName} spending` : "Spending"} for each of the last ${trend.length} months. The latest month is cut off at the same day of the month as today.`}
            />
          </div>
        </Card>
      )}

      {!selected && report.lines.length > 0 && (
        <Card as="section" aria-labelledby="sp-cats" className="mt-4 p-6 max-md:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="sp-cats" className="text-heading text-ink">
              By category
            </h2>
            <BasisTag basis="calculation" />
          </div>
          <p className="mt-1 text-label font-normal text-ink-tertiary">Select a category for its trend, merchants, recurring charges and anything unusual.</p>
          <ul className="-mx-2 mt-3">
            {report.lines.map((l) => {
              const name = categoriesById.get(l.categoryId)?.name ?? "Other";
              return (
                <li key={l.categoryId}>
                  <button
                    onClick={() => setSelected(l.categoryId)}
                    aria-label={`${name}, ${formatMoney(l.cents)}, ${Math.round(l.share * 100)}% of spending. Show details.`}
                    className="flex w-full items-center gap-3 rounded-control px-2 py-2.5 text-left transition-colors duration-150 ease-standard hover:bg-surface-secondary"
                  >
                    <CategoryGlyph categoryId={l.categoryId} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-body font-medium text-ink">{name}</span>
                        <span className="text-body tabular-nums text-ink">
                          {formatMoney(l.cents)} <span className="text-label font-normal text-ink-tertiary">{Math.round(l.share * 100)}%</span>
                        </span>
                      </span>
                      <span aria-hidden="true" className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-secondary">
                        <span className="block h-full rounded-full bg-chart-muted" style={{ width: `${Math.max(2, l.share * 100)}%` }} />
                      </span>
                      <ChangeLine label={report.partial ? "the same days last month" : "the month before"} vs={l.vsPreviousMonth} />
                      <ChangeLine label={report.partial ? "the same days a year ago" : "a year ago"} vs={l.vsPreviousYear} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {selected && (
        <>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Card as="section" aria-labelledby="sp-merch" className="p-6 max-md:p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 id="sp-merch" className="text-heading text-ink">
                  Largest merchants
                </h2>
                <BasisTag basis="calculation" />
              </div>
              {merchants.length === 0 ? (
                <p className="mt-4 text-body text-ink-tertiary">Nothing recorded in this category {when}.</p>
              ) : (
                <ol className="mt-3 divide-y divide-line">
                  {merchants.map((m) => (
                    <li key={m.merchant} className="flex items-baseline justify-between gap-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate text-body text-ink">{m.merchant}</span>
                        <span className="text-meta text-ink-tertiary">
                          {m.count} {m.count === 1 ? "purchase" : "purchases"}
                        </span>
                      </span>
                      <span className="text-body tabular-nums text-ink">{formatMoney(m.cents)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <Card as="section" aria-labelledby="sp-rec" className="p-6 max-md:p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 id="sp-rec" className="text-heading text-ink">
                  Recurring charges
                </h2>
                <BasisTag basis="calculation" />
              </div>
              {recurringHere.length === 0 ? (
                <p className="mt-4 text-body text-ink-tertiary">No repeating charges were found in this category.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {recurringHere.map((r) => (
                    <li key={r.key} className="flex items-baseline justify-between gap-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate text-body text-ink">{r.merchant}</span>
                        <span className="text-meta text-ink-tertiary">
                          {FREQUENCY_LABELS[r.frequency]} · about {formatMoney(r.annualCents)} a year
                        </span>
                      </span>
                      <span className="text-body tabular-nums text-ink">
                        {r.variable ? "about " : ""}
                        {formatMoney(r.typicalCents, { cents: true })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card as="section" aria-labelledby="sp-unusual" className="mt-4 p-6 max-md:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 id="sp-unusual" className="text-heading text-ink">
                Purchases that stand out
              </h2>
              <BasisTag basis="calculation" />
            </div>
            {unusual.length === 0 ? (
              <p className="mt-4 text-body text-ink-tertiary">Nothing here was far above what's usual for {selectedName?.toLowerCase()} {when}.</p>
            ) : (
              <>
                <p className="mt-1 text-label font-normal text-ink-tertiary">Purchases of at least $100 that were at least 3 times the usual one in this category. Standing out isn't a problem; it can be a planned purchase.</p>
                <ul className="mt-3 divide-y divide-line">
                  {unusual.map((u) => (
                    <li key={u.id} className="flex items-baseline justify-between gap-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate text-body text-ink">{u.merchant}</span>
                        <span className="text-meta text-ink-tertiary">
                          {shortDate(u.date)} · about {Math.round(u.times * 10) / 10}× the usual {formatMoney(u.usualCents)}
                        </span>
                      </span>
                      <span className="text-body tabular-nums text-ink">{formatMoney(u.cents, { cents: true })}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <div className="mt-4 flex justify-end">
            <Button variant="secondary" onClick={() => onOpen("transactions", { categoryId: selected, period })}>
              See these transactions
            </Button>
          </div>
        </>
      )}

      {report.lines.length === 0 && !selected && (
        <Card className="mt-4 p-6 max-md:p-5">
          <Stat label={monthLabel(shownMonth)} value="No spending" />
        </Card>
      )}
    </div>
  );
}
