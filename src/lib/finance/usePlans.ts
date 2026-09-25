import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db, newEvent } from "../db";
import { buildRecurring, DEFAULT_MARK } from "./recurring";
import type { Finance } from "./useFinance";
import type { Goal, GoalContribution, ManualRecurring, RecurringMark } from "./types";

interface Stored {
  budgets: Map<string, number>;
  goals: Goal[];
  contributions: GoalContribution[];
  marks: Map<string, RecurringMark>;
  manual: ManualRecurring[];
}

/** A short one-way fingerprint, so the event log can say "the same payment" without holding a merchant name. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `rec-${h.toString(16)}`;
}

function message(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : "Something went wrong.";
}

/**
 * Budgets, goals and the user's marks on recurring payments. Recurring
 * payments themselves are not stored: they're recomputed from the
 * transactions every time, so a correction to a transaction is reflected at once.
 * Edits show immediately and are saved after; a failed save reloads from disk.
 */
export function usePlans(finance: Finance, onError: (message: string) => void) {
  const [stored, setStored] = useState<Stored | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Read by actions that need the current value at call time, not whenever React runs an updater.
  const storedRef = useRef<Stored | null>(null);
  storedRef.current = stored;

  const load = useCallback(async () => {
    setError(null);
    try {
      const [budgets, goals, contributions, marks, manual] = await Promise.all([
        db.budgets(),
        db.goals(),
        db.goalContributions(),
        db.recurringMarks(),
        db.manualRecurring(),
      ]);
      setStored({
        budgets: new Map(budgets.map((b) => [b.categoryId, b.amountCents])),
        goals,
        contributions,
        marks: new Map(marks.map((m) => [m.key, m])),
        manual,
      });
    } catch (err) {
      setError(message(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const guarded = useCallback(
    async (write: () => Promise<void>) => {
      try {
        await write();
      } catch (err) {
        onError(`That didn't save. ${message(err)}`);
        await load();
      }
    },
    [load, onError],
  );

  const patch = useCallback((fn: (s: Stored) => Stored) => setStored((prev) => (prev ? fn(prev) : prev)), []);

  const recurring = useMemo(
    () =>
      stored
        ? buildRecurring(finance.transactions, finance.categoriesById, stored.manual, stored.marks, finance.today)
        : [],
    [stored, finance.transactions, finance.categoriesById, finance.today],
  );

  // --- budgets ---
  const setBudget = useCallback(
    (categoryId: string, amountCents: number | null) =>
      guarded(async () => {
        patch((s) => {
          const budgets = new Map(s.budgets);
          if (amountCents === null) budgets.delete(categoryId);
          else budgets.set(categoryId, amountCents);
          return { ...s, budgets };
        });
        if (amountCents === null) await db.deleteBudget(categoryId);
        else await db.saveBudget(categoryId, amountCents);
        await db.log(newEvent("budget_changed", categoryId));
      }),
    [guarded, patch],
  );

  const setBudgets = useCallback(
    (entries: Map<string, number>) =>
      guarded(async () => {
        patch((s) => ({ ...s, budgets: new Map([...s.budgets, ...entries]) }));
        for (const [categoryId, cents] of entries) await db.saveBudget(categoryId, cents);
        await db.log(...[...entries.keys()].map((id) => newEvent("budget_changed", id)));
      }),
    [guarded, patch],
  );

  // --- goals ---
  const saveGoal = useCallback(
    (goal: Goal, isNew = false) =>
      guarded(async () => {
        patch((s) => ({
          ...s,
          goals: s.goals.some((g) => g.id === goal.id)
            ? s.goals.map((g) => (g.id === goal.id ? goal : g))
            : [...s.goals, goal],
        }));
        await db.saveGoal(goal);
        if (isNew) await db.log(newEvent("goal_created", goal.id, { kind: goal.kind }));
      }),
    [guarded, patch],
  );

  const deleteGoal = useCallback(
    (id: string) =>
      guarded(async () => {
        patch((s) => ({
          ...s,
          goals: s.goals.filter((g) => g.id !== id),
          contributions: s.contributions.filter((c) => c.goalId !== id),
        }));
        await db.deleteGoal(id);
      }),
    [guarded, patch],
  );

  const addContribution = useCallback(
    (goalId: string, amountCents: number, date: string, note: string) =>
      guarded(async () => {
        const c: GoalContribution = { id: crypto.randomUUID(), goalId, amountCents, date, note };
        patch((s) => ({ ...s, contributions: [c, ...s.contributions] }));
        await db.addGoalContribution(c);
        await db.log(newEvent("goal_contribution_added", goalId));
      }),
    [guarded, patch],
  );

  const deleteContribution = useCallback(
    (id: string) =>
      guarded(async () => {
        patch((s) => ({ ...s, contributions: s.contributions.filter((c) => c.id !== id) }));
        await db.deleteGoalContribution(id);
      }),
    [guarded, patch],
  );

  // --- recurring ---
  const markRecurring = useCallback(
    (key: string, changes: Partial<Omit<RecurringMark, "key">>) =>
      guarded(async () => {
        const next: RecurringMark = { ...(storedRef.current?.marks.get(key) ?? DEFAULT_MARK(key)), ...changes };
        patch((s) => ({ ...s, marks: new Map(s.marks).set(key, next) }));
        await db.saveRecurringMark(next);
        await db.log(newEvent("recurring_marked", fingerprint(key)));
      }),
    [guarded, patch],
  );

  const addManualRecurring = useCallback(
    (m: Omit<ManualRecurring, "id">) =>
      guarded(async () => {
        const full: ManualRecurring = { ...m, id: crypto.randomUUID() };
        patch((s) => ({ ...s, manual: [...s.manual, full] }));
        await db.saveManualRecurring(full);
      }),
    [guarded, patch],
  );

  const removeManualRecurring = useCallback(
    (id: string) =>
      guarded(async () => {
        patch((s) => {
          const marks = new Map(s.marks);
          marks.delete(`manual:${id}`);
          return { ...s, manual: s.manual.filter((m) => m.id !== id), marks };
        });
        await db.deleteManualRecurring(id);
      }),
    [guarded, patch],
  );

  return {
    status: error ? ("error" as const) : stored ? ("ready" as const) : ("loading" as const),
    error,
    reload: load,
    budgets: stored?.budgets ?? new Map<string, number>(),
    goals: stored?.goals ?? [],
    contributions: stored?.contributions ?? [],
    recurring,
    setBudget,
    setBudgets,
    saveGoal,
    deleteGoal,
    addContribution,
    deleteContribution,
    markRecurring,
    addManualRecurring,
    removeManualRecurring,
  };
}

export type Plans = ReturnType<typeof usePlans>;
