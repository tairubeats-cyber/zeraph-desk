import { useMemo, useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Tabs, panelId, tabId } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { AskLink } from "@/components/finance/AskLink";
import { CashFlowChart } from "@/components/finance/CashFlowChart";
import { LineChart } from "@/components/finance/LineChart";
import { BasisTag, CategoryGlyph, SampleNotice } from "@/components/finance/parts";
import { ProgressBar } from "@/components/finance/inputs";
import { gate } from "@/components/finance/gate";
import type { Finance } from "@/lib/finance/useFinance";
import type { Plans } from "@/lib/finance/usePlans";
import type { Planning } from "@/lib/finance/usePlanning";
import type { Intel } from "@/lib/finance/useIntel";
import { buildHealth, formatMetric, type Detail, type Dimension, type DimensionKey, type GoalRow, type Metric } from "@/lib/finance/health";
import { formatMoney, monthKey, monthLabel, parseISODate } from "@/lib/finance/money";
import { GOAL_KINDS, ACCOUNT_KINDS } from "@/lib/finance/types";
import type { ViewKey } from "@/nav";

type Tab = "overview" | DimensionKey;

const fullDate = (iso: string) => parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const shortDate = (iso: string) => parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** What each area's card shows up front. The rest is one click in. */
const HEADLINE: Record<DimensionKey, string[]> = {
  "cash-flow": ["surplus", "avg-surplus", "recurring"],
  savings: ["rate", "months", "cash"],
  debt: ["total", "payments", "interest"],
  investing: ["value", "contrib", "growth"],
  spending: ["spent", "vs-month", "top"],
  goals: ["progress", "required", "trajectory"],
};

const OPEN_LABEL: Record<DimensionKey, string> = {
  "cash-flow": "Open Cash Flow",
  savings: "Open Goals",
  debt: "Open Debt",
  investing: "Open Investments",
  spending: "Open Spending",
  goals: "Open Goals",
};

function MetricList({ metrics }: { metrics: Metric[] }) {
  return (
    <dl className="divide-y divide-line">
      {metrics.map((m) => {
        const has = m.value !== null || (m.kind === "text" && !!m.text);
        return (
          <div key={m.id} className="grid gap-x-4 gap-y-1 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <dt className="flex items-center gap-2 text-body text-ink">
              {m.label}
              <BasisTag basis={m.basis} />
            </dt>
            <dd className="min-w-0">
              <span className={has ? "text-body font-medium tabular-nums text-ink" : "text-body text-ink-tertiary"}>{formatMetric(m)}</span>
              {(has ? m.note : m.missing) && <span className="mt-0.5 block text-label font-normal text-ink-tertiary">{has ? m.note : m.missing}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function GoalList({ rows }: { rows: GoalRow[] }) {
  if (rows.length === 0) return <p className="text-body text-ink-tertiary">No goals yet. Goals you add under Goals appear here.</p>;
  return (
    <ul className="space-y-4">
      {rows.map(({ goal, progress: p }) => (
        <li key={goal.id}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-body font-medium text-ink">{goal.name || GOAL_KINDS[goal.kind]}</span>
            <span className="text-body tabular-nums text-ink">
              {formatMoney(p.currentCents)} <span className="text-label font-normal text-ink-tertiary">of {formatMoney(goal.targetCents)}</span>
            </span>
          </div>
          <ProgressBar className="mt-2" fraction={p.fraction} tone={p.reached ? "muted" : "accent"} />
          <p className="mt-1.5 text-label font-normal text-ink-tertiary">
            {p.reached
              ? "Reached."
              : [
                  p.requiredMonthlyCents !== null ? `${formatMoney(p.requiredMonthlyCents)} a month would finish by ${goal.deadline ? fullDate(goal.deadline) : "the deadline"}.` : null,
                  p.deadlinePassed ? "The deadline has passed." : null,
                  p.projectedDate ? `At ${formatMoney(p.assumedMonthlyCents)} a month (${p.assumedFrom === "plan" ? "your plan" : "your recent pace"}) it finishes around ${fullDate(p.projectedDate)}${p.finishesByDeadline === false ? ", after the deadline" : p.finishesByDeadline === true ? ", before the deadline" : ""}.` : "No monthly amount is set or recorded to project from.",
                ]
                  .filter(Boolean)
                  .join(" ")}
          </p>
        </li>
      ))}
    </ul>
  );
}

function EmergencyTarget({ current, onSave }: { current: number | null; onSave: (months: number | null) => void }) {
  const [text, setText] = useState(current === null ? "" : String(current));
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim() === "") {
      setError(null);
      onSave(null);
      return;
    }
    const v = Number(text);
    if (!Number.isFinite(v) || v < 0.5 || v > 60) {
      setError("Enter a number of months from 0.5 to 60.");
      return;
    }
    setError(null);
    onSave(Math.round(v * 10) / 10);
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div className="w-44">
        <label htmlFor="hl-emergency" className="text-label text-ink">
          Emergency fund target, in months of spending
        </label>
        <Input id="hl-emergency" type="number" inputMode="decimal" step="0.5" min="0.5" max="60" className="mt-1.5" value={text} onChange={(e) => setText(e.target.value)} placeholder="Not set" />
      </div>
      <Button type="submit" variant="secondary">
        {text.trim() === "" ? "Clear target" : "Save target"}
      </Button>
      {error && (
        <p role="alert" className="w-full text-label text-danger">
          {error}
        </p>
      )}
      <p className="w-full text-label font-normal text-ink-tertiary">Only you decide what to aim for; this is never filled in for you. It's compared with your usual monthly spending.</p>
    </form>
  );
}

function DetailBody({ d, categoryName, today, onSaveTarget, emergencyMonths }: {
  d: Dimension;
  categoryName: (id: string) => string;
  today: string;
  onSaveTarget: (months: number | null) => void;
  emergencyMonths: number | null;
}) {
  const detail: Detail = d.detail;
  switch (detail.kind) {
    case "cash-flow":
      return (
        <div className="space-y-6">
          <div>
            <h3 className="text-body font-medium text-ink">Income and spending by month</h3>
            <div className="mt-3">
              <CashFlowChart months={detail.months} currentMonth={monthKey(today)} />
            </div>
          </div>
          <div>
            <h3 className="text-body font-medium text-ink">Largest known payments, next 30 days</h3>
            {detail.large.length === 0 ? (
              <p className="mt-2 text-body text-ink-tertiary">No recurring or planned payments are expected in the next 30 days.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {detail.large.map((l) => (
                  <li key={`${l.source}-${l.date}-${l.name}`} className="flex items-baseline justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-body text-ink">{l.name}</span>
                      <span className="text-meta text-ink-tertiary">
                        {shortDate(l.date)} · {l.source === "planned" ? "you planned this" : "repeats"}
                      </span>
                    </span>
                    <span className="text-body tabular-nums text-ink">{formatMoney(l.cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      );
    case "savings":
      return (
        <div className="space-y-6">
          <div>
            <h3 className="text-body font-medium text-ink">Where the cash is</h3>
            <ul className="mt-2 divide-y divide-line">
              {detail.cashAccounts.map((a) => (
                <li key={a.id} className="flex items-baseline justify-between gap-3 py-2.5">
                  <span className="truncate text-body text-ink">{a.name}</span>
                  <span className="text-body tabular-nums text-ink">{formatMoney(a.balanceCents)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-body font-medium text-ink">Emergency fund</h3>
            <div className="mt-3">
              <EmergencyTarget key={String(emergencyMonths)} current={emergencyMonths} onSave={onSaveTarget} />
            </div>
          </div>
          <div>
            <h3 className="text-body font-medium text-ink">Savings goals</h3>
            <div className="mt-3">
              <GoalList rows={detail.goals} />
            </div>
          </div>
        </div>
      );
    case "debt":
      return (
        <div className="space-y-4">
          {detail.debts.length === 0 ? (
            <p className="text-body text-ink-tertiary">No debts are recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left">
                <caption className="sr-only">Each debt with its balance, the rate and payment you entered, and how much has been paid down</caption>
                <thead>
                  <tr className="text-label text-ink-tertiary">
                    <th scope="col" className="py-2 pr-3 font-normal">Debt</th>
                    <th scope="col" className="py-2 pr-3 text-right font-normal">Owed</th>
                    <th scope="col" className="py-2 pr-3 text-right font-normal">Rate</th>
                    <th scope="col" className="py-2 pr-3 text-right font-normal">Payment</th>
                    <th scope="col" className="py-2 pr-3 text-right font-normal">Interest / month</th>
                    <th scope="col" className="py-2 text-right font-normal">Paid down</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {detail.debts.map((r) => (
                    <tr key={r.id} className="text-body text-ink">
                      <th scope="row" className="py-2.5 pr-3 font-normal">
                        {r.name}
                        <span className="block text-meta text-ink-tertiary">{ACCOUNT_KINDS[r.kind].label}</span>
                      </th>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{formatMoney(r.balanceCents)}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{r.aprBps === null ? <span className="text-ink-tertiary">Not entered</span> : `${(r.aprBps / 100).toFixed(2)}%`}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{r.paymentCents === null ? <span className="text-ink-tertiary">Not entered</span> : formatMoney(r.paymentCents)}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{r.monthlyInterestCents === null ? <span className="text-ink-tertiary">Not available</span> : formatMoney(r.monthlyInterestCents)}</td>
                      <td className="py-2.5 text-right tabular-nums">{r.paidFraction === null ? <span className="text-ink-tertiary">No history</span> : `${Math.round(r.paidFraction * 100)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {detail.debtFreeDate && (
            <p className="text-label font-normal text-ink-secondary">
              At the payments you entered and with nothing new charged, {detail.modelledAll ? "everything is paid off" : "the debts with a rate and payment are paid off"} around {fullDate(detail.debtFreeDate)}
              {detail.interestToPayOffCents !== null ? `, with about ${formatMoney(detail.interestToPayOffCents)} of interest along the way` : ""}. An estimate.
            </p>
          )}
          <p className="text-label font-normal text-ink-tertiary">Rates and payments are the ones you entered under Debt; nothing here is guessed.</p>
        </div>
      );
    case "investing":
      return (
        <div className="space-y-6">
          <div>
            <h3 className="text-body font-medium text-ink">How it's split</h3>
            {detail.allocation.length === 0 ? (
              <p className="mt-2 text-body text-ink-tertiary">No investments are recorded.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {detail.allocation.map((s) => (
                  <li key={s.key}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-body text-ink">{s.label}</span>
                      <span className="text-body tabular-nums text-ink">
                        {formatMoney(s.cents)} <span className="text-label font-normal text-ink-tertiary">{Math.round(s.fraction * 100)}%</span>
                      </span>
                    </div>
                    <ProgressBar className="mt-1.5" fraction={s.fraction} tone="muted" />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-label font-normal text-ink-tertiary">This describes what's held; it isn't a recommendation.</p>
          </div>
          <div>
            <h3 className="text-body font-medium text-ink">Accounts</h3>
            <ul className="mt-2 divide-y divide-line">
              {detail.accounts.map((a) => (
                <li key={a.id} className="flex items-baseline justify-between gap-3 py-2.5">
                  <span className="truncate text-body text-ink">{a.name}</span>
                  <span className="text-body tabular-nums text-ink">{formatMoney(a.balanceCents)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      );
    case "spending": {
      const covered = detail.trend.filter((p) => p.covered);
      return (
        <div className="space-y-6">
          <div>
            <h3 className="text-body font-medium text-ink">By category, {monthLabel(detail.month)} so far</h3>
            {detail.lines.length === 0 ? (
              <p className="mt-2 text-body text-ink-tertiary">Nothing has been spent yet this month.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {detail.lines.slice(0, 6).map((l) => (
                  <li key={l.categoryId} className="flex items-center gap-3 py-2.5">
                    <CategoryGlyph categoryId={l.categoryId} />
                    <span className="min-w-0 flex-1 truncate text-body text-ink">{categoryName(l.categoryId)}</span>
                    <span className="text-body tabular-nums text-ink">
                      {formatMoney(l.cents)} <span className="text-label font-normal text-ink-tertiary">{Math.round(l.share * 100)}%</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {covered.length >= 2 && (
            <div>
              <h3 className="text-body font-medium text-ink">Spending by month</h3>
              <div className="mt-3">
                <LineChart
                  labels={covered.map((p) => monthLabel(p.month))}
                  series={[{ name: "Spending", values: covered.map((p) => p.cents) }]}
                  xLabels={covered.map((p, index) => ({ index, text: monthLabel(p.month, "short") })).filter((_, i, all) => i % Math.max(1, Math.ceil(all.length / 6)) === 0 || i === all.length - 1)}
                  nonNegative
                  caption={`Spending for each of the last ${covered.length} months. The latest month is cut off at the same day of the month as today.`}
                />
              </div>
            </div>
          )}
          <p className="text-label font-normal text-ink-tertiary">The Spending screen breaks each category down by merchant, recurring charges and purchases that stand out.</p>
        </div>
      );
    }
    case "goals":
      return <GoalList rows={detail.goals} />;
  }
}

export function Health({
  finance,
  plans,
  planning,
  intel,
  onOpen,
}: {
  finance: Finance;
  plans: Plans;
  planning: Planning;
  intel: Intel;
  onOpen: (view: ViewKey) => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const { snapshot, today, transactions, categoriesById } = finance;

  const dims = useMemo(() => {
    if (!snapshot) return null;
    return buildHealth({
      today,
      accounts: snapshot.accounts,
      transactions,
      categories: categoriesById,
      recurring: plans.recurring,
      goals: plans.goals,
      contributions: plans.contributions,
      terms: planning.debtTerms,
      holdings: planning.holdings,
      planned: planning.planned,
      balanceHistory: snapshot.balanceHistory,
      positions: snapshot.positions,
      activity: snapshot.investmentActivity,
      longTerm: planning.longTerm,
      reserveCents: intel.prefs.reserveCents,
      emergencyMonths: intel.prefs.emergencyMonths,
    });
  }, [snapshot, today, transactions, categoriesById, plans.recurring, plans.goals, plans.contributions, planning.debtTerms, planning.holdings, planning.planned, planning.longTerm, intel.prefs.reserveCents, intel.prefs.emergencyMonths]);

  const blocked = gate(finance, plans, planning);
  if (blocked || !dims) return blocked;

  const tabs: { key: Tab; label: string }[] = [{ key: "overview", label: "Overview" }, ...dims.map((d) => ({ key: d.key as Tab, label: d.label }))];
  const shown = tab === "overview" ? null : dims.find((d) => d.key === tab) ?? null;
  const categoryName = (id: string) => categoriesById.get(id)?.name ?? "Other";

  return (
    <div>
      <PageHeader
        title="Financial Health"
        description="Six areas of your finances, each worked out from your own data. There's no overall score."
        actions={<AskLink label="Ask how things look" question="How am I doing financially?" />}
      />
      {finance.origin === "sample" && <SampleNotice />}

      <Tabs base="hl" label="Areas of your financial health" tabs={tabs} value={tab} onChange={setTab} />

      {shown === null ? (
        <div role="tabpanel" id={panelId("hl", "overview")} aria-labelledby={tabId("hl", "overview")} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {dims.map((d) => {
            const headline = HEADLINE[d.key].map((id) => d.metrics.find((m) => m.id === id)).filter((m): m is Metric => !!m);
            return (
              <Card key={d.key} as="section" aria-labelledby={`hl-card-${d.key}`} className="flex flex-col p-6 max-md:p-5">
                <h2 id={`hl-card-${d.key}`} className="text-heading text-ink">
                  {d.label}
                </h2>
                <p className="mt-1 text-label font-normal text-ink-secondary">{d.summary}</p>
                <dl className="mt-4 space-y-2.5">
                  {headline.map((m) => (
                    <div key={m.id}>
                      <dt className="flex items-center gap-2 text-label text-ink-tertiary">
                        {m.label}
                        <BasisTag basis={m.basis} />
                      </dt>
                      <dd className={m.value !== null || m.text ? "text-body font-medium tabular-nums text-ink" : "text-body text-ink-tertiary"}>{formatMetric(m)}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-auto pt-5">
                  <Button variant="secondary" size="sm" onClick={() => setTab(d.key)} aria-label={`See the detail for ${d.label}`}>
                    See detail
                    <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <div role="tabpanel" id={panelId("hl", shown.key)} aria-labelledby={tabId("hl", shown.key)}>
          <Card as="section" aria-labelledby="hl-detail" className="p-6 max-md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="hl-detail" className="text-heading text-ink">
                  {shown.label}
                </h2>
                <p className="mt-1 text-body text-ink-secondary">{shown.summary}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => onOpen(shown.view)}>
                {OPEN_LABEL[shown.key]}
                <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </div>
            <div className="mt-4">
              <MetricList metrics={shown.metrics} />
            </div>
          </Card>
          <Card as="section" aria-label={`More about ${shown.label}`} className="mt-4 p-6 max-md:p-5">
            <DetailBody
              d={shown}
              categoryName={categoryName}
              today={today}
              emergencyMonths={intel.prefs.emergencyMonths}
              onSaveTarget={(months) => void intel.savePrefs({ ...intel.prefs, emergencyMonths: months })}
            />
          </Card>
        </div>
      )}
    </div>
  );
}
