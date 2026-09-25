/**
 * What-if scenarios. Every number here is a SCENARIO: a hypothetical worked out
 * from assumptions, never a prediction.
 *
 * A scenario is a list of changes (save more, pay extra on debt, a raise, a new
 * cost, a big purchase, stopping a subscription). The result is always the
 * DIFFERENCE from carrying on exactly as you are now. That keeps it honest: it
 * needs no forecast of your baseline, only arithmetic on the changes, so it
 * can't inherit errors from guessing what happens otherwise.
 *
 * Each month, for each change, four things move: cash on hand, money set
 * aside, debt, and the value of anything bought. Net worth is then simply
 *   cash + set aside + value held + reduction in debt,
 * so the pieces always add up to the total.
 *
 * Assumptions, stated on screen: rates and payments stay as entered, savings
 * earn no interest, things bought keep only the value entered, and no other
 * part of your finances changes.
 */
import type {
  DebtTerms,
  FinancialAccount,
  Goal,
  GoalContribution,
  RecurringPayment,
  Scenario,
  ScenarioChange,
} from "./types";
import { ACCOUNT_KINDS, GOAL_KINDS } from "./types";
import { CAP_MONTHS, loanSchedule, modellableDebts, simulatePayoff, valueAt } from "./debt";
import { goalProgress } from "./goals";
import { addMonths, formatMoney, monthLabel, monthKey } from "./money";

export interface ScenarioContext {
  today: string;
  accounts: FinancialAccount[];
  debtTerms: Map<string, DebtTerms>;
  goals: Goal[];
  contributions: GoalContribution[];
  recurring: RecurringPayment[];
}

export interface ChangeEffect {
  changeId: string;
  /** One plain sentence about what this change does. */
  summary: string;
  /** Why it has no effect right now, or null when it does. */
  unavailable: string | null;
}

export interface GoalOutcome {
  goalId: string;
  name: string;
  /** When the goal finishes carrying on as you are, or null with no pace to project from. */
  baselineDate: string | null;
  scenarioDate: string | null;
  /** Months sooner (positive) or later (negative); null when either date is unknown. */
  monthsSooner: number | null;
  reached: boolean;
}

export interface DebtOutcome {
  baselineDate: string | null;
  scenarioDate: string | null;
  monthsSooner: number | null;
  /** Interest saved over the payoff, positive when the scenario pays less. null unless both finish. */
  interestSavedCents: number | null;
  strategy: string;
}

export interface ScenarioResult {
  horizonMonths: number;
  effects: ChangeEffect[];
  /** Index m is the running difference after m months; index 0 is now. */
  cash: number[];
  savings: number[];
  /** Positive = less debt than carrying on. Negative = more (a loan taken on). */
  debt: number[];
  /** Value of things bought and kept. */
  held: number[];
  netWorth: number[];
  /** How far below carrying on cash sinks at its worst point (a positive amount), 0 if it never does. */
  deepestCashDipCents: number;
  goals: GoalOutcome[];
  debtOutcome: DebtOutcome | null;
  /** True when at least one change had an effect. */
  hasEffect: boolean;
}

const money = (c: number) => formatMoney(Math.abs(c));
const cents2 = (c: number) => formatMoney(Math.abs(c), { cents: true });
const monthYear = (iso: string) => `${monthLabel(monthKey(iso))} ${iso.slice(0, 4)}`;

/** What a recurring payment costs each month on average. */
export function monthlyEquivalent(r: RecurringPayment): number {
  return Math.round(r.annualCents / 12);
}

/** A short line naming a change, for the list of what's in a scenario. */
export function changeTitle(c: ScenarioChange, ctx: ScenarioContext): string {
  switch (c.type) {
    case "save_more": {
      const goal = c.goalId ? ctx.goals.find((g) => g.id === c.goalId) : null;
      return `Save ${money(c.monthlyCents)} more a month${goal ? ` toward ${goal.name}` : ""}`;
    }
    case "extra_debt": {
      const target = c.target === "all" ? "your debts" : (ctx.accounts.find((a) => a.id === c.target)?.name ?? "a debt");
      return `Pay ${money(c.monthlyCents)} extra a month toward ${target}`;
    }
    case "income":
      return `Income ${c.monthlyCents >= 0 ? "up" : "down"} ${money(c.monthlyCents)} a month`;
    case "expense":
      return `${c.label.trim() || "A cost"} ${c.monthlyCents >= 0 ? "up" : "down"} ${money(c.monthlyCents)} a month`;
    case "purchase":
      return `Buy ${c.label.trim() || "something"} for ${money(c.priceCents)}`;
    case "stop_subscription": {
      const r = ctx.recurring.find((x) => x.key === c.recurringKey);
      return `Stop ${r?.merchant ?? "a subscription"}`;
    }
  }
}

function zeros(n: number): number[] {
  return Array.from({ length: n + 1 }, () => 0);
}

export function runScenario(scenario: Pick<Scenario, "horizonMonths" | "changes">, ctx: ScenarioContext): ScenarioResult {
  const H = Math.max(1, Math.min(scenario.horizonMonths, 120));
  // Monthly cash movements (summed into a running total at the end), and levels that aren't movements.
  const cashMove = zeros(H);
  const savingsMove = zeros(H);
  const debtLevel = zeros(H);
  const heldLevel = zeros(H);
  const effects: ChangeEffect[] = [];
  const goalExtra = new Map<string, number>();
  let debtOutcome: DebtOutcome | null = null;
  let extraDebtSeen = false;

  const done = (id: string, summary: string, unavailable: string | null = null) => effects.push({ changeId: id, summary, unavailable });

  for (const c of scenario.changes) {
    switch (c.type) {
      case "save_more": {
        if (c.monthlyCents <= 0) {
          done(c.id, "Enter an amount to save each month.", "No amount entered.");
          break;
        }
        for (let m = 1; m <= H; m++) {
          cashMove[m] -= c.monthlyCents;
          savingsMove[m] += c.monthlyCents;
        }
        if (c.goalId) goalExtra.set(c.goalId, (goalExtra.get(c.goalId) ?? 0) + c.monthlyCents);
        done(
          c.id,
          `Moves ${money(c.monthlyCents)} a month from cash to savings: ${money(c.monthlyCents * H)} set aside after ${H} months, before any interest.`,
        );
        break;
      }

      case "income":
      case "expense": {
        const sign = c.type === "income" ? 1 : -1;
        if (c.monthlyCents === 0) {
          done(c.id, "Enter an amount.", "No amount entered.");
          break;
        }
        for (let m = 1; m <= H; m++) cashMove[m] += sign * c.monthlyCents;
        done(
          c.id,
          c.type === "income"
            ? `Your income is ${money(c.monthlyCents)} a month ${c.monthlyCents > 0 ? "higher" : "lower"}: ${money(c.monthlyCents * H)} ${c.monthlyCents > 0 ? "more" : "less"} cash after ${H} months.`
            : `${c.label.trim() || "This cost"} ${c.monthlyCents > 0 ? "rises" : "falls"} by ${money(c.monthlyCents)} a month: ${money(c.monthlyCents * H)} ${c.monthlyCents > 0 ? "less" : "more"} cash after ${H} months.`,
        );
        break;
      }

      case "stop_subscription": {
        const r = ctx.recurring.find((x) => x.key === c.recurringKey && x.direction === "out");
        if (!r) {
          done(c.id, "That payment isn't in your recurring list any more.", "Not found.");
          break;
        }
        if (r.status === "cancelled") {
          done(c.id, `${r.merchant} is already marked cancelled, so stopping it changes nothing.`, "Already cancelled.");
          break;
        }
        const monthly = monthlyEquivalent(r);
        for (let m = 1; m <= H; m++) cashMove[m] += monthly;
        done(c.id, `Stopping ${r.merchant} keeps about ${cents2(monthly)} a month, ${money(r.annualCents)} a year.`);
        break;
      }

      case "purchase": {
        if (c.priceCents <= 0) {
          done(c.id, "Enter a price.", "No price entered.");
          break;
        }
        if (c.inMonths > H) {
          done(c.id, `This happens after the ${H} months shown.`, "After the period shown.");
          break;
        }
        if (c.financed && c.termMonths < 1) {
          done(c.id, "Enter how many months the loan runs.", "No loan term entered.");
          break;
        }
        const k = Math.max(1, c.inMonths);
        const down = Math.min(c.priceCents, Math.max(0, c.downCents));
        const loan = c.financed ? c.priceCents - down : 0;
        cashMove[k] -= c.financed ? down : c.priceCents;
        for (let m = k; m <= H; m++) heldLevel[m] += c.valueCents;
        let text = `Buying ${c.label.trim() || "it"} for ${money(c.priceCents)} in month ${k}`;
        if (loan > 0) {
          const s = loanSchedule(loan, c.aprBps, c.termMonths);
          for (let m = k; m <= H; m++) debtLevel[m] -= s.balance[Math.min(m - k, s.balance.length - 1)];
          for (let j = 1; j < s.paid.length && k + j <= H; j++) cashMove[k + j] -= s.paid[j];
          const interest = s.interest.reduce((a, b) => a + b, 0);
          text += `, ${money(down)} down and a ${money(loan)} loan at ${(c.aprBps / 100).toFixed(2)}% over ${c.termMonths} months: about ${money(s.paymentCents)} a month, ${money(interest)} in interest in all.`;
        } else {
          text += ", paid from cash.";
        }
        if (c.valueCents === 0) text += " It isn't counted as an asset, so its whole cost shows as a drop in net worth.";
        done(c.id, text);
        break;
      }

      case "extra_debt": {
        if (extraDebtSeen) {
          done(c.id, "A scenario can have one extra debt payment.", "Only one allowed.");
          break;
        }
        extraDebtSeen = true;
        if (c.monthlyCents <= 0) {
          done(c.id, "Enter an amount to pay each month.", "No amount entered.");
          break;
        }
        const debts = modellableDebts(ctx.accounts, ctx.debtTerms);
        const focus = c.target === "all" ? null : c.target;
        if (debts.length === 0 || (focus && !debts.some((d) => d.id === focus))) {
          done(
            c.id,
            "There isn't a rate and payment for that debt yet. Add them under Debt to see its effect.",
            "Missing rate or payment.",
          );
          break;
        }
        const base = simulatePayoff(debts, ctx.today);
        const scen = simulatePayoff(debts, ctx.today, {
          extraCents: c.monthlyCents,
          strategy: c.strategy,
          rollover: true,
          focusId: focus,
        });
        for (let m = 1; m <= H; m++) {
          const paidScen = valueAt(scen.paid, m) - valueAt(scen.paid, m - 1);
          const paidBase = valueAt(base.paid, m) - valueAt(base.paid, m - 1);
          cashMove[m] -= paidScen - paidBase;
          debtLevel[m] += valueAt(base.balance, m) - valueAt(scen.balance, m);
        }
        const both = base.months !== null && scen.months !== null;
        debtOutcome = {
          baselineDate: base.payoffDate,
          scenarioDate: scen.payoffDate,
          monthsSooner: both ? (base.months as number) - (scen.months as number) : null,
          interestSavedCents: both ? base.totalInterestCents - scen.totalInterestCents : null,
          strategy: focus ? "that debt first" : c.strategy === "avalanche" ? "highest rate first" : "smallest balance first",
        };
        const which = focus ? (debts.find((d) => d.id === focus)?.name ?? "that debt") : "your debts";
        let text = `An extra ${money(c.monthlyCents)} a month toward ${which}`;
        if (both) {
          text += `: paid off by ${monthYear(scen.payoffDate as string)} instead of ${monthYear(base.payoffDate as string)}, about ${money(base.totalInterestCents - scen.totalInterestCents)} less interest.`;
        } else if (scen.months !== null) {
          text += `: paid off by ${monthYear(scen.payoffDate as string)}. At the current payments it wouldn't be paid off within ${Math.round(CAP_MONTHS / 12)} years.`;
        } else {
          text += ", which still isn't enough to pay it off within 50 years at these rates.";
        }
        const skipped = ctx.accounts.filter(
          (a) => ACCOUNT_KINDS[a.kind].class === "liability" && a.balanceCents > 0 && !debts.some((d) => d.id === a.id),
        );
        if (skipped.length > 0) text += ` ${skipped.map((a) => a.name).join(", ")} ${skipped.length === 1 ? "has" : "have"} no rate or payment entered, so ${skipped.length === 1 ? "it isn't" : "they aren't"} included.`;
        done(c.id, text);
        break;
      }
    }
  }

  // Running totals.
  const cash = zeros(H);
  const savings = zeros(H);
  for (let m = 1; m <= H; m++) {
    cash[m] = cash[m - 1] + cashMove[m];
    savings[m] = savings[m - 1] + savingsMove[m];
  }
  const netWorth = cash.map((c, m) => c + savings[m] + heldLevel[m] + debtLevel[m]);

  // Goals: a saving change pointed at a goal adds to the pace the goal is projected at.
  const goals: GoalOutcome[] = [];
  for (const [goalId, extra] of goalExtra) {
    const goal = ctx.goals.find((g) => g.id === goalId);
    if (!goal) continue;
    const base = goalProgress(goal, ctx.contributions, ctx.today);
    const faster = goalProgress(
      { ...goal, monthlyPlanCents: base.assumedMonthlyCents + extra },
      ctx.contributions,
      ctx.today,
    );
    const monthsSooner =
      base.projectedDate && faster.projectedDate
        ? monthDiff(faster.projectedDate, base.projectedDate)
        : null;
    goals.push({
      goalId,
      name: goal.name || GOAL_KINDS[goal.kind],
      baselineDate: base.projectedDate,
      scenarioDate: faster.projectedDate,
      monthsSooner,
      reached: base.reached,
    });
  }

  return {
    horizonMonths: H,
    effects,
    cash,
    savings,
    debt: debtLevel,
    held: heldLevel,
    netWorth,
    deepestCashDipCents: Math.max(0, -Math.min(...cash)),
    goals,
    debtOutcome,
    hasEffect: effects.some((e) => e.unavailable === null),
  };
}

/** Whole months from `a` to `b` by calendar month, so "Jun 2027 versus Oct 2027" is 4. */
function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

export const HORIZONS = [12, 24, 60] as const;

/** The date `months` from today, for chart labels. */
export function horizonDate(today: string, months: number): string {
  return addMonths(today, months);
}
