import type { Goal, GoalContribution } from "./types";
import { addDays, addMonths, daysBetween } from "./money";

export interface GoalProgress {
  currentCents: number;
  remainingCents: number;
  /** 0 to 1. */
  fraction: number;
  reached: boolean;
  deadlinePassed: boolean;
  /** CALCULATION: what it takes each month to finish by the deadline. null without a deadline, or once reached or past it. */
  requiredMonthlyCents: number | null;
  /** Average actually added per month over the last 90 days. */
  recentMonthlyCents: number;
  /** The monthly amount the projection assumes, and where it came from. */
  assumedMonthlyCents: number;
  assumedFrom: "plan" | "history" | "none";
  /** PROJECTION: when it finishes at the assumed rate. null if there's no rate to project from. */
  projectedDate: string | null;
  /** Whether the projection lands on or before the deadline. null when either is missing. */
  finishesByDeadline: boolean | null;
}

export function goalCurrent(goal: Goal, contributions: GoalContribution[]): number {
  return goal.startCents + contributions.filter((c) => c.goalId === goal.id).reduce((s, c) => s + c.amountCents, 0);
}

export function goalProgress(goal: Goal, contributions: GoalContribution[], today: string): GoalProgress {
  const mine = contributions.filter((c) => c.goalId === goal.id);
  const currentCents = goalCurrent(goal, contributions);
  const remainingCents = Math.max(0, goal.targetCents - currentCents);
  const reached = remainingCents === 0;

  const since = addDays(today, -90);
  const recentMonthlyCents = Math.round(
    mine.filter((c) => c.date >= since && c.date <= today).reduce((s, c) => s + c.amountCents, 0) / 3,
  );

  const deadlinePassed = goal.deadline !== null && goal.deadline < today;
  let requiredMonthlyCents: number | null = null;
  if (goal.deadline && !reached && !deadlinePassed) {
    const months = daysBetween(today, goal.deadline) / 30.4375;
    requiredMonthlyCents = Math.ceil(remainingCents / Math.max(months, 1));
  }

  const assumedFrom = goal.monthlyPlanCents > 0 ? "plan" : recentMonthlyCents > 0 ? "history" : "none";
  const assumedMonthlyCents = assumedFrom === "plan" ? goal.monthlyPlanCents : recentMonthlyCents;

  let projectedDate: string | null = null;
  if (reached) projectedDate = today;
  else if (assumedMonthlyCents > 0) projectedDate = addMonths(today, Math.ceil(remainingCents / assumedMonthlyCents));

  return {
    currentCents,
    remainingCents,
    fraction: goal.targetCents > 0 ? Math.min(1, currentCents / goal.targetCents) : 0,
    reached,
    deadlinePassed,
    requiredMonthlyCents,
    recentMonthlyCents,
    assumedMonthlyCents,
    assumedFrom,
    projectedDate,
    finishesByDeadline: goal.deadline && projectedDate && !reached ? projectedDate <= goal.deadline : null,
  };
}
