import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db, newEvent } from "../db";
import { DEFAULT_LONG_TERM } from "./longterm";
import type { DebtTerms, Holding, HoldingKind, LongTermAssumptions, PlannedItem, Scenario } from "./types";

interface Stored {
  terms: Map<string, DebtTerms>;
  holdings: Holding[];
  planned: PlannedItem[];
  scenarios: Scenario[];
  longTerm: LongTermAssumptions;
}

function message(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : "Something went wrong.";
}

/**
 * What the user has entered for planning: debt rates and payments, homes and
 * other things counted in net worth, planned one-off items, saved scenarios.
 * Forecasts and payoff estimates aren't stored; they're recomputed from these
 * and the account data. Edits show at once and are saved after; a failed save
 * reloads from disk so the screen never shows something that didn't stick.
 */
export function usePlanning(onError: (message: string) => void) {
  const [stored, setStored] = useState<Stored | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Read by actions that need the current value at call time, not whenever React runs an updater.
  const storedRef = useRef<Stored | null>(null);
  storedRef.current = stored;

  const load = useCallback(async () => {
    setError(null);
    try {
      const [terms, holdings, planned, scenarios, longTerm] = await Promise.all([
        db.debtTerms(),
        db.holdings(),
        db.plannedItems(),
        db.scenarios(),
        db.finLongTerm(),
      ]);
      setStored({ terms: new Map(terms.map((t) => [t.accountId, t])), holdings, planned, scenarios, longTerm });
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

  // --- debt terms ---
  const saveDebtTerms = useCallback(
    (t: DebtTerms) =>
      guarded(async () => {
        const empty = t.aprBps === null && t.minPaymentCents === null && t.paymentCents === null && t.dueDay === null;
        patch((s) => {
          const terms = new Map(s.terms);
          if (empty) terms.delete(t.accountId);
          else terms.set(t.accountId, t);
          return { ...s, terms };
        });
        if (empty) await db.deleteDebtTerms(t.accountId);
        else await db.saveDebtTerms(t);
        await db.log(newEvent("debt_terms_saved", t.accountId));
      }),
    [guarded, patch],
  );

  // --- holdings ---
  const addHolding = useCallback(
    (name: string, kind: HoldingKind, valueCents: number, date: string) =>
      guarded(async () => {
        const h: Holding = {
          id: crypto.randomUUID(),
          name,
          kind,
          createdAt: new Date().toISOString(),
          values: [{ date, valueCents }],
        };
        patch((s) => ({ ...s, holdings: [...s.holdings, h] }));
        await db.saveHolding(h);
        await db.saveHoldingValue(h.id, date, valueCents);
        await db.log(newEvent("holding_changed", h.id, { change: "added" }));
      }),
    [guarded, patch],
  );

  const renameHolding = useCallback(
    (id: string, name: string, kind: HoldingKind) =>
      guarded(async () => {
        const current = storedRef.current?.holdings.find((h) => h.id === id);
        patch((s) => ({ ...s, holdings: s.holdings.map((h) => (h.id === id ? { ...h, name, kind } : h)) }));
        if (current) await db.saveHolding({ ...current, name, kind });
        await db.log(newEvent("holding_changed", id, { change: "edited" }));
      }),
    [guarded, patch],
  );

  const setHoldingValue = useCallback(
    (id: string, date: string, valueCents: number) =>
      guarded(async () => {
        patch((s) => ({
          ...s,
          holdings: s.holdings.map((h) => {
            if (h.id !== id) return h;
            const values = [...h.values.filter((v) => v.date !== date), { date, valueCents }].sort((a, b) =>
              a.date.localeCompare(b.date),
            );
            return { ...h, values };
          }),
        }));
        await db.saveHoldingValue(id, date, valueCents);
        await db.log(newEvent("holding_changed", id, { change: "value" }));
      }),
    [guarded, patch],
  );

  const deleteHolding = useCallback(
    (id: string) =>
      guarded(async () => {
        patch((s) => ({ ...s, holdings: s.holdings.filter((h) => h.id !== id) }));
        await db.deleteHolding(id);
        await db.log(newEvent("holding_changed", id, { change: "removed" }));
      }),
    [guarded, patch],
  );

  // --- planned items ---
  const addPlanned = useCallback(
    (item: Omit<PlannedItem, "id">) =>
      guarded(async () => {
        const full: PlannedItem = { ...item, id: crypto.randomUUID() };
        patch((s) => ({ ...s, planned: [...s.planned, full].sort((a, b) => a.date.localeCompare(b.date)) }));
        await db.savePlannedItem(full);
        await db.log(newEvent("planned_item_added", full.id));
      }),
    [guarded, patch],
  );

  const deletePlanned = useCallback(
    (id: string) =>
      guarded(async () => {
        patch((s) => ({ ...s, planned: s.planned.filter((p) => p.id !== id) }));
        await db.deletePlannedItem(id);
      }),
    [guarded, patch],
  );

  // --- scenarios ---
  const saveScenario = useCallback(
    (scenario: Scenario) =>
      guarded(async () => {
        patch((s) => ({
          ...s,
          scenarios: s.scenarios.some((x) => x.id === scenario.id)
            ? s.scenarios.map((x) => (x.id === scenario.id ? scenario : x))
            : [...s.scenarios, scenario],
        }));
        await db.saveScenario(scenario);
        await db.log(newEvent("scenario_saved", scenario.id, { changes: scenario.changes.length }));
      }),
    [guarded, patch],
  );

  const deleteScenario = useCallback(
    (id: string) =>
      guarded(async () => {
        patch((s) => ({ ...s, scenarios: s.scenarios.filter((x) => x.id !== id) }));
        await db.deleteScenario(id);
      }),
    [guarded, patch],
  );

  const saveLongTerm = useCallback(
    (next: LongTermAssumptions) =>
      guarded(async () => {
        patch((s) => ({ ...s, longTerm: next }));
        await db.saveFinLongTerm(next);
        await db.log(newEvent("long_term_changed", null));
      }),
    [guarded, patch],
  );

  const empty = useMemo(() => ({ terms: new Map<string, DebtTerms>(), holdings: [], planned: [], scenarios: [] }), []);

  return {
    status: error ? ("error" as const) : stored ? ("ready" as const) : ("loading" as const),
    error,
    reload: load,
    debtTerms: stored?.terms ?? empty.terms,
    holdings: stored?.holdings ?? (empty.holdings as Holding[]),
    planned: stored?.planned ?? (empty.planned as PlannedItem[]),
    scenarios: stored?.scenarios ?? (empty.scenarios as Scenario[]),
    longTerm: stored?.longTerm ?? DEFAULT_LONG_TERM,
    saveLongTerm,
    saveDebtTerms,
    addHolding,
    renameHolding,
    setHoldingValue,
    deleteHolding,
    addPlanned,
    deletePlanned,
    saveScenario,
    deleteScenario,
  };
}

export type Planning = ReturnType<typeof usePlanning>;
