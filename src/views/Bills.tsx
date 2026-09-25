import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { AskLink } from "@/components/finance/AskLink";
import { Amount, BasisTag, CategoryGlyph, SampleNotice } from "@/components/finance/parts";
import { Segmented, Stat } from "@/components/finance/inputs";
import { gate } from "@/components/finance/gate";
import type { Finance } from "@/lib/finance/useFinance";
import type { Plans } from "@/lib/finance/usePlans";
import { accountTotals } from "@/lib/finance/analysis";
import { upcoming } from "@/lib/finance/cashflow";
import { FREQUENCY_LABELS, billState, type Occurrence } from "@/lib/finance/recurring";
import { daysBetween, dayHeading, formatMoney, monthKey, parseISODate } from "@/lib/finance/money";
import type { Autopay, RecurringPayment } from "@/lib/finance/types";
import { cn } from "@/lib/utils";

const shortDate = (iso: string) =>
  parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function relative(iso: string, today: string): string {
  const d = daysBetween(today, iso);
  return d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
}

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "success" }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-meta font-medium",
        tone === "success" ? "bg-success-soft text-success" : "bg-surface-secondary text-ink-secondary",
      )}
    >
      {children}
    </span>
  );
}

function stateText(r: RecurringPayment, today: string): string {
  const s = billState(r, today);
  switch (s.kind) {
    case "due":
      return s.inDays === 0 ? "Due today" : `Due ${relative(s.date, today)} · ${shortDate(s.date)}`;
    case "not_seen":
      return `Expected ${shortDate(s.date)} · no matching payment yet`;
    case "stopped":
      return "No payment in a while. It may have stopped.";
    case "cancelled":
      return "Marked as cancelled";
  }
}

function TimelineRow({ o }: { o: Occurrence }) {
  const p = o.payment;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <CategoryGlyph categoryId={p.categoryId} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-body font-medium text-ink">{p.merchant}</span>
          {p.direction === "in" && <Chip>Income</Chip>}
          {p.direction === "out" && p.kind !== "expense" && <Chip>Transfer</Chip>}
          {p.isBill && <Chip>Bill</Chip>}
          {p.autopay === "on" && <Chip>Autopay</Chip>}
        </span>
        <span className="block text-label font-normal text-ink-tertiary">
          {FREQUENCY_LABELS[p.frequency]}
          {p.variable ? " · amount varies" : ""}
        </span>
      </span>
      <Amount
        cents={p.direction === "in" ? p.amountCents : -p.amountCents}
        showCents={!p.variable}
        className="shrink-0 text-body font-medium"
      />
    </li>
  );
}

export function Bills({ finance, plans }: { finance: Finance; plans: Plans }) {
  const [days, setDays] = useState<7 | 14 | 30>(14);
  const { today, snapshot, transactions, categoriesById } = finance;

  const timeline = useMemo(() => upcoming(plans.recurring, today, 30), [plans.recurring, today]);
  const windowTotals = useMemo(() => upcoming(plans.recurring, today, days), [plans.recurring, today, days]);

  const byDate = useMemo(() => {
    const groups: { date: string; rows: Occurrence[] }[] = [];
    for (const o of timeline.occurrences) {
      const last = groups[groups.length - 1];
      if (last && last.date === o.date) last.rows.push(o);
      else groups.push({ date: o.date, rows: [o] });
    }
    return groups;
  }, [timeline]);

  const bills = useMemo(() => {
    const rank = (r: RecurringPayment) => (r.status === "cancelled" ? 2 : r.possiblyStopped ? 1 : 0);
    return plans.recurring
      .filter((r) => r.isBill && r.direction === "out")
      .sort((a, b) => rank(a) - rank(b) || a.nextDate.localeCompare(b.nextDate));
  }, [plans.recurring]);

  const txById = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions]);

  const blocked = gate(finance, plans);
  if (blocked || !snapshot) return blocked;

  const cash = accountTotals(snapshot.accounts).cashCents;
  const out = windowTotals.spendingCents + windowTotals.transfersOutCents;

  return (
    <div>
      <PageHeader
        title="Bills"
        description="What's due, when, and whether it's been paid."
        actions={<AskLink label="Ask about bills" question="What bills are coming up?" />}
      />
      {finance.origin === "sample" && <SampleNotice />}

      <Card as="section" aria-labelledby="bl-ahead" className="p-6 max-md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="bl-ahead" className="text-heading text-ink">
            Coming up
          </h2>
          <div className="flex items-center gap-2">
            <BasisTag basis="projection" />
            <Segmented
              label="Look ahead"
              value={days}
              onChange={setDays}
              options={[
                { value: 7, label: "7 days" },
                { value: 14, label: "14 days" },
                { value: 30, label: "30 days" },
              ]}
            />
          </div>
        </div>
        <p className="mt-4 text-body text-ink-secondary">
          Payments expected over the next {days} days total <strong className="font-semibold text-ink">{formatMoney(out)}</strong>
          , against <strong className="font-semibold text-ink">{formatMoney(cash)}</strong> in cash today
          {windowTotals.incomeCents > 0 && (
            <>
              , with <strong className="font-semibold text-ink">{formatMoney(windowTotals.incomeCents)}</strong> of income
              expected
            </>
          )}
          .
        </p>
        <dl className="mt-4 grid grid-cols-3 gap-4 border-t border-line pt-4">
          <Stat label="Bills and subscriptions" value={formatMoney(windowTotals.spendingCents)} />
          <Stat label="Transfers to your accounts" value={formatMoney(windowTotals.transfersOutCents)} />
          <Stat label="Cash available today" value={formatMoney(cash)} hint="checking, savings and cash" />
        </dl>
        <p className="mt-4 text-meta text-ink-tertiary">
          Built only from payments that repeat. Everyday spending isn't included, and dates and amounts can differ from
          what's shown.
        </p>
      </Card>

      <section aria-labelledby="bl-timeline" className="mt-6">
        <h2 id="bl-timeline" className="mb-2 px-1 text-heading text-ink">
          Next 30 days
        </h2>
        {byDate.length === 0 ? (
          <Card className="px-6 py-10 text-center text-body text-ink-tertiary">Nothing expected in the next 30 days.</Card>
        ) : (
          <div className="space-y-4">
            {byDate.map((g) => (
              <section key={g.date} aria-label={dayHeading(g.date, today)}>
                <h3 className="mb-1.5 px-1 text-label text-ink-tertiary">
                  {dayHeading(g.date, today)}
                  <span className="font-normal"> · {relative(g.date, today)}</span>
                </h3>
                <Card className="overflow-hidden">
                  <ul className="divide-y divide-line">
                    {g.rows.map((o) => (
                      <TimelineRow key={o.payment.key + o.date} o={o} />
                    ))}
                  </ul>
                </Card>
              </section>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="bl-list" className="mt-8">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 px-1">
          <h2 id="bl-list" className="text-heading text-ink">
            Your bills
          </h2>
          <p className="text-label font-normal text-ink-tertiary">
            Paid status comes from matching transactions. Change what counts as a bill under Recurring.
          </p>
        </div>
        {bills.length === 0 ? (
          <Card className="px-6 py-10 text-center text-body text-ink-tertiary">No bills found yet.</Card>
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {bills.map((r) => {
                const paidThisMonth = r.lastDate !== null && monthKey(r.lastDate) === monthKey(today);
                const history = r.txIds.slice(0, 6).map((id) => txById.get(id)).filter((t) => t !== undefined);
                return (
                  <li key={r.key} className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <CategoryGlyph categoryId={r.categoryId} />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-body font-medium text-ink">{r.merchant}</span>
                          {paidThisMonth && <Chip tone="success">Paid {shortDate(r.lastDate as string)}</Chip>}
                        </p>
                        <p className="text-label font-normal text-ink-tertiary">
                          {categoriesById.get(r.categoryId)?.name ?? "Other"} · {FREQUENCY_LABELS[r.frequency]} ·{" "}
                          {stateText(r, today)}
                        </p>
                      </div>
                      <p className="text-body font-medium tabular-nums text-ink">
                        {r.variable ? "about " : ""}
                        {formatMoney(r.amountCents, { cents: !r.variable })}
                      </p>
                      <Select
                        aria-label={`Autopay for ${r.merchant}`}
                        className="w-40"
                        value={r.autopay}
                        onChange={(e) => void plans.markRecurring(r.key, { autopay: e.target.value as Autopay })}
                      >
                        <option value="unset">Autopay: not set</option>
                        <option value="on">Autopay: on</option>
                        <option value="off">Autopay: off</option>
                      </Select>
                    </div>
                    <details className="group mt-2 md:pl-12">
                      <summary className="w-fit cursor-pointer select-none rounded text-label text-accent underline-offset-2 hover:underline">
                        Payment history
                      </summary>
                      {history.length === 0 ? (
                        <p className="mt-2 text-label font-normal text-ink-tertiary">
                          {r.source === "manual"
                            ? "No payments recorded yet. This one was added by you."
                            : "No payments found."}
                        </p>
                      ) : (
                        <ul className="mt-2 max-w-md divide-y divide-line rounded-control bg-surface-secondary">
                          {history.map((t) => (
                            <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 text-label font-normal">
                              <span className="text-ink-secondary">{shortDate(t.date)}</span>
                              <Amount cents={t.amountCents} className="text-ink" />
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
