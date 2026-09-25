import { useMemo, useState } from "react";
import { Car, CreditCard, House, Info, PiggyBank, Plus, Repeat, TrendingUp, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Select, SelectField } from "@/components/ui/select";
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
import { modellableDebts } from "@/lib/finance/debt";
import { spendingAccounts } from "@/lib/finance/forecast";
import { changeTitle, monthlyEquivalent, runScenario, type ScenarioContext } from "@/lib/finance/scenarios";
import { addMonths, formatMoney, monthKey, monthLabel, parseRateBps, rateInputValue } from "@/lib/finance/money";
import type { PayoffStrategy, Scenario, ScenarioChange } from "@/lib/finance/types";
import { cn } from "@/lib/utils";

const HORIZON_LABELS: Record<number, string> = { 12: "1 year", 24: "2 years", 60: "5 years" };
const monthYear = (iso: string) => `${monthLabel(monthKey(iso), "short")} ${iso.slice(0, 4)}`;

function blankScenario(): Scenario {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name: "", horizonMonths: 24, changes: [], createdAt: now, updatedAt: now };
}

/** What makes two versions of a scenario the same, ignoring bookkeeping like the save time. */
function signature(s: Scenario): string {
  return JSON.stringify([s.name.trim(), s.horizonMonths, s.changes]);
}

const ADDABLE: { type: ScenarioChange["type"]; label: string; icon: LucideIcon }[] = [
  { type: "save_more", label: "Save more each month", icon: PiggyBank },
  { type: "extra_debt", label: "Pay extra toward debt", icon: CreditCard },
  { type: "income", label: "Change my income", icon: TrendingUp },
  { type: "expense", label: "Change a monthly cost", icon: House },
  { type: "purchase", label: "Make a big purchase", icon: Car },
  { type: "stop_subscription", label: "Stop a subscription", icon: Repeat },
];

function FieldLabel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <label htmlFor={id} className="text-label text-ink">
      {children}
    </label>
  );
}

/** Direction plus a positive amount, kept as one signed number on the change. */
function SignedAmount({
  idBase,
  value,
  onChange,
  up,
  down,
}: {
  idBase: string;
  value: number;
  onChange: (signedCents: number) => void;
  up: string;
  down: string;
}) {
  const negative = value < 0;
  const magnitude = Math.abs(value);
  return (
    <>
      <div>
        <FieldLabel id={`${idBase}-dir`}>Direction</FieldLabel>
        <Select id={`${idBase}-dir`} className="mt-1.5" value={negative ? "down" : "up"} onChange={(e) => onChange(e.target.value === "down" ? -magnitude : magnitude)}>
          <option value="up">{up}</option>
          <option value="down">{down}</option>
        </Select>
      </div>
      <div>
        <FieldLabel id={`${idBase}-amt`}>By how much, each month</FieldLabel>
        <MoneyInput
          live
          id={`${idBase}-amt`}
          className="mt-1.5"
          value={magnitude === 0 ? null : magnitude}
          onCommit={(c) => onChange((c ?? 0) * (negative ? -1 : 1))}
          placeholder="0"
        />
      </div>
    </>
  );
}

function ChangeEditor({
  change,
  ctx,
  debtChoices,
  onChange,
  onRemove,
}: {
  change: ScenarioChange;
  ctx: ScenarioContext;
  debtChoices: { id: string; name: string }[];
  onChange: (c: ScenarioChange) => void;
  onRemove: () => void;
}) {
  const id = `chg-${change.id}`;
  const [aprText, setAprText] = useState(change.type === "purchase" && change.aprBps > 0 ? rateInputValue(change.aprBps) : "");
  // Subscriptions, not bills: rent, insurance and loan payments have their own "change a monthly cost".
  const outflows = ctx.recurring.filter((r) => r.direction === "out" && r.kind === "expense" && !r.isBill && r.status !== "cancelled" && !r.possiblyStopped);

  let fields: React.ReactNode = null;
  switch (change.type) {
    case "save_more":
      fields = (
        <>
          <div>
            <FieldLabel id={`${id}-amt`}>Save this much more, each month</FieldLabel>
            <MoneyInput live id={`${id}-amt`} className="mt-1.5" value={change.monthlyCents === 0 ? null : change.monthlyCents} onCommit={(c) => onChange({ ...change, monthlyCents: c ?? 0 })} placeholder="500" />
          </div>
          <SelectField label="Toward" value={change.goalId ?? ""} onChange={(e) => onChange({ ...change, goalId: e.target.value || null })}>
            <option value="">No particular goal</option>
            {ctx.goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </SelectField>
        </>
      );
      break;
    case "extra_debt":
      fields = (
        <>
          <div>
            <FieldLabel id={`${id}-amt`}>Pay this much extra, each month</FieldLabel>
            <MoneyInput live id={`${id}-amt`} className="mt-1.5" value={change.monthlyCents === 0 ? null : change.monthlyCents} onCommit={(c) => onChange({ ...change, monthlyCents: c ?? 0 })} placeholder="300" />
          </div>
          <SelectField label="Toward" value={change.target} onChange={(e) => onChange({ ...change, target: e.target.value })}>
            <option value="all">All my debts</option>
            {debtChoices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
          {change.target === "all" && debtChoices.length > 1 && (
            <div className="md:col-span-2">
              <Segmented
                label="Which debt gets it first"
                value={change.strategy}
                onChange={(s: PayoffStrategy) => onChange({ ...change, strategy: s })}
                options={[
                  { value: "avalanche", label: "Highest rate first" },
                  { value: "snowball", label: "Smallest balance first" },
                ]}
              />
            </div>
          )}
          {debtChoices.length === 0 && (
            <p className="text-label font-normal text-ink-tertiary md:col-span-2">
              None of your debts has a rate and payment yet. Add them on the Debt page and this will show its effect.
            </p>
          )}
        </>
      );
      break;
    case "income":
      fields = <SignedAmount idBase={id} value={change.monthlyCents} onChange={(v) => onChange({ ...change, monthlyCents: v })} up="Goes up" down="Goes down" />;
      break;
    case "expense":
      fields = (
        <>
          <div>
            <FieldLabel id={`${id}-label`}>What is it?</FieldLabel>
            <Input id={`${id}-label`} className="mt-1.5" value={change.label} onChange={(e) => onChange({ ...change, label: e.target.value })} placeholder="Rent" />
          </div>
          <div />
          <SignedAmount idBase={id} value={change.monthlyCents} onChange={(v) => onChange({ ...change, monthlyCents: v })} up="Goes up" down="Goes down" />
        </>
      );
      break;
    case "stop_subscription":
      fields = (
        <div className="md:col-span-2">
          <FieldLabel id={`${id}-pick`}>Which one</FieldLabel>
          <Select id={`${id}-pick`} className="mt-1.5" value={change.recurringKey} onChange={(e) => onChange({ ...change, recurringKey: e.target.value })}>
            <option value="">Choose a payment</option>
            {outflows.map((r) => (
              <option key={r.key} value={r.key}>
                {r.merchant}, about {formatMoney(monthlyEquivalent(r), { cents: true })} a month
              </option>
            ))}
          </Select>
        </div>
      );
      break;
    case "purchase":
      fields = (
        <>
          <div>
            <FieldLabel id={`${id}-label`}>What is it?</FieldLabel>
            <Input id={`${id}-label`} className="mt-1.5" value={change.label} onChange={(e) => onChange({ ...change, label: e.target.value })} placeholder="A car" />
          </div>
          <div>
            <FieldLabel id={`${id}-price`}>Price</FieldLabel>
            <MoneyInput live id={`${id}-price`} className="mt-1.5" value={change.priceCents === 0 ? null : change.priceCents} onCommit={(c) => onChange({ ...change, priceCents: c ?? 0 })} placeholder="30,000" />
          </div>
          <div>
            <FieldLabel id={`${id}-when`}>When, in months from now</FieldLabel>
            <Input id={`${id}-when`} type="number" min={1} max={120} className="mt-1.5" value={change.inMonths || ""} onChange={(e) => onChange({ ...change, inMonths: Math.max(0, Math.round(Number(e.target.value))) })} placeholder="3" />
          </div>
          <div>
            <FieldLabel id={`${id}-value`}>
              Still worth afterwards <span className="font-normal text-ink-tertiary">(optional)</span>
            </FieldLabel>
            <MoneyInput live id={`${id}-value`} className="mt-1.5" value={change.valueCents === 0 ? null : change.valueCents} onCommit={(c) => onChange({ ...change, valueCents: c ?? 0 })} placeholder="0" />
          </div>
          <div className="flex items-center gap-3 md:col-span-2">
            <Switch aria-labelledby={`${id}-fin`} checked={change.financed} onChange={(v) => onChange({ ...change, financed: v })} />
            <span id={`${id}-fin`} className="text-body text-ink">
              Pay with a loan
            </span>
          </div>
          {change.financed && (
            <>
              <div>
                <FieldLabel id={`${id}-down`}>Down payment</FieldLabel>
                <MoneyInput live id={`${id}-down`} className="mt-1.5" value={change.downCents === 0 ? null : change.downCents} onCommit={(c) => onChange({ ...change, downCents: c ?? 0 })} placeholder="0" />
              </div>
              <div>
                <FieldLabel id={`${id}-apr`}>Loan rate (APR)</FieldLabel>
                <div className="relative mt-1.5">
                  <Input
                    id={`${id}-apr`}
                    inputMode="decimal"
                    autoComplete="off"
                    className="pr-7 text-right tabular-nums"
                    value={aprText}
                    placeholder="6.5"
                    onChange={(e) => {
                      setAprText(e.target.value);
                      const bps = e.target.value.trim() === "" ? 0 : parseRateBps(e.target.value);
                      if (bps !== null) onChange({ ...change, aprBps: bps });
                    }}
                  />
                  <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-body text-ink-tertiary">%</span>
                </div>
              </div>
              <div>
                <FieldLabel id={`${id}-term`}>Loan length, in months</FieldLabel>
                <Input id={`${id}-term`} type="number" min={1} max={480} className="mt-1.5" value={change.termMonths || ""} onChange={(e) => onChange({ ...change, termMonths: Math.max(0, Math.round(Number(e.target.value))) })} placeholder="60" />
              </div>
            </>
          )}
        </>
      );
      break;
  }

  return (
    <li className="rounded-card border border-line bg-surface-secondary/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-body font-medium text-ink">{changeTitle(change, ctx)}</h3>
        <Button variant="tertiary" size="sm" aria-label={`Remove: ${changeTitle(change, ctx)}`} onClick={onRemove}>
          Remove
        </Button>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">{fields}</div>
    </li>
  );
}

function newChange(type: ScenarioChange["type"], ctx: ScenarioContext): ScenarioChange {
  const id = crypto.randomUUID();
  switch (type) {
    case "save_more":
      return { id, type, monthlyCents: 0, goalId: ctx.goals[0]?.id ?? null };
    case "extra_debt":
      return { id, type, monthlyCents: 0, target: "all", strategy: "avalanche" };
    case "income":
      return { id, type, monthlyCents: 0 };
    case "expense":
      return { id, type, monthlyCents: 0, label: "" };
    case "purchase":
      return { id, type, label: "", priceCents: 0, downCents: 0, financed: false, aprBps: 0, termMonths: 60, inMonths: 1, valueCents: 0 };
    case "stop_subscription":
      return { id, type, recurringKey: "" };
  }
}

export function Scenarios({ finance, plans, planning }: { finance: Finance; plans: Plans; planning: Planning }) {
  const { snapshot, today } = finance;
  const [draft, setDraft] = useState<Scenario>(blankScenario);
  const [pending, setPending] = useState<string | null>(null); // where an unsaved draft would be switched to: an id, or "new"
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saved = planning.scenarios.find((s) => s.id === draft.id) ?? null;
  const dirty = saved ? signature(saved) !== signature(draft) : draft.changes.length > 0 || draft.name.trim() !== "";

  const ctx: ScenarioContext | null = useMemo(
    () =>
      snapshot
        ? {
            today,
            accounts: snapshot.accounts,
            debtTerms: planning.debtTerms,
            goals: plans.goals,
            contributions: plans.contributions,
            recurring: plans.recurring,
          }
        : null,
    [snapshot, today, planning.debtTerms, plans.goals, plans.contributions, plans.recurring],
  );
  const result = useMemo(() => (ctx ? runScenario(draft, ctx) : null), [draft, ctx]);
  const debtChoices = useMemo(
    () => (snapshot ? modellableDebts(snapshot.accounts, planning.debtTerms).map((d) => ({ id: d.id, name: d.name })) : []),
    [snapshot, planning.debtTerms],
  );

  const blocked = gate(finance, plans, planning);
  if (blocked) return blocked;
  if (!snapshot || !ctx || !result) return null;

  const cashNow = spendingAccounts(snapshot.accounts).reduce((s, a) => s + a.balanceCents, 0);
  const H = result.horizonMonths;
  const hasExtraDebt = draft.changes.some((c) => c.type === "extra_debt");

  function loadScenario(target: string) {
    if (target === "new") setDraft(blankScenario());
    else {
      const found = planning.scenarios.find((s) => s.id === target);
      if (found) setDraft({ ...found, changes: found.changes.map((c) => ({ ...c })) });
    }
    setPending(null);
    setConfirmDelete(false);
  }

  function choose(target: string) {
    if (target === draft.id) return;
    if (dirty) setPending(target);
    else loadScenario(target);
  }

  function update(changes: ScenarioChange[]) {
    setDraft((d) => ({ ...d, changes }));
  }

  function save() {
    const name = draft.name.trim() || "Untitled scenario";
    const next: Scenario = { ...draft, name, updatedAt: new Date().toISOString() };
    setDraft(next);
    void planning.saveScenario(next);
  }

  const labels = result.netWorth.map((_, m) => monthYear(addMonths(today, m)));
  const ticks = [0, 1 / 3, 2 / 3, 1].map((t) => {
    const index = Math.round(t * H);
    return { index, text: index === 0 ? "Now" : labels[index] };
  });
  const diff = (n: number) => (n === 0 ? "No change" : formatMoney(n, { signed: true }));
  const end = (a: number[]) => a[a.length - 1];

  return (
    <div>
      <PageHeader
        title="Scenarios"
        description="Try a change on paper and see how it could move your cash, savings, debt, goals and net worth."
        actions={<AskLink label="Ask about my options" question="How much can I put toward my goals based on my cash flow?" />}
      />
      {finance.origin === "sample" && <SampleNotice />}

      <div role="note" className="mb-4 flex items-start gap-3 rounded-card border border-line bg-surface-secondary px-4 py-3 text-body text-ink-secondary">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" strokeWidth={1.75} aria-hidden="true" />
        <p>
          <span className="font-medium text-ink">Hypothetical, not a prediction.</span> A scenario shows the difference from carrying on
          exactly as you are, using only the changes you add. Nothing here changes your accounts or your real plans.
        </p>
      </div>

      <Card as="section" aria-label="Scenario" className="p-6 max-md:p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <SelectField label="Scenario" value={draft.id} onChange={(e) => choose(e.target.value)}>
            {!saved && <option value={draft.id}>{draft.name.trim() || "New scenario"} (not saved)</option>}
            {planning.scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id === draft.id ? draft.name.trim() || s.name : s.name}
              </option>
            ))}
            {saved && <option value="new">New scenario…</option>}
          </SelectField>
          <div>
            <label htmlFor="sc-name" className="text-label text-ink">
              Name
            </label>
            <Input id="sc-name" className="mt-1.5" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Untitled scenario" />
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={save} disabled={!dirty || draft.changes.length === 0}>
              Save
            </Button>
            {saved && (
              <Button variant="tertiary" onClick={() => setConfirmDelete(true)} disabled={confirmDelete}>
                Delete
              </Button>
            )}
          </div>
        </div>

        {pending && (
          <p role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-control bg-warning-soft px-3 py-2 text-body text-ink">
            This scenario has changes you haven't saved.
            <Button variant="tertiary" size="sm" onClick={() => setPending(null)}>
              Keep editing
            </Button>
            <Button variant="secondary" size="sm" onClick={() => loadScenario(pending)}>
              Discard them
            </Button>
          </p>
        )}
        {confirmDelete && saved && (
          <p role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-control bg-warning-soft px-3 py-2 text-body text-ink">
            Delete "{saved.name}"?
            <Button variant="tertiary" size="sm" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="text-danger"
              onClick={() => {
                void planning.deleteScenario(saved.id);
                setDraft(blankScenario());
                setConfirmDelete(false);
              }}
            >
              Delete scenario
            </Button>
          </p>
        )}
        {saved && !dirty && <p className="mt-3 text-meta text-ink-tertiary">Saved.</p>}
        {dirty && draft.changes.length > 0 && <p className="mt-3 text-meta text-ink-tertiary">Unsaved changes.</p>}
      </Card>

      <Card as="section" aria-labelledby="sc-changes" className="mt-4 p-6 max-md:p-5">
        <h2 id="sc-changes" className="text-heading text-ink">
          What changes
        </h2>
        {draft.changes.length > 0 && (
          <ul className="mt-3 space-y-3">
            {draft.changes.map((c) => (
              <ChangeEditor
                key={c.id}
                change={c}
                ctx={ctx}
                debtChoices={debtChoices}
                onChange={(next) => update(draft.changes.map((x) => (x.id === c.id ? next : x)))}
                onRemove={() => update(draft.changes.filter((x) => x.id !== c.id))}
              />
            ))}
          </ul>
        )}
        <div className={cn("flex flex-wrap gap-2", draft.changes.length > 0 && "mt-4 border-t border-line pt-4")}>
          {draft.changes.length === 0 && <p className="mb-1 w-full text-body text-ink-tertiary">Start with one change. You can add as many as you like.</p>}
          {ADDABLE.map(({ type, label, icon: Icon }) => (
            <Button
              key={type}
              variant="secondary"
              size="sm"
              disabled={type === "extra_debt" && hasExtraDebt}
              onClick={() => update([...draft.changes, newChange(type, ctx)])}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              <span className="sr-only">Add: </span>
              {label}
            </Button>
          ))}
        </div>
      </Card>

      <Card as="section" aria-labelledby="sc-result" className="mt-4 p-6 max-md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 id="sc-result" className="text-heading text-ink">
              What it could do
            </h2>
            <BasisTag basis="scenario" />
          </div>
          <Segmented
            label="Look ahead"
            value={draft.horizonMonths}
            onChange={(h) => setDraft((d) => ({ ...d, horizonMonths: h }))}
            options={Object.entries(HORIZON_LABELS).map(([v, label]) => ({ value: Number(v), label }))}
          />
        </div>

        {draft.changes.length === 0 ? (
          <p className="mt-4 text-body text-ink-tertiary">Add a change above and the effect appears here.</p>
        ) : (
          <>
            <p className="mt-3 text-body text-ink-secondary">
              Compared with carrying on as you are, after {HORIZON_LABELS[draft.horizonMonths] ?? `${H} months`} ({monthYear(addMonths(today, H))}):
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <dt className="text-label text-ink-tertiary">Cash on hand</dt>
                <dd className="mt-0.5 text-heading tabular-nums text-ink">{diff(end(result.cash))}</dd>
              </div>
              <div>
                <dt className="text-label text-ink-tertiary">Set aside</dt>
                <dd className="mt-0.5 text-heading tabular-nums text-ink">{diff(end(result.savings))}</dd>
              </div>
              <div>
                <dt className="text-label text-ink-tertiary">Debt</dt>
                <dd className="mt-0.5 text-heading tabular-nums text-ink">{end(result.debt) === 0 ? "No change" : formatMoney(Math.abs(end(result.debt)))}</dd>
                <dd className="text-meta text-ink-tertiary">{end(result.debt) > 0 ? "less owed" : end(result.debt) < 0 ? "more owed" : ""}</dd>
              </div>
              <div>
                <dt className="text-label text-ink-tertiary">Net worth</dt>
                <dd className="mt-0.5 text-heading tabular-nums text-ink">{diff(end(result.netWorth))}</dd>
              </div>
            </dl>

            {result.hasEffect && (
              <div className="mt-5">
                <LineChart
                  labels={labels}
                  series={[
                    { name: "Net worth difference", values: result.netWorth },
                    { name: "Cash on hand difference", values: result.cash, tone: "muted", dashed: true },
                  ]}
                  xLabels={ticks}
                  zeroLine
                  caption={`How net worth and cash differ from carrying on, month by month for ${H} months`}
                />
              </div>
            )}

            <ul className="mt-5 space-y-2 border-t border-line pt-4">
              {result.effects.map((e) => (
                <li key={e.changeId} className={cn("text-body", e.unavailable ? "text-ink-tertiary" : "text-ink-secondary")}>
                  {e.summary}
                </li>
              ))}
            </ul>

            {result.goals.length > 0 && (
              <div className="mt-4 border-t border-line pt-4">
                <h3 className="text-label text-ink-tertiary">Goals</h3>
                <ul className="mt-2 space-y-2">
                  {result.goals.map((g) => (
                    <li key={g.goalId} className="text-body text-ink-secondary">
                      <span className="font-medium text-ink">{g.name}:</span>{" "}
                      {g.reached
                        ? "already reached."
                        : g.scenarioDate === null
                          ? "no finish date yet."
                          : g.baselineDate === null
                            ? `about ${monthYear(g.scenarioDate)} with this saving. There's no pace to compare with today.`
                            : g.monthsSooner === 0
                              ? `about ${monthYear(g.scenarioDate)}, the same as now.`
                              : `about ${monthYear(g.scenarioDate)} instead of ${monthYear(g.baselineDate)}, ${Math.abs(g.monthsSooner ?? 0)} ${Math.abs(g.monthsSooner ?? 0) === 1 ? "month" : "months"} ${(g.monthsSooner ?? 0) > 0 ? "sooner" : "later"}.`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {draft.changes.some((c) => c.type === "save_more" && c.goalId === null) && ctx.goals.length > 0 && (
              <p className="mt-3 text-label font-normal text-ink-tertiary">Point a saving change at a goal to see how its finish date moves.</p>
            )}

            {result.deepestCashDipCents > 0 && (
              <p className="mt-4 rounded-control bg-surface-secondary px-3 py-2 text-label font-normal text-ink-secondary">
                At its lowest, these changes take {formatMoney(result.deepestCashDipCents)} out of your cash compared with carrying on.
                You have {formatMoney(cashNow)} in your spending accounts today.
              </p>
            )}
          </>
        )}

        <div className="mt-5 border-t border-line pt-4">
          <h3 className="text-label text-ink-tertiary">What this assumes</h3>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-label font-normal text-ink-tertiary">
            <li>Everything else about your finances stays as it is now.</li>
            <li>Rates and payments stay as you entered them, and savings earn no interest.</li>
            <li>Something you buy is worth only what you enter for "still worth afterwards", and nothing if you leave it blank.</li>
            <li>Net worth is cash, plus what's set aside, plus what things you bought are worth, plus how much less you owe.</li>
          </ul>
        </div>
      </Card>

      <div className="mt-4 flex justify-end">
        <Button variant="tertiary" size="sm" onClick={() => choose("new")} disabled={draft.changes.length === 0 && !saved}>
          <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          Start a new scenario
        </Button>
      </div>
    </div>
  );
}
