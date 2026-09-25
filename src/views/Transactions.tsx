import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { AskLink } from "@/components/finance/AskLink";
import { BasisTag, LoadFailed, LoadingBlock, SampleNotice, TransactionRow } from "@/components/finance/parts";
import { TransactionDetail } from "@/components/finance/TransactionDetail";
import { CategoryManager } from "@/components/finance/CategoryManager";
import type { Finance } from "@/lib/finance/useFinance";
import {
  ALL,
  DEFAULT_FILTERS,
  PERIOD_LABELS,
  SORT_LABELS,
  applyFilters,
  type Direction,
  type Period,
  type SortKey,
  type TxFilters,
} from "@/lib/finance/filters";
import { dayHeading, formatMoney } from "@/lib/finance/money";

const PAGE = 150;

interface Props {
  finance: Finance;
  /** Filters to start from, e.g. when arriving from a category on the Overview. */
  preset?: Partial<TxFilters>;
}

export function Transactions({ finance, preset }: Props) {
  const { status, snapshot, transactions, categories, categoriesById, today } = finance;
  const [filters, setFilters] = useState<TxFilters>({ ...DEFAULT_FILTERS, ...preset });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const search = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<TxFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setLimit(PAGE);
  };

  // "/" jumps to search, Escape closes the detail panel — the workstation shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
      if (e.key === "/" && !typing) {
        e.preventDefault();
        search.current?.focus();
      } else if (e.key === "Escape" && !typing) {
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const accounts = useMemo(() => new Map((snapshot?.accounts ?? []).map((a) => [a.id, a.name])), [snapshot]);

  const list = useMemo(
    () => applyFilters(transactions, filters, today, (id) => categoriesById.get(id)?.name ?? ""),
    [transactions, filters, today, categoriesById],
  );

  const totals = useMemo(() => {
    let inCents = 0;
    let outCents = 0;
    for (const t of list) {
      if (t.amountCents > 0) inCents += t.amountCents;
      else outCents -= t.amountCents;
    }
    return { inCents, outCents };
  }, [list]);

  const shown = list.slice(0, limit);
  const selected = selectedId ? (transactions.find((t) => t.id === selectedId) ?? null) : null;
  const byDate = filters.sort === "date_desc" || filters.sort === "date_asc";
  const groups = useMemo(() => {
    if (!byDate) return [{ heading: null as string | null, rows: shown }];
    const out: { heading: string | null; rows: typeof shown }[] = [];
    for (const t of shown) {
      const last = out[out.length - 1];
      if (last && last.rows[0].date === t.date) last.rows.push(t);
      else out.push({ heading: dayHeading(t.date, today), rows: [t] });
    }
    return out;
  }, [shown, byDate, today]);

  if (status === "error") return <LoadFailed message={finance.error ?? ""} onRetry={finance.reload} />;
  if (!snapshot || status === "loading") return <LoadingBlock label="Loading transactions…" />;

  const isDefault = JSON.stringify(filters) === JSON.stringify(DEFAULT_FILTERS);

  return (
    <div>
      <PageHeader
        title="Transactions"
        description="Search, sort and correct anything the categories got wrong."
        actions={
          <>
            <AskLink label="Ask about spending" question="Where did most of my money go this month?" />
          <Button variant="secondary" aria-expanded={managing} onClick={() => setManaging((m) => !m)}>
            <Tags className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Categories
          </Button>
          </>
        }
      />
      {finance.origin === "sample" && <SampleNotice />}
      {managing && <CategoryManager finance={finance} />}

      <Card className="p-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <Input
            ref={search}
            type="search"
            aria-label="Search transactions"
            placeholder="Search merchant, note or category  ( / )"
            className="pl-9"
            value={filters.query}
            onChange={(e) => set({ query: e.target.value })}
          />
        </div>
        <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
          <Select aria-label="Period" value={filters.period} onChange={(e) => set({ period: e.target.value as Period })}>
            {Object.entries(PERIOD_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
          <Select aria-label="Category" value={filters.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
            <option value={ALL}>All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.hidden ? " (hidden)" : ""}
              </option>
            ))}
          </Select>
          <Select aria-label="Account" value={filters.accountId} onChange={(e) => set({ accountId: e.target.value })}>
            <option value={ALL}>All accounts</option>
            {snapshot.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Money in or out"
            value={filters.direction}
            onChange={(e) => set({ direction: e.target.value as Direction })}
          >
            <option value="all">All money</option>
            <option value="out">Money out</option>
            <option value="in">Money in</option>
          </Select>
          <Select aria-label="Sort" value={filters.sort} onChange={(e) => set({ sort: e.target.value as SortKey })}>
            {Object.entries(SORT_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <label className="flex cursor-pointer select-none items-center gap-2 text-label text-ink-secondary">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--accent)]"
              checked={filters.flaggedOnly}
              onChange={(e) => set({ flaggedOnly: e.target.checked })}
            />
            Marked for review only
          </label>
          {!isDefault && (
            <Button variant="tertiary" size="sm" onClick={() => set({ ...DEFAULT_FILTERS })}>
              Reset filters
            </Button>
          )}
        </div>
      </Card>

      <div className="mb-3 mt-4 flex flex-wrap items-center justify-between gap-2 px-1">
        <p role="status" className="text-label font-normal text-ink-tertiary">
          {list.length} {list.length === 1 ? "transaction" : "transactions"} · {formatMoney(totals.inCents)} in ·{" "}
          {formatMoney(totals.outCents)} out
        </p>
        <BasisTag basis="calculation" />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          {list.length === 0 ? (
            <Card className="px-6 py-12 text-center">
              <p className="text-heading text-ink">No matches</p>
              <p className="mt-1 text-body text-ink-tertiary">Nothing fits those filters. Try a wider period or clear the search.</p>
              <Button className="mt-4" onClick={() => set({ ...DEFAULT_FILTERS, period: "all" })}>
                Show everything
              </Button>
            </Card>
          ) : (
            <div className="space-y-4">
              {groups.map((g, i) => (
                <section key={g.heading ?? i} aria-label={g.heading ?? "Transactions"}>
                  {g.heading && <h2 className="mb-1.5 px-1 text-label text-ink-tertiary">{g.heading}</h2>}
                  <Card className="overflow-hidden">
                    <ul className="divide-y divide-line">
                      {g.rows.map((t) => (
                        <li key={t.id}>
                          <TransactionRow
                            showDate={!byDate}
                            tx={t}
                            category={categoriesById.get(t.categoryId)}
                            accountName={accounts.get(t.accountId) ?? ""}
                            selected={t.id === selectedId}
                            onSelect={(row) => setSelectedId(row.id === selectedId ? null : row.id)}
                          />
                        </li>
                      ))}
                    </ul>
                  </Card>
                </section>
              ))}
              {list.length > limit && (
                <div className="text-center">
                  <Button onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, list.length - limit)} more</Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Side panel on wide windows; a bottom sheet with a backdrop below lg. */}
        {selected ? (
          <>
            <div
              aria-hidden="true"
              onClick={() => setSelectedId(null)}
              className="fixed inset-0 z-20 bg-black/30 animate-fade-in lg:hidden"
            />
            <div className="fixed inset-x-0 bottom-0 z-30 lg:sticky lg:inset-auto lg:top-6 lg:z-auto">
              <TransactionDetail
                key={selected.id}
                tx={selected}
                finance={finance}
                accountName={accounts.get(selected.accountId) ?? ""}
                onClose={() => setSelectedId(null)}
              />
            </div>
          </>
        ) : (
          <Card className="hidden p-6 text-center text-body text-ink-tertiary lg:sticky lg:top-6 lg:block">
            Select a transaction to see its details, change its category or add a note.
          </Card>
        )}
      </div>
    </div>
  );
}
