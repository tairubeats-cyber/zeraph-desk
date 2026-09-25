import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { AskLink } from "@/components/finance/AskLink";
import { BasisTag, SampleNotice } from "@/components/finance/parts";
import { MoneyInput, ProgressBar, Stat } from "@/components/finance/inputs";
import { gate } from "@/components/finance/gate";
import type { Finance } from "@/lib/finance/useFinance";
import type { Plans } from "@/lib/finance/usePlans";
import { goalProgress, type GoalProgress } from "@/lib/finance/goals";
import { formatMoney, parseISODate } from "@/lib/finance/money";
import { GOAL_KINDS, type Goal, type GoalKind } from "@/lib/finance/types";

const monthYear = (iso: string) =>
  parseISODate(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });
const fullDate = (iso: string) =>
  parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** One neutral sentence about where a goal is headed. */
function outlook(goal: Goal, p: GoalProgress): string {
  if (p.reached) return "Goal reached.";
  if (p.deadlinePassed) return `The deadline passed on ${fullDate(goal.deadline as string)}, with ${formatMoney(p.remainingCents)} still to go.`;
  if (p.projectedDate === null) return "Add a monthly plan or a contribution to see a projection.";
  if (p.finishesByDeadline === true) return `At this rate it's projected to finish around ${monthYear(p.projectedDate)}, before the deadline.`;
  if (p.finishesByDeadline === false) {
    return `At this rate it's projected to finish around ${monthYear(p.projectedDate)}, after the ${fullDate(goal.deadline as string)} deadline.`;
  }
  return `At this rate it's projected to finish around ${monthYear(p.projectedDate)}.`;
}

function assumption(p: GoalProgress): string | null {
  if (p.assumedFrom === "plan") return `Assumes ${formatMoney(p.assumedMonthlyCents)} a month, your plan.`;
  if (p.assumedFrom === "history") return `Assumes ${formatMoney(p.assumedMonthlyCents)} a month, your recent pace.`;
  return null;
}

function GoalForm({
  initial,
  today,
  onSave,
  onCancel,
}: {
  initial: Goal | null;
  today: string;
  onSave: (goal: Goal) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<GoalKind>(initial?.kind ?? "emergency_fund");
  const [name, setName] = useState(initial?.name ?? "");
  const [target, setTarget] = useState<number | null>(initial?.targetCents ?? null);
  const [start, setStart] = useState<number | null>(initial ? initial.startCents : null);
  const [deadline, setDeadline] = useState(initial?.deadline ?? "");
  const [plan, setPlan] = useState<number | null>(initial && initial.monthlyPlanCents > 0 ? initial.monthlyPlanCents : null);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const finalName = name.trim() || GOAL_KINDS[kind];
    if (!target || target <= 0) return setError("Enter a target amount.");
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: finalName,
      kind,
      targetCents: target,
      startCents: start ?? 0,
      deadline: deadline || null,
      monthlyPlanCents: plan ?? 0,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
      <SelectField label="Type of goal" value={kind} onChange={(e) => setKind(e.target.value as GoalKind)}>
        {(Object.keys(GOAL_KINDS) as GoalKind[]).map((k) => (
          <option key={k} value={k}>
            {GOAL_KINDS[k]}
          </option>
        ))}
      </SelectField>
      <div>
        <label htmlFor="goal-name" className="text-label text-ink">
          Name
        </label>
        <Input id="goal-name" className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder={GOAL_KINDS[kind]} />
      </div>
      <div>
        <label htmlFor="goal-target" className="text-label text-ink">
          Target
        </label>
        <MoneyInput live id="goal-target" className="mt-1.5" value={target} onCommit={setTarget} placeholder="10,000" />
      </div>
      <div>
        <label htmlFor="goal-start" className="text-label text-ink">
          Already set aside
        </label>
        <MoneyInput live id="goal-start" className="mt-1.5" value={start} onCommit={setStart} placeholder="0" />
      </div>
      <div>
        <label htmlFor="goal-deadline" className="text-label text-ink">
          Deadline <span className="font-normal text-ink-tertiary">(optional)</span>
        </label>
        <Input id="goal-deadline" type="date" min={today} className="mt-1.5" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </div>
      <div>
        <label htmlFor="goal-plan" className="text-label text-ink">
          Planned per month <span className="font-normal text-ink-tertiary">(optional)</span>
        </label>
        <MoneyInput live id="goal-plan" className="mt-1.5" value={plan} onCommit={setPlan} placeholder="0" />
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
          {initial ? "Save changes" : "Create goal"}
        </Button>
      </div>
    </form>
  );
}

function GoalCard({ goal, finance, plans }: { goal: Goal; finance: Finance; plans: Plans }) {
  const { today } = finance;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(today);
  const [showAll, setShowAll] = useState(false);

  const p = goalProgress(goal, plans.contributions, today);
  const mine = plans.contributions.filter((c) => c.goalId === goal.id);
  const shown = showAll ? mine : mine.slice(0, 3);
  const note = assumption(p);

  if (editing) {
    return (
      <Card as="article" aria-label={`Edit ${goal.name}`} className="p-6 max-md:p-5">
        <h2 className="mb-4 text-heading text-ink">Edit goal</h2>
        <GoalForm
          initial={goal}
          today={today}
          onCancel={() => setEditing(false)}
          onSave={(g) => {
            void plans.saveGoal(g);
            setEditing(false);
          }}
        />
      </Card>
    );
  }

  return (
    <Card as="article" aria-labelledby={`goal-${goal.id}`} className="p-6 max-md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`goal-${goal.id}`} className="truncate text-heading text-ink">
            {goal.name}
          </h2>
          <p className="text-label font-normal text-ink-tertiary">{GOAL_KINDS[goal.kind]}</p>
        </div>
        <p className="shrink-0 text-heading tabular-nums text-ink">{Math.round(p.fraction * 100)}%</p>
      </div>

      <ProgressBar fraction={p.fraction} className="mt-4 h-2.5" />
      <p className="mt-2 text-body tabular-nums text-ink-secondary">
        {formatMoney(p.currentCents)} of {formatMoney(goal.targetCents)}
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 md:grid-cols-4">
        <Stat label="Remaining" value={formatMoney(p.remainingCents)} />
        <Stat label="Deadline" value={goal.deadline ? fullDate(goal.deadline) : "None"} />
        <Stat
          label="Needed per month"
          value={p.requiredMonthlyCents === null ? "n/a" : formatMoney(p.requiredMonthlyCents)}
          hint={p.requiredMonthlyCents === null ? (goal.deadline ? undefined : "no deadline set") : "to hit the deadline"}
        />
        <Stat
          label="Projected finish"
          value={p.projectedDate ? monthYear(p.projectedDate) : "n/a"}
          hint={p.projectedDate && !p.reached ? "an estimate" : undefined}
        />
      </dl>

      <div className="mt-4 flex items-start gap-2">
        <BasisTag basis={p.requiredMonthlyCents !== null ? "projection" : "calculation"} />
        <p className="text-label font-normal text-ink-secondary">
          {outlook(goal, p)} {note}
        </p>
      </div>

      <form
        className="mt-5 flex flex-wrap items-end gap-2 border-t border-line pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!amount || amount <= 0) return;
          void plans.addContribution(goal.id, amount, date, "");
          setAmount(null);
        }}
      >
        <div className="w-36">
          <label htmlFor={`amt-${goal.id}`} className="text-label text-ink">
            Add money
          </label>
          <MoneyInput live id={`amt-${goal.id}`} className="mt-1.5" value={amount} onCommit={setAmount} placeholder="0" />
        </div>
        <div>
          <label htmlFor={`date-${goal.id}`} className="block text-label text-ink">
            Date
          </label>
          <Input id={`date-${goal.id}`} type="date" className="mt-1.5 w-40" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <Button type="submit" variant="secondary">
          Add
        </Button>
      </form>

      {mine.length > 0 && (
        <div className="mt-4">
          <h3 className="text-label text-ink-tertiary">Contributions</h3>
          <ul className="mt-1 divide-y divide-line">
            {shown.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2 text-body">
                <span className="flex-1 text-ink-secondary">{fullDate(c.date)}</span>
                <span className="tabular-nums text-ink">{formatMoney(c.amountCents, { cents: true })}</span>
                <Button
                  variant="tertiary"
                  size="sm"
                  aria-label={`Remove the ${formatMoney(c.amountCents, { cents: true })} contribution from ${fullDate(c.date)}`}
                  onClick={() => void plans.deleteContribution(c.id)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          {mine.length > 3 && (
            <Button variant="tertiary" size="sm" className="-ml-3 mt-1" onClick={() => setShowAll((s) => !s)}>
              {showAll ? "Show fewer" : `Show all ${mine.length}`}
            </Button>
          )}
        </div>
      )}

      <div className="mt-5 flex items-center justify-end gap-2">
        {confirming ? (
          <>
            <span className="mr-1 text-label text-ink-secondary">Delete this goal and its contributions?</span>
            <Button variant="tertiary" size="sm" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button variant="secondary" size="sm" className="text-danger" onClick={() => void plans.deleteGoal(goal.id)}>
              Delete goal
            </Button>
          </>
        ) : (
          <>
            <Button variant="tertiary" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="tertiary" size="sm" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

export function Goals({ finance, plans }: { finance: Finance; plans: Plans }) {
  const [creating, setCreating] = useState(false);

  const blocked = gate(finance, plans);
  if (blocked) return blocked;

  return (
    <div>
      <PageHeader
        title="Goals"
        description="What you're saving toward, and how it's going."
        actions={
          <>
            <AskLink label="Ask about goals" question="How much can I put toward my goals based on my cash flow?" />
          <Button variant="primary" onClick={() => setCreating(true)} disabled={creating}>
            <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            New goal
          </Button>
          </>
        }
      />
      {finance.origin === "sample" && <SampleNotice />}

      {creating && (
        <Card as="section" aria-label="New goal" className="mb-4 p-6 max-md:p-5">
          <h2 className="mb-4 text-heading text-ink">New goal</h2>
          <GoalForm
            initial={null}
            today={finance.today}
            onCancel={() => setCreating(false)}
            onSave={(g) => {
              void plans.saveGoal(g, true);
              setCreating(false);
            }}
          />
        </Card>
      )}

      {plans.goals.length === 0 && !creating ? (
        <Card className="px-6 py-12 text-center">
          <p className="text-heading text-ink">No goals yet</p>
          <p className="mx-auto mt-1 max-w-[52ch] text-body text-ink-tertiary">
            An emergency fund, a trip, a down payment. Set a target and ZeraphDesk shows what it takes each month and when
            you'd get there. Progress is what you record here; it isn't read from a bank account.
          </p>
          <Button variant="primary" className="mt-5" onClick={() => setCreating(true)}>
            Create your first goal
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {plans.goals.map((g) => (
            <GoalCard key={g.id} goal={g} finance={finance} plans={plans} />
          ))}
        </div>
      )}
    </div>
  );
}
