import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { AskLink } from "@/components/finance/AskLink";
import { BasisTag, SampleNotice } from "@/components/finance/parts";
import { MoneyInput, ProgressBar, Segmented } from "@/components/finance/inputs";
import { LineChart } from "@/components/finance/LineChart";
import { gate } from "@/components/finance/gate";
import type { Finance } from "@/lib/finance/useFinance";
import type { Planning } from "@/lib/finance/usePlanning";
import { netWorthHistory, netWorthNow, RANGES, SLICE_LABELS, thin, holdingLatest, type Range } from "@/lib/finance/networth";
import { formatMoney, parseISODate } from "@/lib/finance/money";
import { HOLDING_KINDS, type Holding, type HoldingKind } from "@/lib/finance/types";
import { cn } from "@/lib/utils";

const fullDate = (iso: string) =>
  parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const monthDay = (iso: string) => parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const monthYear = (iso: string) => parseISODate(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });

const RANGE_WORDS: Record<Range["key"], string> = {
  today: "today",
  "30d": "the last 30 days",
  "90d": "the last 90 days",
  "1y": "the last year",
  "5y": "the last 5 years",
  all: "all the history there is",
};

/** "Up $4,520 (6.3%)" — neutral, no cheering and no alarm. */
function changeText(startCents: number, endCents: number): string {
  const d = endCents - startCents;
  if (d === 0) return "No change";
  const pct = startCents > 0 ? ` (${Math.abs(Math.round((d / startCents) * 1000) / 10)}%)` : "";
  return `${d > 0 ? "Up" : "Down"} ${formatMoney(Math.abs(d))}${pct}`;
}

function HoldingForm({
  today,
  onSave,
  onCancel,
}: {
  today: string;
  onSave: (name: string, kind: HoldingKind, valueCents: number, date: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<HoldingKind>("real_estate");
  const [value, setValue] = useState<number | null>(null);
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      noValidate
      className="grid gap-3 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setError("Give it a name.");
        if (value === null || value < 0) return setError("Enter what it's worth or what's owed.");
        onSave(name.trim(), kind, value, date || today);
      }}
    >
      <SelectField label="What is it?" value={kind} onChange={(e) => setKind(e.target.value as HoldingKind)}>
        {(Object.keys(HOLDING_KINDS) as HoldingKind[]).map((k) => (
          <option key={k} value={k}>
            {HOLDING_KINDS[k].label}
          </option>
        ))}
      </SelectField>
      <div>
        <label htmlFor="hold-name" className="text-label text-ink">
          Name
        </label>
        <Input id="hold-name" className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="Home, Honda Civic, loan from Sam" />
      </div>
      <div>
        <label htmlFor="hold-value" className="text-label text-ink">
          {HOLDING_KINDS[kind].class === "asset" ? "Worth about" : "Amount owed"}
        </label>
        <MoneyInput live id="hold-value" className="mt-1.5" value={value} onCommit={setValue} placeholder="0" />
      </div>
      <div>
        <label htmlFor="hold-date" className="text-label text-ink">
          As of
        </label>
        <Input id="hold-date" type="date" max={today} className="mt-1.5" value={date} onChange={(e) => setDate(e.target.value)} />
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
          Add to net worth
        </Button>
      </div>
    </form>
  );
}

function HoldingRow({ holding, today, planning }: { holding: Holding; today: string; planning: Planning }) {
  const [mode, setMode] = useState<"view" | "value" | "edit" | "confirm">("view");
  const [value, setValue] = useState<number | null>(null);
  const [date, setDate] = useState(today);
  const [name, setName] = useState(holding.name);
  const [kind, setKind] = useState(holding.kind);
  const latest = holding.values[holding.values.length - 1];
  const info = HOLDING_KINDS[holding.kind];
  const idBase = `hold-${holding.id}`;

  if (mode === "value") {
    return (
      <li className="px-5 py-4">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value === null) return;
            void planning.setHoldingValue(holding.id, date || today, value);
            setMode("view");
          }}
        >
          <div className="w-40">
            <label htmlFor={`${idBase}-v`} className="text-label text-ink">
              New value for {holding.name}
            </label>
            <MoneyInput live id={`${idBase}-v`} className="mt-1.5" value={value} onCommit={setValue} placeholder="0" />
          </div>
          <div>
            <label htmlFor={`${idBase}-d`} className="block text-label text-ink">
              As of
            </label>
            <Input id={`${idBase}-d`} type="date" max={today} className="mt-1.5 w-40" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <Button type="submit" variant="primary" disabled={value === null}>
            Save value
          </Button>
          <Button variant="tertiary" onClick={() => setMode("view")}>
            Cancel
          </Button>
        </form>
      </li>
    );
  }

  if (mode === "edit") {
    return (
      <li className="px-5 py-4">
        <form
          className="grid gap-3 md:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            void planning.renameHolding(holding.id, name.trim(), kind);
            setMode("view");
          }}
        >
          <div>
            <label htmlFor={`${idBase}-n`} className="text-label text-ink">
              Name
            </label>
            <Input id={`${idBase}-n`} className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <SelectField label="What is it?" value={kind} onChange={(e) => setKind(e.target.value as HoldingKind)}>
            {(Object.keys(HOLDING_KINDS) as HoldingKind[]).map((k) => (
              <option key={k} value={k}>
                {HOLDING_KINDS[k].label}
              </option>
            ))}
          </SelectField>
          <div className="flex items-end gap-2">
            <Button type="submit" variant="primary">
              Save
            </Button>
            <Button variant="tertiary" onClick={() => setMode("view")}>
              Cancel
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-ink">{holding.name}</p>
        <p className="text-label font-normal text-ink-tertiary">
          {info.label} · entered {latest ? `as of ${fullDate(latest.date)}` : "with no value"}
          {holding.values.length > 1 ? ` · ${holding.values.length} values on record` : ""}
        </p>
      </div>
      <p className="text-body font-medium tabular-nums text-ink">
        {latest ? formatMoney(latest.valueCents) : "No value"}
        {info.class === "liability" && <span className="text-label font-normal text-ink-tertiary"> owed</span>}
      </p>
      {mode === "confirm" ? (
        <div className="flex items-center gap-2">
          <span className="text-label text-ink-secondary">Remove it from net worth?</span>
          <Button variant="tertiary" size="sm" onClick={() => setMode("view")}>
            Keep it
          </Button>
          <Button variant="secondary" size="sm" className="text-danger" onClick={() => void planning.deleteHolding(holding.id)}>
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <Button variant="tertiary" size="sm" aria-label={`Update the value of ${holding.name}`} onClick={() => { setValue(null); setDate(today); setMode("value"); }}>
            Update value
          </Button>
          <Button variant="tertiary" size="sm" aria-label={`Edit ${holding.name}`} onClick={() => { setName(holding.name); setKind(holding.kind); setMode("edit"); }}>
            Edit
          </Button>
          <Button variant="tertiary" size="sm" aria-label={`Remove ${holding.name}`} onClick={() => setMode("confirm")}>
            Remove
          </Button>
        </div>
      )}
    </li>
  );
}

export function NetWorth({ finance, planning }: { finance: Finance; planning: Planning }) {
  const { snapshot, today } = finance;
  const [rangeKey, setRangeKey] = useState<Range["key"]>("90d");
  const [adding, setAdding] = useState(false);
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[2];

  const now = useMemo(() => (snapshot ? netWorthNow(snapshot.accounts, planning.holdings) : null), [snapshot, planning.holdings]);
  const history = useMemo(
    () => (snapshot ? netWorthHistory(snapshot.accounts, snapshot.balanceHistory, planning.holdings, today, range) : null),
    [snapshot, planning.holdings, today, range],
  );

  const blocked = gate(finance, planning);
  if (blocked) return blocked;
  if (!snapshot || !now || !history) return null;

  const isToday = range.key === "today";
  const shown = thin(history.points, 240);
  const startPoint = history.points[0];
  const long = range.days === null || range.days > 365;
  const labelOf = (iso: string) => fullDate(iso);
  const ticks = [0, 1 / 3, 2 / 3, 1].map((t) => {
    const index = Math.round(t * (shown.length - 1));
    return { index, text: long ? monthYear(shown[index].date) : monthDay(shown[index].date) };
  });

  const assets = history.slices.filter((s) => !s.owed);
  const owed = history.slices.filter((s) => s.owed);
  const assetTotal = assets.reduce((s, x) => s + x.endCents, 0);
  const owedTotal = owed.reduce((s, x) => s + x.endCents, 0);

  return (
    <div>
      <PageHeader
        title="Net Worth"
        description="What you own minus what you owe, today and over time."
        actions={<AskLink label="Ask about my net worth" question="How has my net worth changed?" />}
      />
      {finance.origin === "sample" && <SampleNotice />}

      <Card as="section" aria-labelledby="nw-now" className="p-6 max-md:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="nw-now" className="text-label text-ink-tertiary">
            Net worth today
          </h2>
          <BasisTag basis="calculation" />
        </div>
        <p className="mt-2 text-display tabular-nums text-ink max-md:text-title">{formatMoney(now.netWorthCents)}</p>
        <p className="mt-2 text-body text-ink-tertiary">
          {formatMoney(now.assetsCents)} in assets minus {formatMoney(now.liabilitiesCents)} owed
        </p>
        {!isToday && startPoint && (
          <p className="mt-1 text-body text-ink-secondary">
            {changeText(startPoint.netWorthCents, now.netWorthCents)} over {RANGE_WORDS[range.key]}
            <span className="text-ink-tertiary"> (from {formatMoney(startPoint.netWorthCents)} on {fullDate(history.from)})</span>
          </p>
        )}

        <div className="mt-5">
          <Segmented
            label="Time range"
            value={rangeKey}
            onChange={setRangeKey}
            options={RANGES.map((r) => ({ value: r.key, label: r.label }))}
          />
        </div>

        {history.clipped && (
          <p role="note" className="mt-3 text-label font-normal text-ink-tertiary">
            ZeraphDesk has balances back to {fullDate(history.dataStart as string)}, so that's where this chart starts.
          </p>
        )}

        {!isToday && (
          <div className="mt-5">
            <LineChart
              labels={shown.map((p) => labelOf(p.date))}
              series={[{ name: "Net worth", values: shown.map((p) => p.netWorthCents) }]}
              xLabels={ticks}
              zeroLine
              caption={`Net worth from ${fullDate(history.from)} to ${fullDate(today)}`}
            />
          </div>
        )}
      </Card>

      <Card as="section" aria-labelledby="nw-break" className="mt-4 p-6 max-md:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="nw-break" className="text-heading text-ink">
            {isToday ? "What it's made of" : `What changed over ${RANGE_WORDS[range.key]}`}
          </h2>
          <BasisTag basis="calculation" />
        </div>

        {isToday ? (
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            {[
              { title: "Assets", rows: assets, total: assetTotal, tone: "accent" as const },
              { title: "Owed", rows: owed, total: owedTotal, tone: "muted" as const },
            ].map((col) => (
              <div key={col.title}>
                <h3 className="flex items-baseline justify-between text-label text-ink-tertiary">
                  {col.title}
                  <span className="tabular-nums">{formatMoney(col.total)}</span>
                </h3>
                {col.rows.length === 0 ? (
                  <p className="mt-2 text-body text-ink-tertiary">Nothing here.</p>
                ) : (
                  <ul className="mt-2 space-y-3">
                    {col.rows.map((r) => (
                      <li key={r.slice}>
                        <div className="flex items-baseline justify-between gap-3 text-body">
                          <span className="text-ink">{SLICE_LABELS[r.slice]}</span>
                          <span className="tabular-nums text-ink">{formatMoney(r.endCents)}</span>
                        </div>
                        <ProgressBar fraction={col.total > 0 ? r.endCents / col.total : 0} tone={col.tone} className="mt-1.5" />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-body">
              <caption className="sr-only">Net worth by group, at the start of the range and today</caption>
              <thead>
                <tr className="text-left text-label text-ink-tertiary">
                  <th scope="col" className="py-2 pr-3 font-medium">Group</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{fullDate(history.from)}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Today</th>
                  <th scope="col" className="py-2 pl-3 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.slices.map((r) => {
                  // For debts, a bigger balance is a worse position, so the sign shown is the effect on net worth.
                  const effect = r.owed ? r.startCents - r.endCents : r.endCents - r.startCents;
                  return (
                    <tr key={r.slice}>
                      <th scope="row" className="py-2.5 pr-3 text-left font-normal text-ink">
                        {SLICE_LABELS[r.slice]}
                        {r.owed && <span className="text-label text-ink-tertiary"> owed</span>}
                      </th>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">{formatMoney(r.startCents)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">{formatMoney(r.endCents)}</td>
                      <td className={cn("py-2.5 pl-3 text-right tabular-nums", effect > 0 ? "text-success" : "text-ink-secondary")}>
                        {formatMoney(effect, { signed: true })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-meta text-ink-tertiary">
              Change is the effect on net worth: paying down a debt counts as a gain. This shows which balances moved, not why.
            </p>
          </div>
        )}

        {history.notes.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-line pt-3">
            {history.notes.map((n) => (
              <li key={n} className="text-label font-normal text-ink-tertiary">
                {n}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <section aria-labelledby="nw-hold" className="mt-8">
        <div className="mb-2 flex items-end justify-between gap-3 px-1">
          <div>
            <h2 id="nw-hold" className="text-heading text-ink">
              Other things you own or owe
            </h2>
            <p className="text-label font-normal text-ink-tertiary">
              A home, a car, money owed to family. Not connected to anything: the values are the ones you enter.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setAdding(true)} disabled={adding}>
            <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Add
          </Button>
        </div>

        {adding && (
          <Card as="section" aria-label="Add something to net worth" className="mb-3 p-6 max-md:p-5">
            <HoldingForm
              today={today}
              onCancel={() => setAdding(false)}
              onSave={(name, kind, value, date) => {
                void planning.addHolding(name, kind, value, date);
                setAdding(false);
              }}
            />
          </Card>
        )}

        {planning.holdings.length === 0 && !adding ? (
          <Card className="px-6 py-8 text-center">
            <p className="text-body text-ink-tertiary">
              Nothing added yet. Add a home or vehicle and it's counted in your net worth here and on the Overview.
            </p>
          </Card>
        ) : (
          planning.holdings.length > 0 && (
            <Card>
              <ul className="divide-y divide-line">
                {planning.holdings.map((h) => (
                  <HoldingRow key={h.id} holding={h} today={today} planning={planning} />
                ))}
              </ul>
            </Card>
          )
        )}
        {planning.holdings.some((h) => holdingLatest(h) === null) && (
          <p className="mt-2 px-1 text-label font-normal text-ink-tertiary">Items with no value aren't counted.</p>
        )}
      </section>
    </div>
  );
}
