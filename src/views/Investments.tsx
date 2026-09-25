import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Tabs, panelId, tabId } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { AskLink } from "@/components/finance/AskLink";
import { BasisTag, SampleNotice } from "@/components/finance/parts";
import { MoneyInput, ProgressBar, Segmented, Stat } from "@/components/finance/inputs";
import { LineChart } from "@/components/finance/LineChart";
import { gate } from "@/components/finance/gate";
import type { Finance } from "@/lib/finance/useFinance";
import type { Plans } from "@/lib/finance/usePlans";
import type { Planning } from "@/lib/finance/usePlanning";
import {
  allocation,
  concentration,
  contributionSummary,
  holdingRows,
  investmentAccounts,
  performance,
  portfolioSummary,
  positionDayChange,
} from "@/lib/finance/investments";
import { RANGES, thin } from "@/lib/finance/networth";
import { MAX_YEARS, monthsToTarget, projectRange } from "@/lib/finance/longterm";
import { formatMoney, monthKey, monthLabel, parseISODate, parseRateBps, rateInputValue } from "@/lib/finance/money";
import { ACCOUNT_KINDS, ASSET_CLASSES, GOAL_KINDS, type LongTermAssumptions } from "@/lib/finance/types";
import { cn } from "@/lib/utils";

type TabKey = "overview" | "holdings" | "allocation" | "performance" | "accounts" | "plan";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "holdings", label: "Holdings" },
  { key: "allocation", label: "Allocation" },
  { key: "performance", label: "Performance" },
  { key: "accounts", label: "Accounts" },
  { key: "plan", label: "Long-term plan" },
];

const fullDate = (iso: string) =>
  parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const monthYear = (iso: string) => `${monthLabel(monthKey(iso), "short")} ${iso.slice(0, 4)}`;
const pct = (x: number, digits = 1) => `${x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(digits)}%`;
const signedPct = (x: number, digits = 1) => `${x < 0 ? "−" : "+"}${Math.abs(x * 100).toFixed(digits)}%`;
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

/** "Up $1,203 (2.0%)" — neutral, no cheering and no alarm. */
function moved(cents: number, ratio: number | null, digits = 1): string {
  if (cents === 0) return "No change";
  return `${cents > 0 ? "Up" : "Down"} ${formatMoney(Math.abs(cents))}${ratio === null ? "" : ` (${pct(Math.abs(ratio), digits)})`}`;
}

/** How long, in words, for a month count. */
function span(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y > 0) parts.push(`${y} ${y === 1 ? "year" : "years"}`);
  if (m > 0 || y === 0) parts.push(`${m} ${m === 1 ? "month" : "months"}`);
  return parts.join(" and ");
}

const SLICE_OPACITY = [1, 0.7, 0.5, 0.34, 0.22, 0.14];

function AllocationBar({ slices }: { slices: { label: string; fraction: number }[] }) {
  return (
    <div aria-hidden="true" className="flex h-3 w-full overflow-hidden rounded-full bg-surface-secondary">
      {slices.map((s, i) => (
        <span key={s.label} title={`${s.label}: ${pct(s.fraction)}`} className="h-full bg-accent" style={{ width: `${s.fraction * 100}%`, opacity: SLICE_OPACITY[Math.min(i, SLICE_OPACITY.length - 1)] }} />
      ))}
    </div>
  );
}

function Legend({ slices }: { slices: { label: string; fraction: number; cents: number }[] }) {
  return (
    <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
      {slices.map((s, i) => (
        <li key={s.label} className="flex items-center gap-2 text-body">
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" style={{ opacity: SLICE_OPACITY[Math.min(i, SLICE_OPACITY.length - 1)] }} />
          <span className="min-w-0 flex-1 truncate text-ink">{s.label}</span>
          <span className="tabular-nums text-ink-secondary">{pct(s.fraction)}</span>
          <span className="w-20 text-right tabular-nums text-ink">{formatMoney(s.cents)}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------

function PlanTab({ finance, plans, planning, valueCents, recentMonthlyCents }: { finance: Finance; plans: Plans; planning: Planning; valueCents: number; recentMonthlyCents: number }) {
  const saved = planning.longTerm;
  const [draft, setDraft] = useState<LongTermAssumptions>(saved);
  const [rateText, setRateText] = useState(rateInputValue(saved.returnBps));
  const [yearsText, setYearsText] = useState(String(saved.years));
  const [inflText, setInflText] = useState(rateInputValue(saved.inflationBps));
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const monthly = draft.monthlyCents ?? recentMonthlyCents;
  const range = useMemo(() => projectRange(valueCents, monthly, draft), [valueCents, monthly, draft]);
  const N = draft.years;
  const labels = range.mid.years.map((y) => (y.year === 0 ? "Today" : `Year ${y.year}`));
  const ticks = [0, 1 / 3, 2 / 3, 1].map((t) => {
    const index = Math.round(t * N);
    return { index, text: index === 0 ? "Today" : `Year ${index}` };
  });
  const target = draft.targetCents;
  const reach = target
    ? {
        low: monthsToTarget(valueCents, monthly, range.low.returnBps, target),
        mid: monthsToTarget(valueCents, monthly, range.mid.returnBps, target),
        high: monthsToTarget(valueCents, monthly, range.high.returnBps, target),
      }
    : null;
  const when = (m: number | null) => (m === null ? `not within ${MAX_YEARS} years` : m === 0 ? "already there" : span(m));
  const milestones = [5, 10, 20, 30, 40, 50, 60].filter((y) => y < N).concat(N);
  const goalOptions = plans.goals.filter((g) => g.kind === "retirement" || g.kind === "investment" || g.kind === "custom");

  function edit(patch: Partial<LongTermAssumptions>) {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  }

  function save() {
    void planning.saveLongTerm(draft);
  }

  return (
    <div>
      <div role="note" className="mb-4 flex items-start gap-3 rounded-card border border-line bg-surface-secondary px-4 py-3 text-body text-ink-secondary">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" strokeWidth={1.75} aria-hidden="true" />
        <p>
          <span className="font-medium text-ink">A projection, not a prediction.</span> It uses the growth rate and amounts you enter. Markets
          don't grow steadily and past results don't predict future ones, so it shows a range rather than a single line.
        </p>
      </div>

      <Card as="section" aria-labelledby="lt-in" className="p-6 max-md:p-5">
        <h2 id="lt-in" className="text-heading text-ink">
          What to assume
        </h2>
        <p className="mt-1 text-body text-ink-tertiary">
          Starting from {formatMoney(valueCents)}, the value of your investment accounts today.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="lt-monthly" className="text-label text-ink">
              Added each month
            </label>
            <MoneyInput live id="lt-monthly" className="mt-1.5" value={draft.monthlyCents} onCommit={(c) => edit({ monthlyCents: c })} placeholder={formatMoney(recentMonthlyCents).replace("$", "")} />
            <p className="mt-1 text-meta text-ink-tertiary">
              {draft.monthlyCents === null ? `Using your recent pace: ${formatMoney(recentMonthlyCents)} a month over the last year.` : "Leave it empty to use your recent pace."}
            </p>
          </div>
          <div>
            <label htmlFor="lt-rate" className="text-label text-ink">
              Yearly growth you assume
            </label>
            <div className="relative mt-1.5">
              <Input
                id="lt-rate"
                inputMode="decimal"
                autoComplete="off"
                className="pr-7 text-right tabular-nums"
                value={rateText}
                onChange={(e) => {
                  setRateText(e.target.value);
                  const bps = parseRateBps(e.target.value);
                  if (bps !== null && bps <= 2_000) edit({ returnBps: bps });
                  else setError("Enter a yearly growth from 0 to 20, like 5 or 6.5.");
                }}
              />
              <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-body text-ink-tertiary">%</span>
            </div>
            <p className="mt-1 text-meta text-ink-tertiary">Your assumption, not a forecast. The range shows 2 points either side.</p>
          </div>
          <div>
            <label htmlFor="lt-years" className="text-label text-ink">
              For how many years
            </label>
            <Input
              id="lt-years"
              inputMode="numeric"
              autoComplete="off"
              className="mt-1.5 text-right tabular-nums"
              value={yearsText}
              onChange={(e) => {
                setYearsText(e.target.value);
                const y = Number(e.target.value);
                if (Number.isInteger(y) && y >= 1 && y <= MAX_YEARS) edit({ years: y });
                else setError(`Enter a whole number of years from 1 to ${MAX_YEARS}.`);
              }}
            />
          </div>
          <div>
            <label htmlFor="lt-target" className="text-label text-ink">
              An amount to reach <span className="font-normal text-ink-tertiary">(optional)</span>
            </label>
            <MoneyInput live id="lt-target" className="mt-1.5" value={draft.targetCents} onCommit={(c) => edit({ targetCents: c })} placeholder="1,000,000" />
            {goalOptions.length > 0 && (
              <Select
                aria-label="Fill the amount from a goal"
                className="mt-2"
                value=""
                onChange={(e) => {
                  const g = goalOptions.find((x) => x.id === e.target.value);
                  if (g) edit({ targetCents: g.targetCents });
                }}
              >
                <option value="">Use a goal's target…</option>
                {goalOptions.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name || GOAL_KINDS[g.kind]}, {formatMoney(g.targetCents)}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div>
            <label htmlFor="lt-infl" className="text-label text-ink">
              Yearly inflation <span className="font-normal text-ink-tertiary">(optional)</span>
            </label>
            <div className="relative mt-1.5">
              <Input
                id="lt-infl"
                inputMode="decimal"
                autoComplete="off"
                className="pr-7 text-right tabular-nums"
                value={inflText}
                placeholder="0"
                onChange={(e) => {
                  setInflText(e.target.value);
                  const bps = e.target.value.trim() === "" ? 0 : parseRateBps(e.target.value);
                  if (bps !== null && bps <= 1_500) edit({ inflationBps: bps });
                  else setError("Enter inflation from 0 to 15.");
                }}
              />
              <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-body text-ink-tertiary">%</span>
            </div>
            <p className="mt-1 text-meta text-ink-tertiary">At 0 every figure is in future dollars. Above 0 they're also shown in today's money.</p>
          </div>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-label text-danger">
            {error}
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-3">
          <span className="text-meta text-ink-tertiary">{dirty ? "Not saved yet." : "Saved."}</span>
          <Button variant="primary" onClick={save} disabled={!dirty}>
            Save assumptions
          </Button>
        </div>
      </Card>

      <Card as="section" aria-labelledby="lt-out" className="mt-4 p-6 max-md:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="lt-out" className="text-heading text-ink">
            Where it could go over {N} {N === 1 ? "year" : "years"}
          </h2>
          <BasisTag basis="projection" />
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Stat label={`At ${rateInputValue(range.low.returnBps)}% a year`} value={formatMoney(range.low.years[N].nominalCents)} />
          <Stat label={`At ${rateInputValue(range.mid.returnBps)}% a year, the rate you assumed`} value={formatMoney(range.mid.years[N].nominalCents)} />
          <Stat label={`At ${rateInputValue(range.high.returnBps)}% a year`} value={formatMoney(range.high.years[N].nominalCents)} />
        </dl>
        <p className="mt-2 text-label font-normal text-ink-tertiary">
          Of that, {formatMoney(range.mid.years[N].contributedCents)} is what you'd have put in ({formatMoney(valueCents)} to start plus {formatMoney(monthly)} a month).
          {draft.inflationBps > 0 && ` In today's money at ${rateInputValue(draft.inflationBps)}% inflation, the assumed case is about ${formatMoney(range.mid.years[N].realCents)}.`}
        </p>

        <div className="mt-5">
          <LineChart
            labels={labels}
            series={[
              { name: `${rateInputValue(range.high.returnBps)}% a year`, values: range.high.years.map((y) => y.nominalCents), tone: "muted" },
              { name: `${rateInputValue(range.mid.returnBps)}% a year`, values: range.mid.years.map((y) => y.nominalCents) },
              { name: `${rateInputValue(range.low.returnBps)}% a year`, values: range.low.years.map((y) => y.nominalCents), tone: "muted" },
              { name: "What you put in", values: range.mid.years.map((y) => y.contributedCents), tone: "muted", dashed: true },
            ]}
            xLabels={ticks}
            caption={`Projected value of your investments over ${N} years at three growth rates, and what you would have put in`}
          />
        </div>

        {reach && target && (
          <p className="mt-4 rounded-control bg-surface-secondary px-3 py-2 text-body text-ink-secondary">
            To reach {formatMoney(target)}: <span className="font-medium text-ink">{when(reach.mid)}</span> at {rateInputValue(range.mid.returnBps)}% a year
            (from {when(reach.high)} at {rateInputValue(range.high.returnBps)}% to {when(reach.low)} at {rateInputValue(range.low.returnBps)}%). In future dollars.
          </p>
        )}

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[520px] text-body">
            <caption className="sr-only">Projected value at milestone years</caption>
            <thead>
              <tr className="text-left text-label text-ink-tertiary">
                <th scope="col" className="py-2 pr-3 font-medium">After</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{rateInputValue(range.low.returnBps)}%</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{rateInputValue(range.mid.returnBps)}%</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{rateInputValue(range.high.returnBps)}%</th>
                <th scope="col" className="py-2 pl-3 text-right font-medium">You put in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {milestones.map((y) => (
                <tr key={y}>
                  <th scope="row" className="py-2.5 pr-3 text-left font-normal text-ink">{y} {y === 1 ? "year" : "years"}</th>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">{formatMoney(range.low.years[y].nominalCents)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{formatMoney(range.mid.years[y].nominalCents)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">{formatMoney(range.high.years[y].nominalCents)}</td>
                  <td className="py-2.5 pl-3 text-right tabular-nums text-ink-tertiary">{formatMoney(range.mid.years[y].contributedCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-meta text-ink-tertiary">
          Growth compounds monthly and each month's deposit is added at the month's end. The amount added stays the same; fees and taxes aren't
          included.
        </p>
      </Card>
      {finance.origin === "sample" && (
        <p className="mt-3 px-1 text-label font-normal text-ink-tertiary">The starting value and recent pace here come from sample data.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export function Investments({ finance, plans, planning }: { finance: Finance; plans: Plans; planning: Planning }) {
  const { snapshot, today } = finance;
  const [tab, setTab] = useState<TabKey>("overview");
  const [rangeKey, setRangeKey] = useState<"30d" | "90d" | "1y" | "5y" | "all">("1y");
  const [accountFilter, setAccountFilter] = useState("all");

  const data = useMemo(() => {
    if (!snapshot) return null;
    const accounts = investmentAccounts(snapshot.accounts);
    const summary = portfolioSummary(snapshot.accounts, snapshot.positions);
    const rows = holdingRows(snapshot.accounts, snapshot.positions);
    return {
      accounts,
      summary,
      rows,
      alloc: allocation(snapshot.accounts, snapshot.positions),
      conc: concentration(rows),
      contrib: contributionSummary(snapshot.accounts, snapshot.investmentActivity, today),
      all: performance(snapshot.accounts, snapshot.balanceHistory, snapshot.investmentActivity, today, RANGES[5]),
    };
  }, [snapshot, today]);

  const chosen = RANGES.find((r) => r.key === rangeKey) ?? RANGES[3];
  const perf = useMemo(
    () => (snapshot ? performance(snapshot.accounts, snapshot.balanceHistory, snapshot.investmentActivity, today, chosen) : null),
    [snapshot, today, chosen],
  );

  const blocked = gate(finance, plans, planning);
  if (blocked) return blocked;
  if (!snapshot || !data) return null;

  const { accounts, summary, rows, alloc, conc, contrib, all } = data;
  const institutions = new Map(snapshot.institutions.map((i) => [i.id, i.name]));
  const header = (
    <>
      <PageHeader
        title="Investments"
        description="What you hold, how it's split, and how it has moved. ZeraphDesk doesn't trade; this is for understanding."
        actions={<AskLink label="Ask about this portfolio" question="How are my investments doing?" />}
      />
      {finance.origin === "sample" && <SampleNotice />}
    </>
  );

  if (accounts.length === 0) {
    return (
      <div>
        {header}
        <Card className="px-6 py-12 text-center">
          <p className="text-heading text-ink">No investment accounts</p>
          <p className="mx-auto mt-1 max-w-[52ch] text-body text-ink-tertiary">Brokerage and retirement accounts show up here once they're among your accounts.</p>
        </Card>
      </div>
    );
  }

  const daily = summary.dailyChangeCents;
  const filteredRows = accountFilter === "all" ? rows : rows.filter((r) => r.account.id === accountFilter);

  const allSlices = alloc.map((s) => ({ label: s.key === "unclassified" ? "Not broken down" : ASSET_CLASSES[s.key], fraction: s.fraction, cents: s.cents }));
  const warnings: string[] = [];
  if (summary.withoutHoldings.length > 0) warnings.push(`No holdings are listed for ${summary.withoutHoldings.map((a) => a.name).join(", ")}, so ${summary.withoutHoldings.length === 1 ? "its value isn't" : "their values aren't"} split up.`);
  if (summary.mismatched.length > 0) warnings.push(`The holdings listed for ${summary.mismatched.map((a) => a.name).join(", ")} don't add up to the account's balance, so the split may be off.`);

  const chartOf = (p: NonNullable<typeof perf>) => {
    const shown = thin(p.points, 240);
    const long = p.points.length > 400;
    const ticks = [0, 1 / 3, 2 / 3, 1].map((t) => {
      const index = Math.round(t * (shown.length - 1));
      const d = parseISODate(shown[index].date);
      return { index, text: long ? d.toLocaleDateString("en-US", { month: "short", year: "numeric" }) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) };
    });
    return (
      <LineChart
        labels={shown.map((x) => fullDate(x.date))}
        series={[
          { name: "Value", values: shown.map((x) => x.valueCents) },
          { name: "What you put in", values: shown.map((x) => x.putInCents), tone: "muted", dashed: true },
        ]}
        xLabels={ticks}
        caption={`Value of your investments and the money you put in, from ${fullDate(p.from)} to ${fullDate(today)}`}
      />
    );
  };

  return (
    <div>
      {header}
      <Tabs base="inv" label="Investment sections" tabs={TABS} value={tab} onChange={setTab} />

      {tab === "overview" && (
        <div role="tabpanel" id={panelId("inv", "overview")} aria-labelledby={tabId("inv", "overview")}>
          <Card as="section" aria-labelledby="inv-val" className="p-6 max-md:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 id="inv-val" className="text-label text-ink-tertiary">
                Portfolio value
              </h2>
              <BasisTag basis="fact" />
            </div>
            <p className="mt-2 text-display tabular-nums text-ink max-md:text-title">{formatMoney(summary.valueCents)}</p>
            <p className="mt-2 text-body text-ink-secondary">
              {daily === null ? "Today's change isn't available: no holdings with prices are listed." : `Today: ${moved(daily, summary.dailyPct, 2)} (from prices at the last close)`}
            </p>
            {all && (
              <p className="mt-1 text-body text-ink-secondary">
                Since {monthYear(all.from)}: {all.returnPct === null ? "return can't be worked out" : `${moved(all.growthCents, all.returnPct)} from growth`}
                {all.annualizedPct !== null && <span className="text-ink-tertiary"> · about {pct(all.annualizedPct)} a year</span>}
              </p>
            )}

            <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5 md:grid-cols-4">
              <Stat label="Put in, all time" value={formatMoney(contrib.totalCents)} hint={contrib.since ? `since ${monthYear(contrib.since)}` : undefined} />
              <Stat label="Put in, last 12 months" value={formatMoney(contrib.last12Cents)} hint={`about ${formatMoney(contrib.monthlyCents)} a month`} />
              <Stat label="Growth, all time" value={all ? formatMoney(all.growthCents, { signed: true }) : "n/a"} hint="after money put in" />
              <Stat label="Dividends, last 12 months" value={formatMoney(contrib.dividends12Cents)} hint="counted as growth" />
            </dl>
            {warnings.map((w) => (
              <p key={w} className="mt-3 text-label font-normal text-ink-tertiary">
                {w}
              </p>
            ))}
          </Card>

          {all && (
            <Card as="section" aria-labelledby="inv-hist" className="mt-4 p-6 max-md:p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 id="inv-hist" className="text-heading text-ink">
                  Value, and what you put in
                </h2>
                <BasisTag basis="calculation" />
              </div>
              <div className="mt-4">{chartOf(all)}</div>
              <p className="mt-2 text-meta text-ink-tertiary">The gap between the lines is growth. Return uses the Modified Dietz method, which counts when money went in.</p>
            </Card>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card as="section" aria-labelledby="inv-top" className="p-6 max-md:p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 id="inv-top" className="text-heading text-ink">
                  Largest holdings
                </h2>
                <Button variant="tertiary" size="sm" onClick={() => setTab("holdings")}>
                  See all
                </Button>
              </div>
              {rows.length === 0 ? (
                <p className="mt-3 text-body text-ink-tertiary">No holdings are listed for these accounts.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line">
                  {rows.filter((r) => r.position.type !== "cash").slice(0, 5).map((r) => (
                    <li key={r.position.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body text-ink">{r.position.name}</p>
                        <p className="text-meta text-ink-tertiary">{r.position.symbol} · {pct(r.share)} of your investments</p>
                      </div>
                      <span className="tabular-nums text-body text-ink">{formatMoney(r.valueCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card as="section" aria-labelledby="inv-split" className="p-6 max-md:p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 id="inv-split" className="text-heading text-ink">
                  How it's split
                </h2>
                <Button variant="tertiary" size="sm" onClick={() => setTab("allocation")}>
                  Details
                </Button>
              </div>
              <div className="mt-4">
                <AllocationBar slices={allSlices} />
                <Legend slices={allSlices} />
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "holdings" && (
        <div role="tabpanel" id={panelId("inv", "holdings")} aria-labelledby={tabId("inv", "holdings")}>
          <Card as="section" aria-labelledby="inv-hold" className="p-6 max-md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="inv-hold" className="text-heading text-ink">
                {filteredRows.length} {filteredRows.length === 1 ? "holding" : "holdings"}
              </h2>
              <Select aria-label="Show holdings from" className="w-56" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
                <option value="all">All accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
            {filteredRows.length === 0 ? (
              <p className="mt-4 text-body text-ink-tertiary">No holdings are listed here.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[720px] text-body">
                  <caption className="sr-only">Holdings, largest first</caption>
                  <thead>
                    <tr className="text-left text-label text-ink-tertiary">
                      <th scope="col" className="py-2 pr-3 font-medium">Holding</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Shares</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Price</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Value</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Today</th>
                      <th scope="col" className="py-2 pl-3 text-right font-medium">Gain or loss</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {filteredRows.map((r) => (
                      <tr key={r.position.id}>
                        <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                          <span className="block text-ink">{r.position.name}</span>
                          <span className="block text-meta text-ink-tertiary">
                            {r.position.symbol} · {ASSET_CLASSES[r.position.assetClass]} · {r.account.name}
                          </span>
                        </th>
                        <td className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">{r.position.type === "cash" ? "" : qty(r.position.quantity)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">{r.position.type === "cash" ? "" : formatMoney(r.position.priceCents, { cents: true })}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-ink">{formatMoney(r.valueCents)}</td>
                        <td className={cn("px-3 py-2.5 text-right tabular-nums", r.dayChangeCents > 0 ? "text-success" : "text-ink-secondary")}>
                          {r.position.type === "cash" ? "" : formatMoney(positionDayChange(r.position), { signed: true, cents: true })}
                        </td>
                        <td className={cn("py-2.5 pl-3 text-right tabular-nums", (r.gainCents ?? 0) > 0 ? "text-success" : "text-ink-secondary")}>
                          {r.gainCents === null ? <span className="text-ink-tertiary">Not reported</span> : formatMoney(r.gainCents, { signed: true })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-meta text-ink-tertiary">
              Prices and today's change are as the accounts report them. Gain or loss is value minus what was paid, shown only where the account says what was paid.
            </p>
          </Card>
        </div>
      )}

      {tab === "allocation" && (
        <div role="tabpanel" id={panelId("inv", "allocation")} aria-labelledby={tabId("inv", "allocation")}>
          <Card as="section" aria-labelledby="inv-alloc" className="p-6 max-md:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 id="inv-alloc" className="text-heading text-ink">
                By kind of asset
              </h2>
              <BasisTag basis="calculation" />
            </div>
            <div className="mt-4">
              <AllocationBar slices={allSlices} />
              <Legend slices={allSlices} />
            </div>
            {warnings.map((w) => (
              <p key={w} className="mt-3 text-label font-normal text-ink-tertiary">
                {w}
              </p>
            ))}
          </Card>

          <Card as="section" aria-labelledby="inv-byacct" className="mt-4 p-6 max-md:p-5">
            <h2 id="inv-byacct" className="text-heading text-ink">
              By account
            </h2>
            <ul className="mt-3 space-y-4">
              {accounts.map((a) => {
                const share = summary.valueCents > 0 ? a.balanceCents / summary.valueCents : 0;
                return (
                  <li key={a.id}>
                    <div className="flex items-baseline justify-between gap-3 text-body">
                      <span className="text-ink">
                        {a.name} <span className="text-label text-ink-tertiary">· {ACCOUNT_KINDS[a.kind].label}</span>
                      </span>
                      <span className="tabular-nums text-ink">
                        {formatMoney(a.balanceCents)} <span className="text-ink-tertiary">· {pct(share)}</span>
                      </span>
                    </div>
                    <ProgressBar fraction={share} className="mt-1.5" />
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card as="section" aria-labelledby="inv-conc" className="mt-4 p-6 max-md:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 id="inv-conc" className="text-heading text-ink">
                Concentration
              </h2>
              <BasisTag basis="calculation" />
            </div>
            {conc.largest ? (
              <dl className="mt-3 grid gap-4 md:grid-cols-2">
                <Stat label="Largest single holding" value={pct(conc.largest.share)} hint={`${conc.largest.position.name}${conc.largest.position.type === "fund" ? ", a fund that holds many things" : ""}`} />
                <Stat label="Largest single company" value={conc.largestStock ? pct(conc.largestStock.share) : "None held directly"} hint={conc.largestStock?.position.name} />
              </dl>
            ) : (
              <p className="mt-3 text-body text-ink-tertiary">No holdings are listed to measure.</p>
            )}
            <p className="mt-3 text-meta text-ink-tertiary">
              This describes how your money is split. It isn't a judgement on whether the split suits you, and it isn't advice.
            </p>
          </Card>
        </div>
      )}

      {tab === "performance" && (
        <div role="tabpanel" id={panelId("inv", "performance")} aria-labelledby={tabId("inv", "performance")}>
          <Card as="section" aria-labelledby="inv-perf" className="p-6 max-md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 id="inv-perf" className="text-heading text-ink">
                  How it has moved
                </h2>
                <BasisTag basis="calculation" />
              </div>
              <Segmented
                label="Time range"
                value={rangeKey}
                onChange={setRangeKey}
                options={RANGES.filter((r) => r.key !== "today").map((r) => ({ value: r.key as typeof rangeKey, label: r.label }))}
              />
            </div>

            {!perf ? (
              <p className="mt-4 text-body text-ink-tertiary">This data doesn't include past balances, so performance can't be worked out.</p>
            ) : (
              <>
                {perf.clipped && (
                  <p role="note" className="mt-3 text-label font-normal text-ink-tertiary">
                    ZeraphDesk has balances back to {fullDate(perf.dataStart as string)}, so that's where this starts.
                  </p>
                )}
                <dl className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-5">
                  <Stat label={`Value on ${monthYear(perf.from)}`} value={formatMoney(perf.startCents)} />
                  <Stat label="Money put in" value={formatMoney(perf.netContributionsCents)} hint="after withdrawals" />
                  <Stat label="Growth" value={formatMoney(perf.growthCents, { signed: true })} hint={`dividends ${formatMoney(perf.dividendsCents)} included`} />
                  <Stat label="Return" value={perf.returnPct === null ? "n/a" : signedPct(perf.returnPct)} hint="an estimate" />
                  <Stat label="Per year" value={perf.annualizedPct === null ? "n/a" : signedPct(perf.annualizedPct)} hint={perf.annualizedPct === null ? "needs a year or more" : "an estimate"} />
                </dl>
                <div className="mt-5">{chartOf(perf)}</div>
                {perf.notes.map((n) => (
                  <p key={n} className="mt-2 text-label font-normal text-ink-tertiary">
                    {n}
                  </p>
                ))}
                <p className="mt-3 text-meta text-ink-tertiary">
                  Return is growth divided by the starting value plus each deposit, weighted by how long it was invested (the Modified Dietz method). It
                  estimates what a broker would report from daily values, and doesn't predict anything.
                </p>
              </>
            )}
          </Card>
        </div>
      )}

      {tab === "accounts" && (
        <div role="tabpanel" id={panelId("inv", "accounts")} aria-labelledby={tabId("inv", "accounts")} className="space-y-4">
          {accounts.map((a) => {
            const held = snapshot.positions.filter((p) => p.accountId === a.id);
            const change = held.reduce((s, p) => s + positionDayChange(p), 0);
            const per = contrib.perAccount.find((x) => x.accountId === a.id);
            const p = performance([a], snapshot.balanceHistory, snapshot.investmentActivity, today, RANGES[5]);
            return (
              <Card key={a.id} as="article" aria-labelledby={`inv-a-${a.id}`} className="p-6 max-md:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 id={`inv-a-${a.id}`} className="truncate text-heading text-ink">
                      {a.name}
                    </h2>
                    <p className="text-label font-normal text-ink-tertiary">
                      {institutions.get(a.institutionId) ?? "Unknown institution"} · {ACCOUNT_KINDS[a.kind].label}
                      {a.mask ? ` ••${a.mask}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-heading tabular-nums text-ink">{formatMoney(a.balanceCents)}</p>
                    <p className="text-meta text-ink-tertiary">{held.length ? `${moved(change, null)} today` : "no holdings listed"}</p>
                  </div>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 md:grid-cols-4">
                  <Stat label="Put in, last 12 months" value={formatMoney(per?.last12Cents ?? 0)} />
                  <Stat label="Put in, all time" value={formatMoney(per?.totalCents ?? 0)} />
                  <Stat label="Growth, all time" value={p ? formatMoney(p.growthCents, { signed: true }) : "n/a"} hint={p ? `since ${monthYear(p.from)}` : undefined} />
                  <Stat label="Return, all time" value={p?.returnPct == null ? "n/a" : signedPct(p.returnPct)} hint={p?.annualizedPct != null ? `about ${pct(p.annualizedPct)} a year` : "an estimate"} />
                </dl>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "plan" && (
        <div role="tabpanel" id={panelId("inv", "plan")} aria-labelledby={tabId("inv", "plan")}>
          <PlanTab finance={finance} plans={plans} planning={planning} valueCents={summary.valueCents} recentMonthlyCents={Math.max(0, contrib.monthlyCents)} />
        </div>
      )}
    </div>
  );
}
