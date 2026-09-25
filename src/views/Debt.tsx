import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/PageHeader";
import { AskLink } from "@/components/finance/AskLink";
import { BasisTag, SampleNotice } from "@/components/finance/parts";
import { MoneyInput, ProgressBar, Segmented, Stat } from "@/components/finance/inputs";
import { gate } from "@/components/finance/gate";
import type { Finance } from "@/lib/finance/useFinance";
import type { Planning } from "@/lib/finance/usePlanning";
import { modellableDebts, nextDueDate, payoffProgress, simulatePayoff, type DebtInput, type PayoffResult } from "@/lib/finance/debt";
import { daysBetween, formatMoney, monthKey, monthLabel, parseISODate, parseRateBps, rateInputValue } from "@/lib/finance/money";
import { ACCOUNT_KINDS, type DebtTerms, type FinancialAccount, type PayoffStrategy } from "@/lib/finance/types";

const monthYear = (iso: string) => `${monthLabel(monthKey(iso))} ${iso.slice(0, 4)}`;
const shortDate = (iso: string) => parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const percent = (bps: number) => `${rateInputValue(bps)}%`;

/** "4 years, 6 months", "9 months". */
function duration(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y > 0) parts.push(`${y} ${y === 1 ? "year" : "years"}`);
  if (m > 0 || y === 0) parts.push(`${m} ${m === 1 ? "month" : "months"}`);
  return parts.join(", ");
}

/** The one sentence about when a payoff finishes, or why it doesn't. */
function payoffSentence(r: PayoffResult, payment: number): string {
  if (r.months === null || r.payoffDate === null) {
    return `At ${formatMoney(payment, { cents: true })} a month this isn't paid off within 50 years: the interest is about as large as the payment.`;
  }
  return `At ${formatMoney(payment, { cents: true })} a month it's paid off around ${monthYear(r.payoffDate)}, in ${duration(r.months)}, with about ${formatMoney(r.totalInterestCents)} in interest.`;
}

function TermsForm({
  account,
  initial,
  onSave,
  onCancel,
}: {
  account: FinancialAccount;
  initial: DebtTerms | undefined;
  onSave: (t: DebtTerms) => void;
  onCancel: () => void;
}) {
  const [apr, setApr] = useState(initial?.aprBps != null ? rateInputValue(initial.aprBps) : "");
  const [min, setMin] = useState<number | null>(initial?.minPaymentCents ?? null);
  const [pay, setPay] = useState<number | null>(initial?.paymentCents ?? null);
  const [due, setDue] = useState(initial?.dueDay != null ? String(initial.dueDay) : "");
  const [error, setError] = useState<string | null>(null);
  const id = `terms-${account.id}`;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const aprBps = apr.trim() === "" ? null : parseRateBps(apr);
    if (apr.trim() !== "" && aprBps === null) return setError("Enter the rate like 19.99 (a number from 0 to 100).");
    const dueDay = due.trim() === "" ? null : Number(due);
    if (dueDay !== null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) return setError("The due day is a day of the month, 1 to 31.");
    onSave({ accountId: account.id, aprBps, minPaymentCents: min, paymentCents: pay, dueDay });
  }

  return (
    <form noValidate onSubmit={submit} className="grid gap-3 md:grid-cols-2">
      <div>
        <label htmlFor={`${id}-apr`} className="text-label text-ink">
          Interest rate (APR)
        </label>
        <div className="relative mt-1.5">
          <Input id={`${id}-apr`} inputMode="decimal" autoComplete="off" className="pr-7 text-right tabular-nums" value={apr} onChange={(e) => setApr(e.target.value)} placeholder="19.99" />
          <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-body text-ink-tertiary">%</span>
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-min`} className="text-label text-ink">
          Minimum payment <span className="font-normal text-ink-tertiary">(per month)</span>
        </label>
        <MoneyInput live id={`${id}-min`} className="mt-1.5" value={min} onCommit={setMin} placeholder="0" />
      </div>
      <div>
        <label htmlFor={`${id}-pay`} className="text-label text-ink">
          What you pay <span className="font-normal text-ink-tertiary">(per month, if more than the minimum)</span>
        </label>
        <MoneyInput live id={`${id}-pay`} className="mt-1.5" value={pay} onCommit={setPay} placeholder="Same as minimum" />
      </div>
      <div>
        <label htmlFor={`${id}-due`} className="text-label text-ink">
          Due day <span className="font-normal text-ink-tertiary">(of the month)</span>
        </label>
        <Input id={`${id}-due`} type="number" min={1} max={31} className="mt-1.5" value={due} onChange={(e) => setDue(e.target.value)} placeholder="20" />
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
          Save
        </Button>
      </div>
    </form>
  );
}

function DebtCard({
  account,
  institution,
  planning,
  finance,
  input,
}: {
  account: FinancialAccount;
  institution: string;
  planning: Planning;
  finance: Finance;
  input: DebtInput | undefined;
}) {
  const { today, snapshot } = finance;
  const terms = planning.debtTerms.get(account.id);
  const [editing, setEditing] = useState(false);
  const [extra, setExtra] = useState<number | null>(null);
  const progress = snapshot ? payoffProgress(account, snapshot.balanceHistory) : null;

  const base = useMemo(() => (input ? simulatePayoff([input], today) : null), [input, today]);
  const faster = useMemo(
    () => (input && extra && extra > 0 ? simulatePayoff([input], today, { extraCents: extra }) : null),
    [input, extra, today],
  );
  const due = terms?.dueDay != null ? nextDueDate(terms.dueDay, today) : null;
  const heading = `debt-${account.id}`;

  return (
    <Card as="article" aria-labelledby={heading} className="p-6 max-md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={heading} className="truncate text-heading text-ink">
            {account.name}
          </h2>
          <p className="text-label font-normal text-ink-tertiary">
            {institution} · {ACCOUNT_KINDS[account.kind].label}
            {account.mask ? ` ••${account.mask}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-heading tabular-nums text-ink">{formatMoney(account.balanceCents, { cents: true })}</p>
          <p className="text-meta text-ink-tertiary">owed</p>
        </div>
      </div>

      {progress && progress.paidDownCents > 0 && (
        <div className="mt-4">
          <ProgressBar fraction={progress.fraction} className="h-2" />
          <p className="mt-1.5 text-label font-normal text-ink-secondary">
            Down {formatMoney(progress.paidDownCents)} from {formatMoney(progress.startCents)}, the most on record ({Math.round(progress.fraction * 100)}% paid down)
          </p>
        </div>
      )}

      {editing ? (
        <div className="mt-5 border-t border-line pt-4">
          <TermsForm
            account={account}
            initial={terms}
            onCancel={() => setEditing(false)}
            onSave={(t) => {
              void planning.saveDebtTerms(t);
              setEditing(false);
            }}
          />
        </div>
      ) : (
        <>
          {terms && (terms.aprBps !== null || terms.minPaymentCents !== null || terms.paymentCents !== null || terms.dueDay !== null) ? (
            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 md:grid-cols-4">
              <Stat label="Rate (APR)" value={terms.aprBps !== null ? percent(terms.aprBps) : "Not entered"} hint="you entered" />
              <Stat label="Minimum payment" value={terms.minPaymentCents !== null ? formatMoney(terms.minPaymentCents, { cents: true }) : "Not entered"} hint="you entered" />
              <Stat
                label="You pay"
                value={input ? formatMoney(input.paymentCents, { cents: true }) : "Not entered"}
                hint={terms.paymentCents === null && terms.minPaymentCents !== null ? "the minimum" : undefined}
              />
              <Stat
                label="Next due"
                value={due ? shortDate(due) : "Not entered"}
                hint={due ? (daysBetween(today, due) === 0 ? "today" : `in ${daysBetween(today, due)} days`) : undefined}
              />
            </dl>
          ) : (
            <p className="mt-5 border-t border-line pt-4 text-body text-ink-secondary">
              ZeraphDesk doesn't know this debt's rate or payment, and it can't work them out from the balance. Add them to see a payoff estimate.
            </p>
          )}

          {input && base && (
            <div className="mt-4 flex items-start gap-2">
              <BasisTag basis="projection" />
              <p className="text-label font-normal text-ink-secondary">{payoffSentence(base, input.paymentCents)}</p>
            </div>
          )}
          {terms && !input && (terms.aprBps !== null || terms.minPaymentCents !== null || terms.paymentCents !== null) && (
            <p className="mt-3 text-label font-normal text-ink-tertiary">
              A payoff estimate needs both a rate and a monthly payment.
            </p>
          )}

          {input && base && (
            <div className="mt-5 border-t border-line pt-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-44">
                  <label htmlFor={`extra-${account.id}`} className="text-label text-ink">
                    What if I pay more each month?
                  </label>
                  <MoneyInput live id={`extra-${account.id}`} className="mt-1.5" value={extra} onCommit={setExtra} placeholder="Extra per month" />
                </div>
              </div>
              {faster && faster.months !== null && faster.payoffDate && (
                <div className="mt-3 flex items-start gap-2">
                  <BasisTag basis="scenario" />
                  <p className="text-label font-normal text-ink-secondary">
                    With {formatMoney(extra ?? 0)} more a month, paid off around {monthYear(faster.payoffDate)}
                    {base.months !== null ? `, ${duration(Math.max(0, base.months - faster.months))} sooner` : ""}, with about {formatMoney(faster.totalInterestCents)} in interest
                    {base.months !== null ? ` (${formatMoney(Math.max(0, base.totalInterestCents - faster.totalInterestCents))} less)` : ""}.
                  </p>
                </div>
              )}
              {faster && faster.months === null && (
                <p className="mt-3 text-label font-normal text-ink-secondary">Even with that extra, it isn't paid off within 50 years at this rate.</p>
              )}
            </div>
          )}

          <div className="mt-5 flex justify-end">
            <Button variant="tertiary" size="sm" onClick={() => setEditing(true)}>
              {terms ? "Edit rate and payment" : "Add rate and payment"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

export function Debt({ finance, planning }: { finance: Finance; planning: Planning }) {
  const { snapshot, today } = finance;
  const [extra, setExtra] = useState<number | null>(null);
  const [strategy, setStrategy] = useState<PayoffStrategy>("avalanche");

  const accounts = useMemo(
    () => (snapshot ? snapshot.accounts.filter((a) => ACCOUNT_KINDS[a.kind].class === "liability") : []),
    [snapshot],
  );
  const debts = useMemo(() => (snapshot ? modellableDebts(snapshot.accounts, planning.debtTerms) : []), [snapshot, planning.debtTerms]);
  const byId = useMemo(() => new Map(debts.map((d) => [d.id, d])), [debts]);

  const now = useMemo(() => (debts.length ? simulatePayoff(debts, today) : null), [debts, today]);
  const plans = useMemo(() => {
    if (!extra || extra <= 0 || debts.length === 0) return null;
    const run = (s: PayoffStrategy) => simulatePayoff(debts, today, { extraCents: extra, strategy: s, rollover: true });
    return { avalanche: run("avalanche"), snowball: run("snowball") };
  }, [debts, extra, today]);

  const blocked = gate(finance, planning);
  if (blocked) return blocked;
  if (!snapshot) return null;

  const institutions = new Map(snapshot.institutions.map((i) => [i.id, i.name]));
  const owedTotal = accounts.reduce((s, a) => s + a.balanceCents, 0);
  const monthlyPayments = debts.reduce((s, d) => s + d.paymentCents, 0);
  const interestNow = debts.reduce((s, d) => s + Math.round((d.balanceCents * d.aprBps) / 10_000 / 12), 0);
  const missing = accounts.filter((a) => a.balanceCents > 0 && !byId.has(a.id));
  const allModelled = accounts.length > 0 && missing.length === 0;
  const chosen = plans ? plans[strategy] : null;

  if (accounts.length === 0) {
    return (
      <div>
        <PageHeader title="Debt" description="Balances, rates and payments, and how extra payments change the payoff date." />
        {finance.origin === "sample" && <SampleNotice />}
        <Card className="px-6 py-12 text-center">
          <p className="text-heading text-ink">No debts on your accounts</p>
          <p className="mx-auto mt-1 max-w-[52ch] text-body text-ink-tertiary">Credit cards and loans show up here once they're among your accounts.</p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Debt"
        description="Balances, rates and payments, and how extra payments change the payoff date."
        actions={<AskLink label="Ask about my debt" question="When will I be debt free?" />}
      />
      {finance.origin === "sample" && <SampleNotice />}

      <Card as="section" aria-labelledby="debt-sum" className="p-6 max-md:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="debt-sum" className="text-label text-ink-tertiary">
            Total owed
          </h2>
          <BasisTag basis="fact" />
        </div>
        <p className="mt-2 text-display tabular-nums text-ink max-md:text-title">{formatMoney(owedTotal)}</p>
        <p className="mt-2 text-body text-ink-tertiary">
          across {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
        </p>

        {debts.length > 0 && now && (
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5 md:grid-cols-3">
            <Stat label="Paid toward debt each month" value={formatMoney(monthlyPayments)} hint="from what you entered" />
            <Stat label="Interest each month, about" value={formatMoney(interestNow)} hint="an estimate at today's balances" />
            <Stat
              label={allModelled ? "Debt-free, projected" : "Paid off, projected"}
              value={now.payoffDate ? monthYear(now.payoffDate) : "Not within 50 years"}
              hint={allModelled ? "at the payments entered" : `for the ${debts.length} with rate and payment`}
            />
          </dl>
        )}
        {missing.length > 0 && (
          <p className="mt-4 text-label font-normal text-ink-tertiary">
            {debts.length === 0 ? "Add a rate and payment to a debt below to see estimates." : `Not included in the estimates: ${missing.map((a) => a.name).join(", ")}. Add a rate and payment to include ${missing.length === 1 ? "it" : "them"}.`}
          </p>
        )}
      </Card>

      {debts.length > 0 && now && (
        <Card as="section" aria-labelledby="debt-plan" className="mt-4 p-6 max-md:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="debt-plan" className="text-heading text-ink">
              Pay it off faster
            </h2>
            <BasisTag basis="scenario" />
          </div>
          <p className="mt-1 max-w-[62ch] text-body text-ink-tertiary">
            See what an extra amount each month could do. When one debt is paid off, its payment moves on to the next.
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-4">
            <div className="w-48">
              <label htmlFor="debt-extra" className="text-label text-ink">
                Extra each month
              </label>
              <MoneyInput live id="debt-extra" className="mt-1.5" value={extra} onCommit={setExtra} placeholder="150" />
            </div>
            {debts.length > 1 && (
              <Segmented
                label="Which debt gets the extra first"
                value={strategy}
                onChange={setStrategy}
                options={[
                  { value: "avalanche", label: "Highest rate first" },
                  { value: "snowball", label: "Smallest balance first" },
                ]}
              />
            )}
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[440px] text-body">
              <caption className="sr-only">Estimated payoff with and without extra payments</caption>
              <thead>
                <tr className="text-left text-label text-ink-tertiary">
                  <th scope="col" className="py-2 pr-3 font-medium">Plan</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Debt-free</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Time</th>
                  <th scope="col" className="py-2 pl-3 text-right font-medium">Interest</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[
                  { label: "As you pay now", r: now },
                  ...(plans
                    ? debts.length > 1
                      ? [
                          { label: `${formatMoney(extra ?? 0)} extra, highest rate first`, r: plans.avalanche },
                          { label: `${formatMoney(extra ?? 0)} extra, smallest balance first`, r: plans.snowball },
                        ]
                      : [{ label: `${formatMoney(extra ?? 0)} extra`, r: plans.avalanche }]
                    : []),
                ].map(({ label, r }) => (
                  <tr key={label}>
                    <th scope="row" className="py-2.5 pr-3 text-left font-normal text-ink">{label}</th>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{r.payoffDate ? monthYear(r.payoffDate) : "Not in 50 years"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">{r.months !== null ? duration(r.months) : "n/a"}</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums text-ink-secondary">{r.months !== null ? formatMoney(r.totalInterestCents) : "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plans && now.months !== null && chosen && chosen.months !== null && (
            <p className="mt-3 text-label font-normal text-ink-secondary">
              {debts.length > 1 ? (strategy === "avalanche" ? "Highest rate first" : "Smallest balance first") : "With the extra"}: {duration(now.months - chosen.months)} sooner and about{" "}
              {formatMoney(Math.max(0, now.totalInterestCents - chosen.totalInterestCents))} less interest than paying as you do now.
            </p>
          )}
          {chosen && debts.length > 1 && (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="text-label text-ink-tertiary">Paid off in this order</h3>
              <ol className="mt-1 divide-y divide-line">
                {[...chosen.perDebt]
                  .sort((a, b) => (a.months ?? Infinity) - (b.months ?? Infinity))
                  .map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-body">
                      <span className="text-ink">{byId.get(p.id)?.name}</span>
                      <span className="tabular-nums text-ink-secondary">{p.payoffDate ? monthYear(p.payoffDate) : "Not in 50 years"}</span>
                    </li>
                  ))}
              </ol>
            </div>
          )}
          <p className="mt-4 text-meta text-ink-tertiary">
            Estimates only. They assume the rates and payments you entered stay the same and nothing new is charged, and real statements round a little differently.
          </p>
        </Card>
      )}

      <div className="mt-4 space-y-4">
        {accounts.map((a) => (
          <DebtCard
            key={a.id}
            account={a}
            institution={institutions.get(a.institutionId) ?? "Unknown institution"}
            planning={planning}
            finance={finance}
            input={byId.get(a.id)}
          />
        ))}
      </div>
    </div>
  );
}
