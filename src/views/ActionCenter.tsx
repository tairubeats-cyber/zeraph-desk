import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { BasisTag, LoadingBlock, SampleNotice } from "@/components/finance/parts";
import type { Finance } from "@/lib/finance/useFinance";
import type { Plans } from "@/lib/finance/usePlans";
import type { Intel } from "@/lib/finance/useIntel";
import type { ActionItem } from "@/lib/finance/intel";
import type { InsightOption } from "@/lib/finance/insights";
import type { TxFilters } from "@/lib/finance/filters";
import type { ViewKey } from "@/nav";
import { cn } from "@/lib/utils";

interface Props {
  finance: Finance;
  plans: Plans;
  intel: Intel;
  onOpen: (view: ViewKey, filters?: Partial<TxFilters>) => void;
  onNotify: (message: string) => void;
}

function FindingCard({ item, run, onDismiss }: { item: ActionItem; run: (o: InsightOption) => void; onDismiss: () => void }) {
  const { insight } = item;
  const attention = insight.severity === "attention";
  return (
    <Card as="article" aria-labelledby={`ins-${item.state.id}`} className="p-6 max-md:p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", attention ? "bg-warning" : "bg-chart-muted")}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h2 id={`ins-${item.state.id}`} className="text-heading text-ink">
              {insight.title}
            </h2>
            <BasisTag basis={insight.basis} />
          </div>
          <p className="mt-1 text-body text-ink-secondary">
            {attention && <span className="sr-only">Worth a look. </span>}
            {insight.summary}
          </p>

          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 md:grid-cols-4">
            {insight.facts.map((f) => (
              <div key={f.label}>
                <dt className="text-label text-ink-tertiary">{f.label}</dt>
                <dd className="mt-0.5 text-body font-medium tabular-nums text-ink">{f.value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 max-w-[70ch] text-label font-normal text-ink-secondary">
            <span className="font-medium text-ink">Why it might matter. </span>
            {insight.why}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {insight.options.map((o) => (
              <Button key={o.label} variant="secondary" size="sm" onClick={() => run(o)}>
                {o.label}
              </Button>
            ))}
            <Button variant="tertiary" size="sm" className="ml-auto" aria-label={`Dismiss: ${insight.title}`} onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function ActionCenter({ finance, plans, intel, onOpen, onNotify }: Props) {
  const { markAllRead } = intel;
  const unread = intel.items.filter((i) => !i.state.read).length;

  // Everything open is on screen, so opening the Action Center is reading it.
  useEffect(() => {
    if (intel.ready && unread > 0) void markAllRead();
  }, [intel.ready, unread, markAllRead]);

  if (!intel.ready) return <LoadingBlock label="Looking over your finances…" />;

  function run(o: InsightOption) {
    if (o.kind === "open") return onOpen(o.view, o.filters);
    void plans.markRecurring(o.recurringKey, { status: "reviewing" });
    onNotify("Marked as reviewing");
  }

  const n = intel.items.length;
  return (
    <div>
      <PageHeader
        title="Action Center"
        description={
          n === 0
            ? "Nothing needs a look right now."
            : `${n} ${n === 1 ? "thing" : "things"} worth a look, with the data behind each.`
        }
        actions={
          <Button variant="tertiary" onClick={() => onOpen("preferences")}>
            What's watched
          </Button>
        }
      />
      {finance.origin === "sample" && <SampleNotice />}

      {n === 0 ? (
        <Card className="px-6 py-12 text-center">
          <p className="text-heading text-ink">All clear</p>
          <p className="mx-auto mt-1 max-w-[52ch] text-body text-ink-tertiary">
            ZeraphDesk checks your spending, bills, budgets, goals and recurring payments and lists anything unusual
            here. Right now there's nothing to point out.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {intel.items.map((item) => (
            <FindingCard key={item.state.id} item={item} run={run} onDismiss={() => void intel.dismiss(item.state.id)} />
          ))}
        </div>
      )}

      {intel.dismissed.length > 0 && (
        <details className="mt-6">
          <summary className="w-fit cursor-pointer select-none rounded px-1 text-label text-ink-secondary hover:text-ink">
            Dismissed ({intel.dismissed.length})
          </summary>
          <Card className="mt-2">
            <ul className="divide-y divide-line">
              {intel.dismissed.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1 truncate text-body text-ink-secondary">{s.title}</span>
                  <Button variant="tertiary" size="sm" aria-label={`Restore: ${s.title}`} onClick={() => void intel.restore(s.id)}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </details>
      )}

      <p className="mt-6 max-w-[70ch] px-1 text-meta text-ink-tertiary">
        These are observations from your data, not advice. You decide what, if anything, to do about each one.
      </p>
    </div>
  );
}
