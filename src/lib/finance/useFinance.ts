import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db, newEvent } from "../db";
import { pickProvider } from "./providers";
import { categoryMap, resolveTransactions } from "./analysis";
import { toISODate } from "./money";
import type {
  Category,
  CategoryKind,
  DataOrigin,
  FinancialSnapshot,
  ResolvedTransaction,
  TransactionOverride,
} from "./types";

interface Loaded {
  snapshot: FinancialSnapshot;
  categories: Category[];
  overrides: Map<string, TransactionOverride>;
  today: string;
  /** Which provider the snapshot came from. */
  source: "sample" | "import";
  origin: DataOrigin;
}

function message(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : "Something went wrong.";
}

/**
 * Loads the provider's snapshot plus the user's categories and edits, and
 * exposes the edits as actions. Edits show immediately and are saved after;
 * if a save fails the state is reloaded from disk so the screen never shows
 * something that didn't stick.
 */
export function useFinance(onError: (message: string) => void) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const overridesRef = useRef<Map<string, TransactionOverride>>(new Map());

  const load = useCallback(async () => {
    setError(null);
    try {
      const provider = await pickProvider();
      const [snapshot, categories, overrides] = await Promise.all([
        provider.load(),
        db.finCategories(),
        db.finOverrides(),
      ]);
      const map = new Map(overrides.map((o) => [o.txId, o]));
      overridesRef.current = map;
      setLoaded({
        snapshot,
        categories,
        overrides: map,
        today: toISODate(new Date()),
        source: provider.id === "import" ? "import" : "sample",
        origin: provider.origin,
      });
    } catch (err) {
      setError(message(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // "Today" is fixed when the data loads, so an app left open overnight would keep
  // showing yesterday's bills and budgets. Reload when the calendar day changes.
  const loadedDay = loaded?.today;
  useEffect(() => {
    if (!loadedDay) return;
    const check = () => {
      if (toISODate(new Date()) !== loadedDay) void load();
    };
    const timer = setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [loadedDay, load]);

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

  const patchOverrides = useCallback(
    (txIds: string[], patch: Partial<Omit<TransactionOverride, "txId">>): TransactionOverride[] => {
      const next = new Map(overridesRef.current);
      const written = txIds.map((txId) => {
        const merged: TransactionOverride = {
          txId,
          categoryId: null,
          note: "",
          flagged: false,
          ...next.get(txId),
          ...patch,
        };
        next.set(txId, merged);
        return merged;
      });
      overridesRef.current = next;
      setLoaded((prev) => (prev ? { ...prev, overrides: next } : prev));
      return written;
    },
    [],
  );

  const setCategory = useCallback(
    (txIds: string[], categoryId: string) =>
      guarded(async () => {
        for (const o of patchOverrides(txIds, { categoryId })) await db.saveOverride(o);
        await db.log(...txIds.map((id) => newEvent("transaction_recategorized", id, { categoryId })));
      }),
    [guarded, patchOverrides],
  );

  const setNote = useCallback(
    (txId: string, note: string) =>
      guarded(async () => {
        for (const o of patchOverrides([txId], { note })) await db.saveOverride(o);
      }),
    [guarded, patchOverrides],
  );

  const setFlagged = useCallback(
    (txId: string, flagged: boolean) =>
      guarded(async () => {
        for (const o of patchOverrides([txId], { flagged })) await db.saveOverride(o);
      }),
    [guarded, patchOverrides],
  );

  const saveCategory = useCallback(
    (category: Category) =>
      guarded(async () => {
        setLoaded((prev) =>
          prev
            ? {
                ...prev,
                categories: prev.categories.some((c) => c.id === category.id)
                  ? prev.categories.map((c) => (c.id === category.id ? category : c))
                  : [...prev.categories, category],
              }
            : prev,
        );
        await db.saveCategory(category);
      }),
    [guarded],
  );

  const addCategory = useCallback(
    (name: string, kind: CategoryKind) =>
      saveCategory({
        id: `custom-${crypto.randomUUID()}`,
        name,
        kind,
        position: (loaded?.categories.reduce((max, c) => Math.max(max, c.position), 0) ?? 0) + 1,
        hidden: false,
      }),
    [saveCategory, loaded],
  );

  const categories = loaded?.categories;
  const categoriesById = useMemo(() => categoryMap(categories ?? []), [categories]);
  const transactions: ResolvedTransaction[] = useMemo(
    () => (loaded ? resolveTransactions(loaded.snapshot.transactions, loaded.categories, loaded.overrides) : []),
    [loaded],
  );

  return {
    status: error ? ("error" as const) : loaded ? ("ready" as const) : ("loading" as const),
    error,
    reload: load,
    today: loaded?.today ?? toISODate(new Date()),
    snapshot: loaded?.snapshot ?? null,
    origin: loaded?.origin ?? ("sample" as DataOrigin),
    /** "sample" until the person imports an account, then "import". */
    source: loaded?.source ?? ("sample" as const),
    categories: categories ?? [],
    categoriesById,
    transactions,
    setCategory,
    setNote,
    setFlagged,
    saveCategory,
    addCategory,
  };
}

export type Finance = ReturnType<typeof useFinance>;
