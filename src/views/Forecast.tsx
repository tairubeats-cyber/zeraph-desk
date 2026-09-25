import { useMemo, useState } from "react";
import { Info, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/PageHeader";
import { AskLink } from "@/components/finance/AskLink";
import { BasisTag, SampleNotice } from "@/components/finance/parts";
import { MoneyInput, Segmented } from "@/components/finance/inputs";
import { LineChart } from "@/components/finance/LineChart";
import { gate } from "@/components/finance/gate";
import type { Finance } from "@/lib/finance/useFinance";
import type { Plans } from "@/lib/finance/usePlans";
import type { Planning } from "@/lib/finance/usePlanning";
import { buildForecast, FORECAST_KIND_LABELS, type ForecastKind } from "@/lib/finance/forecast";
import { addDays, daysBetween, formatMoney, parseISODate } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

const fullDate = (iso: string) =>
  parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const rowDate = (iso: string) =>
  parseISODate(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const monthDay = (iso: string) => parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const HORIZONS = [30, 60, 90, 180];
const KIND_ORDER: ForecastKind[] = ["income", "bill", "subscription", "debt", "transfer", "planned"];
const COLLAPSED_ROWS = 12;

export function Forecast({ finance, plans, planning }: { finance: Finance; plans: Plans; planning: Planning }) {
  const { snapshot, today } = finance;
  const [days, setDays] = useState(90);
  const [everyday, setEveryday] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState(addDays(today, 7));
  const [amount, setAmount] = useState<number | null>(null);
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [formError, setFormError] = useState<string | null>(null);

  const forecast = useMemo(
    () =>
      snapshot
        ? buildForecast({
            today,
            days,
            accounts: snapshot.accounts,
            transactions: finance.transactions,
            categories: finance.categoriesById,
            recurring: plans.recurring,
            planned: planning.planned,
            includeEveryday: everyday,
          })
        : null,
    [snapshot, today, days, finance.transactions, finance.categoriesById, plans.recurring, planning.planned, everyday],
  );

  const blocked = gate(finance, plans, planning);
  if (blocked) return blocked;
  if (!snapshot) return null;

  const header = (
    <>
      <PageHeader
        title="Forecast"
        description="Where your spending money is likely headed, from what's expected to come in and go out."
        actions={<AskLink label="Ask about my forecast" question="Will I run low on cash in the next 30 days?" />}
      />
      {finance.origin === "sample" && <SampleNotice />}
    </>
  );

  if (!forecast) {
    return (
      <div>
        {header}
        <Card className="px-6 py-12 text-center">
          <p className="text-heading text-ink">No checking or cash account to forecast</p>
          <p className="mx-auto mt-1 max-w-[52ch] text-body text-ink-tertiary">
            The forecast follows the balance of the accounts you spend from. Savings and investments aren't part of it.
          </p>
        </Card>
      </div>
    );
  }

  const daily = forecast.days > 0 ? forecast.everydayCents / forecast.days : 0;
  const endDate = addDays(today, days);
  const labels = forecast.points.map((p) => fullDate(p.date));
  const ticks = [0, 1 / 3, 2 / 3, 1].map((t) => {
    const index = Math.round(t * (forecast.points.length - 1));
    return { index, text: monthDay(forecast.points[index].date) };
  });

  // Running balance after each dated item, everyday spending included up to that day.
  let running = forecast.startCents;
  const rows = forecast.events.map((e) => {
    running += e.amountCents;
    return { e, after: running - Math.round(daily * daysBetween(today, e.date)) };
  });
  const shownRows = showAll ? rows : rows.slice(0, COLLAPSED_ROWS);

  function submitPlanned(ev: React.FormEvent) {
    ev.preventDefault();
    if (!name.trim()) return setFormError("Give it a name.");
    if (amount === null || amount <= 0) return setFormError("Enter an amount.");
    if (!date || date < today) return setFormError("Pick today or a later date.");
    void planning.addPlanned({ name: name.trim(), date, amountCents: amount, direction });
    setName("");
    setAmount(null);
    setFormError(null);
    setAdding(false);
  }

  return (
    <div>
      {header}

      <div role="note" className="mb-4 flex items-start gap-3 rounded-card border border-line bg-surface-secondary px-4 py-3 text-body text-ink-secondary">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" strokeWidth={1.75} aria-hidden="true" />
        <p>
          <span className="font-medium text-ink">A projection, not a promise.</span> It assumes each payment arrives on the
          date and for the amount its pattern suggests. It can't know about anything that isn't in your history or your plans.
        </p>
      </div>

      <Card as="section" aria-labelledby="fc-sum" className="p-6 max-md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="fc-sum" className="text-heading text-ink">
            {forecast.accounts.map((a) => a.name).join(", ")}
          </h2>
          <Segmented
            label="How far ahead"
            value={days}
            onChange={(d) => {
              setDays(d);
              setShowAll(false);
            }}
            options={HORIZONS.map((d) => ({ value: d, label: `${d} days` }))}
          />
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <dt className="flex items-center gap-2 text-label text-ink-tertiary">
              Balance today <BasisTag basis="fact" />
            </dt>
            <dd className="mt-1 text-title tabular-nums text-ink">{formatMoney(forecast.startCents)}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-2 text-label text-ink-tertiary">
              Projected on {monthDay(endDate)} <BasisTag basis="projection" />
            </dt>
            <dd className="mt-1 text-title tabular-nums text-ink">{formatMoney(forecast.endCents)}</dd>
            <dd className="text-meta text-ink-tertiary">
              {forecast.endCents === forecast.startCents ? "no change" : `${formatMoney(forecast.endCents - forecast.startCents, { signed: true })} from today`}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-2 text-label text-ink-tertiary">
              Lowest projected <BasisTag basis="projection" />
            </dt>
            <dd className="mt-1 text-title tabular-nums text-ink">{formatMoney(forecast.lowest.balanceCents)}</dd>
            <dd className="text-meta text-ink-tertiary">{forecast.lowest.date === today ? "today" : `around ${fullDate(forecast.lowest.date)}`}</dd>
          </div>
        </dl>

        {forecast.firstBelowZero && (
          <p role="status" className="mt-4 rounded-control bg-warning-soft px-3 py-2 text-body text-ink">
            The projected balance drops below $0 around {fullDate(forecast.firstBelowZero)}. That's an estimate, and the dated items below are what drive it.
          </p>
        )}

        <div className="mt-5">
          <LineChart
            labels={labels}
            series={[{ name: "Projected balance", values: forecast.points.map((p) => p.balanceCents) }]}
            xLabels={ticks}
            zeroLine
            caption={`Projected balance from ${fullDate(today)} to ${fullDate(endDate)}`}
          />
        </div>

        <div className="mt-5 flex items-start justify-between gap-4 border-t border-line pt-4">
          <div className="min-w-0">
            <p id="fc-every" className="text-body font-medium text-ink">
              Include typical everyday spending
            </p>
            <p className="text-label font-normal text-ink-tertiary">
              Groceries, fuel and the like, at your recent average of {formatMoney(Math.round(daily * 30.4375))} a month from these accounts. An estimate; turn it off to see only the dated items.
            </p>
          </div>
          <Switch aria-labelledby="fc-every" checked={everyday} onChange={setEveryday} />
        </div>
      </Card>

      <Card as="section" aria-labelledby="fc-time" className="mt-4 p-6 max-md:p-5">
        <h2 id="fc-time" className="text-heading text-ink">
          What's expected, in order
        </h2>
        <ol className="mt-3 divide-y divide-line">
          <li className="flex items-center gap-3 py-2.5">
            <span className="w-24 shrink-0 text-label font-normal text-ink-tertiary">Today</span>
            <span className="min-w-0 flex-1 text-body font-medium text-ink">Balance in your account</span>
            <BasisTag basis="fact" />
            <span className="w-24 shrink-0 text-right text-body font-medium tabular-nums text-ink">{formatMoney(forecast.startCents)}</span>
          </li>
          {shownRows.map(({ e, after }, i) => (
            <li key={`${e.date}-${e.label}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2.5">
              <span className="w-24 shrink-0 text-label font-normal text-ink-tertiary">{rowDate(e.date)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-ink">{e.label}</span>
                <span className="block text-meta text-ink-tertiary">
                  {FORECAST_KIND_LABELS[e.kind]}
                  {e.variable ? " · amount varies, this is an estimate" : ""}
                </span>
              </span>
              <span className={cn("w-24 shrink-0 text-right text-body tabular-nums", e.amountCents > 0 ? "text-success" : "text-ink")}>
                {formatMoney(e.amountCents, { signed: true, cents: true })}
              </span>
              <span className="w-24 shrink-0 text-right text-label font-normal tabular-nums text-ink-tertiary">{formatMoney(after)}</span>
            </li>
          ))}
          {rows.length > COLLAPSED_ROWS && (
            <li className="py-1.5">
              <Button variant="tertiary" size="sm" className="-ml-3" onClick={() => setShowAll((s) => !s)}>
                {showAll ? "Show fewer" : `Show all ${rows.length} items`}
              </Button>
            </li>
          )}
          {forecast.everydayCents > 0 && (
            <li className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2.5">
              <span className="w-24 shrink-0 text-label font-normal text-ink-tertiary">Each day</span>
              <span className="min-w-0 flex-1">
                <span className="block text-body text-ink">Typical everyday spending</span>
                <span className="block text-meta text-ink-tertiary">An estimate, spread evenly across the {days} days</span>
              </span>
              <span className="w-24 shrink-0 text-right text-body tabular-nums text-ink">{formatMoney(-forecast.everydayCents, { signed: true })}</span>
              <span className="w-24 shrink-0" />
            </li>
          )}
          <li className="flex items-center gap-3 py-2.5">
            <span className="w-24 shrink-0 text-label font-normal text-ink-tertiary">{monthDay(endDate)}</span>
            <span className="min-w-0 flex-1 text-body font-medium text-ink">Projected balance</span>
            <BasisTag basis="projection" />
            <span className="w-24 shrink-0 text-right text-body font-medium tabular-nums text-ink">{formatMoney(forecast.endCents)}</span>
          </li>
        </ol>
        <p className="mt-2 text-meta text-ink-tertiary">The column on the right is the projected balance after each item.</p>
      </Card>

      <Card as="section" aria-labelledby="fc-break" className="mt-4 p-6 max-md:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="fc-break" className="text-heading text-ink">
            Over the next {days} days
          </h2>
          <BasisTag basis="projection" />
        </div>
        <dl className="mt-3 divide-y divide-line">
          {KIND_ORDER.filter((k) => forecast.events.some((e) => e.kind === k)).map((k) => (
            <div key={k} className="flex items-center justify-between gap-3 py-2.5 text-body">
              <dt className="text-ink-secondary">{FORECAST_KIND_LABELS[k]}</dt>
              <dd className={cn("tabular-nums", forecast.totals[k] > 0 ? "text-success" : "text-ink")}>
                {formatMoney(forecast.totals[k], { signed: true })}
              </dd>
            </div>
          ))}
          {forecast.everydayCents > 0 && (
            <div className="flex items-center justify-between gap-3 py-2.5 text-body">
              <dt className="text-ink-secondary">Typical everyday spending (estimate)</dt>
              <dd className="tabular-nums text-ink">{formatMoney(-forecast.everydayCents, { signed: true })}</dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 py-2.5 text-body font-medium">
            <dt className="text-ink">Net change</dt>
            <dd className="tabular-nums text-ink">{formatMoney(forecast.endCents - forecast.startCents, { signed: true })}</dd>
          </div>
        </dl>
        {forecast.notes.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-line pt-3">
            {forecast.notes.map((n) => (
              <li key={n} className="text-label font-normal text-ink-tertiary">
                {n}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <section aria-labelledby="fc-plan" className="mt-8">
        <div className="mb-2 flex items-end justify-between gap-3 px-1">
          <div>
            <h2 id="fc-plan" className="text-heading text-ink">
              Planned by you
            </h2>
            <p className="text-label font-normal text-ink-tertiary">A one-off expense or income you know is coming. It's added to the forecast.</p>
          </div>
          <Button variant="secondary" onClick={() => setAdding(true)} disabled={adding}>
            <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Add
          </Button>
        </div>

        {adding && (
          <Card as="section" aria-label="Add a planned item" className="mb-3 p-6 max-md:p-5">
            <form noValidate onSubmit={submitPlanned} className="grid gap-3 md:grid-cols-2">
              <div>
                <label htmlFor="pl-name" className="text-label text-ink">
                  What is it?
                </label>
                <Input id="pl-name" className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dentist, tax refund, trip deposit" />
              </div>
              <div>
                <label htmlFor="pl-dir" className="text-label text-ink">
                  Money
                </label>
                <Select id="pl-dir" className="mt-1.5" value={direction} onChange={(e) => setDirection(e.target.value as "in" | "out")}>
                  <option value="out">Going out</option>
                  <option value="in">Coming in</option>
                </Select>
              </div>
              <div>
                <label htmlFor="pl-amt" className="text-label text-ink">
                  Amount
                </label>
                <MoneyInput live id="pl-amt" className="mt-1.5" value={amount} onCommit={setAmount} placeholder="0" />
              </div>
              <div>
                <label htmlFor="pl-date" className="text-label text-ink">
                  Date
                </label>
                <Input id="pl-date" type="date" min={today} className="mt-1.5" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              {formError && (
                <p role="alert" className="text-label text-danger md:col-span-2">
                  {formError}
                </p>
              )}
              <div className="flex justify-end gap-2 md:col-span-2">
                <Button variant="tertiary" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Add to forecast
                </Button>
              </div>
            </form>
          </Card>
        )}

        {planning.planned.length === 0 && !adding ? (
          <Card className="px-6 py-8 text-center">
            <p className="text-body text-ink-tertiary">Nothing planned. Add a bill that isn't repeating yet, or money you're expecting.</p>
          </Card>
        ) : (
          planning.planned.length > 0 && (
            <Card>
              <ul className="divide-y divide-line">
                {planning.planned.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium text-ink">{p.name}</p>
                      <p className="text-label font-normal text-ink-tertiary">
                        {fullDate(p.date)}
                        {p.date < today ? " · already past, not in the forecast" : p.date > addDays(today, days) ? ` · after the ${days} days shown` : ""}
                      </p>
                    </div>
                    <span className={cn("tabular-nums text-body font-medium", p.direction === "in" ? "text-success" : "text-ink")}>
                      {formatMoney(p.direction === "in" ? p.amountCents : -p.amountCents, { signed: true, cents: true })}
                    </span>
                    <Button variant="tertiary" size="sm" aria-label={`Remove ${p.name}`} onClick={() => void planning.deletePlanned(p.id)}>
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )
        )}
      </section>
    </div>
  );
}
