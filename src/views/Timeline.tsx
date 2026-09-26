import { useMemo, useState } from "react";
import { ArrowDownLeft, Bell, CalendarClock, Flag, Receipt, Repeat, ShoppingBag, Target, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { AskLink } from "@/components/finance/AskLink";
import { BasisTag, SampleNotice } from "@/components/finance/parts";
import { Segmented } from "@/components/finance/inputs";
import { gate } from "@/components/finance/gate";
import type { Finance } from "@/lib/finance/useFinance";
import type { Plans } from "@/lib/finance/usePlans";
import type { Planning } from "@/lib/finance/usePlanning";
import type { Intel } from "@/lib/finance/useIntel";
import type { TxFilters } from "@/lib/finance/filters";
import { formatMoney, parseISODate } from "@/lib/finance/money";
import {
  ALL_GROUPS,
  GROUP_LABELS,
  GROUP_OF,
  aheadTotals,
  buildTimeline,
  byDay,
  filterTimeline,
  relativeDay,
  sections,
  type FindingLine,
  type TimelineEntry,
  type TimelineGroup,
  type TimelineKind,
} from "@/lib/finance/timeline";
import { cn } from "@/lib/utils";
import type { ViewKey } from "@/nav";

const ICONS: Record<TimelineKind, LucideIcon> = {
  income: ArrowDownLeft,
  bill: Receipt,
  transfer: Repeat,
  purchase: ShoppingBag,
  goal: Target,
  deadline: Flag,
  planned: CalendarClock,
  finding: Bell,
};

const KIND_WORDS: Record<TimelineKind, string> = {
  income: "Money in",
  bill: "Bill or payment",
  transfer: "Payment to your own account",
  purchase: "Purchase",
  goal: "Goal deposit",
  deadline: "Goal deadline",
  planned: "Planned",
  finding: "Finding",
};

const BACK = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
];
const FORWARD = [
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days" },
];

/** A long list is shown in pages so a year of history doesn't put hundreds of rows on screen at once. */
const PAGE = 60;

function dayLabel(date: string, today: string) {
  const d = parseISODate(date);
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  const text = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  return `${text} · ${relativeDay(date, today)}`;
}

function Row({ e, onOpen }: { e: TimelineEntry; onOpen: (view: ViewKey, filters?: Partial<TxFilters>) => void }) {
  const Icon = ICONS[e.kind];
  return (
    <li>
      <button
        onClick={() => onOpen(e.view, e.filters)}
        className="flex w-full items-start gap-3 rounded-control px-2 py-2.5 text-left transition-colors duration-150 ease-standard hover:bg-surface-secondary"
      >
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-ink-secondary">
          <Icon className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-body font-medium text-ink">
              <span className="sr-only">{KIND_WORDS[e.kind]}: </span>
              {e.title}
            </span>
            {e.amountCents !== null && (
              <span className={cn("shrink-0 text-body tabular-nums", e.amountCents > 0 ? "text-success" : "text-ink")}>{formatMoney(e.amountCents, { signed: true })}</span>
            )}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-label font-normal text-ink-tertiary">
            <span>{e.detail}</span>
            {e.basis === "projection" && <BasisTag basis="projection" />}
          </span>
        </span>
      </button>
    </li>
  );
}

function Days({ entries, today, onOpen, limit }: { entries: TimelineEntry[]; today: string; onOpen: (view: ViewKey, filters?: Partial<TxFilters>) => void; limit: number }) {
  const days = byDay(entries.slice(0, limit));
  return (
    <div className="space-y-4">
      {days.map((d) => (
        <section key={d.date} aria-label={dayLabel(d.date, today)}>
          <h3 className="px-2 text-label text-ink-tertiary">{dayLabel(d.date, today)}</h3>
          <ul className="mt-1">
            {d.entries.map((e) => (
              <Row key={e.id} e={e} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function Timeline({
  finance,
  plans,
  planning,
  intel,
  onOpen,
}: {
  finance: Finance;
  plans: Plans;
  planning: Planning;
  intel: Intel;
  onOpen: (view: ViewKey, filters?: Partial<TxFilters>) => void;
}) {
  const { today, transactions, categoriesById } = finance;
  const [back, setBack] = useState(90);
  const [forward, setForward] = useState(60);
  const [groups, setGroups] = useState<Set<TimelineGroup>>(() => new Set(ALL_GROUPS));
  const [shownAhead, setShownAhead] = useState(PAGE);
  const [shownEarlier, setShownEarlier] = useState(PAGE);

  const findings: FindingLine[] = useMemo(
    () =>
      intel.items.map((i) => ({
        id: i.insight.id,
        title: i.insight.title,
        summary: i.insight.summary,
        on: i.insight.on,
        view: i.insight.options.find((o) => o.kind === "open")?.view ?? "action-center",
      })),
    [intel.items],
  );

  const all = useMemo(
    () =>
      buildTimeline({
        today,
        transactions,
        categories: categoriesById,
        recurring: plans.recurring,
        planned: planning.planned,
        goals: plans.goals,
        contributions: plans.contributions,
        findings,
        pastDays: back,
        aheadDays: forward,
      }),
    [today, transactions, categoriesById, plans.recurring, plans.goals, plans.contributions, planning.planned, findings, back, forward],
  );
  const shown = useMemo(() => filterTimeline(all, groups), [all, groups]);
  const sec = useMemo(() => sections(shown), [shown]);
  const totals = useMemo(() => aheadTotals(shown), [shown]);

  const blocked = gate(finance, plans, planning);
  if (blocked) return blocked;

  function toggle(g: TimelineGroup) {
    setGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
    setShownAhead(PAGE);
    setShownEarlier(PAGE);
  }

  const count = (g: TimelineGroup) => all.filter((e) => GROUP_OF[e.kind] === g).length;

  return (
    <div>
      <PageHeader
        title="Timeline"
        description="What happened and what's scheduled, in date order."
        actions={<AskLink label="Ask what's coming up" question="What bills are coming up?" />}
      />
      {finance.origin === "sample" && <SampleNotice />}

      <Card className="p-5 md:p-6">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <div>
            <p id="tl-back" className="mb-1.5 text-label text-ink">
              Look back
            </p>
            <Segmented label="How far back to look" options={BACK} value={back} onChange={(v) => { setBack(v); setShownEarlier(PAGE); }} />
          </div>
          <div>
            <p id="tl-forward" className="mb-1.5 text-label text-ink">
              Look ahead
            </p>
            <Segmented label="How far ahead to look" options={FORWARD} value={forward} onChange={(v) => { setForward(v); setShownAhead(PAGE); }} />
          </div>
        </div>
        <div role="group" aria-label="Kinds of entry to show" className="mt-4 flex flex-wrap gap-2">
          {ALL_GROUPS.map((g) => (
            <button
              key={g}
              onClick={() => toggle(g)}
              aria-pressed={groups.has(g)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-label text-ink-secondary transition-colors duration-150 aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-ink"
            >
              {GROUP_LABELS[g]}
              <span className="text-meta tabular-nums text-ink-tertiary">{count(g)}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card as="section" aria-labelledby="tl-ahead" className="mt-4 p-6 max-md:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="tl-ahead" className="text-heading text-ink">
            Ahead
          </h2>
          <BasisTag basis="projection" />
        </div>
        {totals.count === 0 ? (
          <p className="mt-3 text-body text-ink-tertiary">Nothing is scheduled in the next {forward} days{groups.size < ALL_GROUPS.length ? " for the kinds you've chosen" : ""}.</p>
        ) : (
          <>
            <p className="mt-2 text-body text-ink-secondary">
              Over the next {forward} days, {totals.count} {totals.count === 1 ? "item is" : "items are"} expected
              {totals.inCents > 0 ? `, with ${formatMoney(totals.inCents)} coming in` : ""}
              {totals.outCents > 0 ? `${totals.inCents > 0 ? " and" : ", with"} ${formatMoney(totals.outCents)} going out` : ""}.
            </p>
            <p className="mt-1 text-meta text-ink-tertiary">
              These come from repeating patterns in your transactions and plans you entered. Dates and amounts can move; none of it is guaranteed.
            </p>
            <div className="mt-4">
              <Days entries={sec.ahead} today={today} onOpen={onOpen} limit={shownAhead} />
            </div>
            {sec.ahead.length > shownAhead && (
              <Button variant="tertiary" size="sm" className="mt-3" onClick={() => setShownAhead((n) => n + PAGE)}>
                Show more ({sec.ahead.length - shownAhead} more)
              </Button>
            )}
          </>
        )}
      </Card>

      {sec.today.length > 0 && (
        <Card as="section" aria-labelledby="tl-today" className="mt-4 p-6 max-md:p-5">
          <h2 id="tl-today" className="text-heading text-ink">
            Today
          </h2>
          <ul className="mt-2">
            {sec.today.map((e) => (
              <Row key={e.id} e={e} onOpen={onOpen} />
            ))}
          </ul>
        </Card>
      )}

      <Card as="section" aria-labelledby="tl-earlier" className="mt-4 p-6 max-md:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="tl-earlier" className="text-heading text-ink">
            Earlier
          </h2>
          <BasisTag basis="fact" />
        </div>
        {sec.earlier.length === 0 ? (
          <p className="mt-3 text-body text-ink-tertiary">Nothing to show for the last {back === 365 ? "year" : `${back} days`}{groups.size < ALL_GROUPS.length ? " for the kinds you've chosen" : ""}.</p>
        ) : (
          <>
            <p className="mt-1 text-meta text-ink-tertiary">
              Every income deposit and payment that repeats, each month's few largest purchases and any that stand out, goal deposits, and findings. The Transactions screen has everything.
            </p>
            <div className="mt-4">
              <Days entries={sec.earlier} today={today} onOpen={onOpen} limit={shownEarlier} />
            </div>
            {sec.earlier.length > shownEarlier && (
              <Button variant="tertiary" size="sm" className="mt-3" onClick={() => setShownEarlier((n) => n + PAGE)}>
                Show more ({sec.earlier.length - shownEarlier} more)
              </Button>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
