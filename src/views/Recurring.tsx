import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Select, SelectField } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { AskLink } from "@/components/finance/AskLink";
import { BasisTag, CategoryGlyph, SampleNotice } from "@/components/finance/parts";
import { MoneyInput, Stat } from "@/components/finance/inputs";
import { gate } from "@/components/finance/gate";
import type { Finance } from "@/lib/finance/useFinance";
import type { Plans } from "@/lib/finance/usePlans";
import { FREQUENCY_LABELS } from "@/lib/finance/recurring";
import { formatMoney, parseISODate, addDays, daysBetween } from "@/lib/finance/money";
import type { Frequency, Necessity, RecurringPayment, RecurringStatus } from "@/lib/finance/types";

const UNIT: Record<Frequency, string> = {
  weekly: "week",
  biweekly: "2 weeks",
  semimonthly: "payment",
  monthly: "month",
  quarterly: "3 months",
  yearly: "year",
};

const shortDate = (iso: string) =>
  parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** One line saying where the pattern stands, in plain words. */
function nextNote(r: RecurringPayment, today: string): string {
  if (r.status === "cancelled") return "Marked as cancelled";
  if (r.possiblyStopped) return `No payment since ${r.lastDate ? shortDate(r.lastDate) : "the last one"}. It may have stopped.`;
  const days = daysBetween(today, r.nextDate);
  if (days < 0) return `Expected ${shortDate(r.nextDate)}, not seen yet`;
  return `Next: ${shortDate(r.nextDate)}`;
}

function amountLine(r: RecurringPayment): string {
  const approx = r.variable ? "about " : "";
  const per = r.frequency === "semimonthly" ? "payment" : UNIT[r.frequency];
  return `${approx}${formatMoney(r.amountCents, { cents: !r.variable })} / ${per}`;
}

function Row({ r, plans, today }: { r: RecurringPayment; plans: Plans; today: string }) {
  const dim = r.status === "cancelled";
  const isSpending = r.direction === "out" && r.kind === "expense";
  return (
    <li className="grid gap-x-4 gap-y-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 items-start gap-3">
        <CategoryGlyph categoryId={r.categoryId} />
        <div className="min-w-0">
          <p className={"truncate text-body font-medium " + (dim ? "text-ink-tertiary line-through" : "text-ink")}>
            {r.merchant}
            {r.source === "manual" && (
              <span className="ml-2 rounded-full bg-surface-secondary px-2 text-meta font-normal text-ink-tertiary no-underline">
                Added by you
              </span>
            )}
          </p>
          <p className="text-label font-normal text-ink-tertiary">
            {FREQUENCY_LABELS[r.frequency]} · {nextNote(r, today)}
          </p>
        </div>
      </div>

      <div className="text-right max-md:text-left">
        <p className={"text-body font-medium tabular-nums " + (r.direction === "in" ? "text-success" : "text-ink")}>
          {r.direction === "in" ? "+" : ""}
          {amountLine(r)}
        </p>
        {isSpending && (
          <p className="text-meta tabular-nums text-ink-tertiary">
            {formatMoney(r.annualCents)} a year
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 md:col-span-2 md:pl-12">
        <Select
          aria-label={`Status of ${r.merchant}`}
          className="w-36"
          value={r.status}
          onChange={(e) => void plans.markRecurring(r.key, { status: e.target.value as RecurringStatus })}
        >
          <option value="active">Active</option>
          <option value="reviewing">Reviewing</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        {isSpending && (
          <>
            <Select
              aria-label={`Essential or not: ${r.merchant}`}
              className="w-44"
              value={r.necessity}
              onChange={(e) => void plans.markRecurring(r.key, { necessity: e.target.value as Necessity })}
            >
              <option value="unset">Not sorted</option>
              <option value="essential">Essential</option>
              <option value="non_essential">Non-essential</option>
            </Select>
            <label className="flex cursor-pointer select-none items-center gap-2 text-label text-ink-secondary">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--accent)]"
                checked={r.isBill}
                onChange={(e) => void plans.markRecurring(r.key, { isBill: e.target.checked })}
              />
              Treat as a bill
            </label>
          </>
        )}
        {r.source === "manual" && (
          <Button
            variant="tertiary"
            size="sm"
            onClick={() => void plans.removeManualRecurring(r.key.replace("manual:", ""))}
          >
            Remove
          </Button>
        )}
      </div>
    </li>
  );
}

function AddForm({ finance, plans, onDone }: { finance: Finance; plans: Plans; onDone: () => void }) {
  const [name, setName] = useState("");
  const [cents, setCents] = useState<number | null>(null);
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [nextDate, setNextDate] = useState(addDays(finance.today, 7));
  const [categoryId, setCategoryId] = useState("subscriptions");
  const [error, setError] = useState<string | null>(null);

  const options = finance.categories.filter((c) => !c.hidden);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give it a name.");
    if (!cents) return setError("Enter the amount.");
    if (!nextDate) return setError("Pick the next date.");
    void plans.addManualRecurring({ name: name.trim(), amountCents: cents, direction, frequency, nextDate, categoryId });
    onDone();
  }

  return (
    <Card as="section" aria-label="Add a recurring payment" className="mb-4 p-5">
      <h2 className="text-heading text-ink">Add a recurring payment</h2>
      <p className="mt-1 max-w-[62ch] text-body text-ink-tertiary">
        For anything the history doesn't show yet, like a new subscription or a yearly charge.
      </p>
      <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="rp-name" className="text-label text-ink">
            Name
          </label>
          <Input id="rp-name" className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="Car registration" />
        </div>
        <div>
          <label htmlFor="rp-amount" className="text-label text-ink">
            Amount
          </label>
          <MoneyInput live id="rp-amount" className="mt-1.5" value={cents} onCommit={setCents} placeholder="0" />
        </div>
        <SelectField label="Direction" value={direction} onChange={(e) => setDirection(e.target.value as "in" | "out")}>
          <option value="out">Money out</option>
          <option value="in">Money in</option>
        </SelectField>
        <SelectField label="How often" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
          {(Object.keys(FREQUENCY_LABELS) as Frequency[])
            .filter((f) => f !== "semimonthly")
            .map((f) => (
              <option key={f} value={f}>
                {FREQUENCY_LABELS[f]}
              </option>
            ))}
        </SelectField>
        <div>
          <label htmlFor="rp-date" className="text-label text-ink">
            Next date
          </label>
          <Input id="rp-date" type="date" className="mt-1.5" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
        </div>
        <SelectField label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        {error && (
          <p role="alert" className="text-label text-danger md:col-span-2">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 md:col-span-2">
          <Button variant="tertiary" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Add
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function Recurring({ finance, plans }: { finance: Finance; plans: Plans }) {
  const [adding, setAdding] = useState(false);
  const { today } = finance;

  const groups = useMemo(() => {
    const by = (f: (r: RecurringPayment) => boolean) =>
      plans.recurring.filter(f).sort((a, b) => b.annualCents - a.annualCents);
    return {
      spending: by((r) => r.direction === "out" && r.kind === "expense"),
      transfers: by((r) => r.direction === "out" && r.kind !== "expense"),
      income: by((r) => r.direction === "in"),
    };
  }, [plans.recurring]);

  const summary = useMemo(() => {
    const live = groups.spending.filter((r) => r.status !== "cancelled" && !r.possiblyStopped);
    const yearly = (rows: RecurringPayment[]) => rows.reduce((s, r) => s + r.annualCents, 0);
    return {
      count: live.length,
      yearly: yearly(live),
      essential: yearly(live.filter((r) => r.necessity === "essential")),
      optional: yearly(live.filter((r) => r.necessity === "non_essential")),
      unsorted: yearly(live.filter((r) => r.necessity === "unset")),
    };
  }, [groups.spending]);

  const blocked = gate(finance, plans);
  if (blocked) return blocked;

  return (
    <div>
      <PageHeader
        title="Recurring"
        description="Payments that repeat, found in your transactions."
        actions={
          <>
            <AskLink label="Ask about subscriptions" question="What subscriptions am I paying for?" />
          <Button variant="secondary" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Add
          </Button>
          </>
        }
      />
      {finance.origin === "sample" && <SampleNotice />}
      {adding && <AddForm finance={finance} plans={plans} onDone={() => setAdding(false)} />}

      <Card as="section" aria-labelledby="rc-sum" className="p-6 max-md:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="rc-sum" className="text-label text-ink-tertiary">
            Recurring spending
          </h2>
          <BasisTag basis="calculation" />
        </div>
        <p className="mt-2 text-title tabular-nums text-ink">{formatMoney(Math.round(summary.yearly / 12))} a month</p>
        <p className="mt-1 text-body text-ink-tertiary">
          {formatMoney(summary.yearly)} a year across {summary.count} {summary.count === 1 ? "payment" : "payments"}
        </p>
        <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-line pt-4">
          <Stat label="Essential" value={formatMoney(summary.essential)} hint="a year" />
          <Stat label="Non-essential" value={formatMoney(summary.optional)} hint="a year" />
          <Stat label="Not sorted yet" value={formatMoney(summary.unsorted)} hint="a year" />
        </dl>
        <p className="mt-4 text-meta text-ink-tertiary">
          Amounts are averages of past payments, so ones that vary are estimates. Yearly charges need more than a year
          of history to be found; add them by hand.
        </p>
      </Card>

      {(
        [
          ["Spending", groups.spending, "Bills, subscriptions and memberships."],
          ["Transfers", groups.transfers, "Regular moves between your own accounts. They aren't counted as spending."],
          ["Regular income", groups.income, "Paychecks and other income that repeats."],
        ] as const
      ).map(([title, rows, blurb]) =>
        rows.length === 0 ? null : (
          <section key={title} aria-label={title} className="mt-6">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 px-1">
              <h2 className="text-heading text-ink">{title}</h2>
              <p className="text-label font-normal text-ink-tertiary">{blurb}</p>
            </div>
            <Card>
              <ul className="divide-y divide-line">
                {rows.map((r) => (
                  <Row key={r.key} r={r} plans={plans} today={today} />
                ))}
              </ul>
            </Card>
          </section>
        ),
      )}

      {plans.recurring.length === 0 && (
        <Card className="mt-6 px-6 py-10 text-center">
          <p className="text-heading text-ink">No recurring payments found</p>
          <p className="mt-1 text-body text-ink-tertiary">
            ZeraphDesk needs at least three payments with a steady rhythm to spot one. You can add any by hand.
          </p>
        </Card>
      )}

      <p className="mt-6 max-w-[70ch] px-1 text-meta text-ink-tertiary">
        Marking a payment cancelled only changes how ZeraphDesk counts it. ZeraphDesk can't cancel anything with the
        merchant, so you'd still do that with them.
      </p>
    </div>
  );
}
