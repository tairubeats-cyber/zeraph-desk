import { useEffect, useMemo } from "react";
import {
  ArrowRightLeft,
  Bell,
  CircleCheck,
  PiggyBank,
  Repeat,
  Target,
  Tags,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { LoadingBlock, SampleNotice } from "@/components/finance/parts";
import type { Finance } from "@/lib/finance/useFinance";
import type { Intel } from "@/lib/finance/useIntel";
import type { ActivityItem } from "@/lib/finance/intel";
import type { TxFilters } from "@/lib/finance/filters";
import { dayHeading, toISODate } from "@/lib/finance/money";
import type { ViewKey } from "@/nav";

const ICONS: Record<ActivityItem["kind"], LucideIcon> = {
  detected: Bell,
  dismissed: CircleCheck,
  recategorized: Tags,
  budget: PiggyBank,
  goal: Target,
  contribution: Target,
  recurring: Repeat,
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function Activity({
  finance,
  intel,
  onOpen,
}: {
  finance: Finance;
  intel: Intel;
  onOpen: (view: ViewKey, filters?: Partial<TxFilters>) => void;
}) {
  const { reloadEvents } = intel;
  // Things done on other screens since this was last open.
  useEffect(() => {
    void reloadEvents();
  }, [reloadEvents]);

  const groups = useMemo(() => {
    const out: { day: string; items: ActivityItem[] }[] = [];
    for (const item of intel.activity) {
      const day = toISODate(new Date(item.at));
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(item);
      else out.push({ day, items: [item] });
    }
    return out;
  }, [intel.activity]);

  if (!intel.ready) return <LoadingBlock label="Loading activity…" />;

  return (
    <div>
      <PageHeader title="Activity" description="What ZeraphDesk noticed and what you changed, newest first." />
      {finance.origin === "sample" && <SampleNotice />}

      {groups.length === 0 ? (
        <Card className="px-6 py-12 text-center">
          <p className="text-heading text-ink">Nothing yet</p>
          <p className="mx-auto mt-1 max-w-[52ch] text-body text-ink-tertiary">
            Findings, budget and goal changes, and recategorized transactions show up here as they happen.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.day} aria-label={dayHeading(g.day, finance.today)}>
              <h2 className="mb-2 px-1 text-label text-ink-tertiary">{dayHeading(g.day, finance.today)}</h2>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {g.items.map((item) => {
                    const Icon = item.kind === "recategorized" ? ArrowRightLeft : ICONS[item.kind];
                    const body = (
                      <>
                        <span
                          aria-hidden="true"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-ink-secondary"
                        >
                          <Icon className="h-[17px] w-[17px]" strokeWidth={1.6} />
                        </span>
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block text-body font-medium text-ink">{item.title}</span>
                          {item.detail && <span className="block text-label font-normal text-ink-tertiary">{item.detail}</span>}
                        </span>
                        <time dateTime={item.at} className="shrink-0 text-meta tabular-nums text-ink-tertiary">
                          {time(item.at)}
                        </time>
                      </>
                    );
                    return (
                      <li key={item.id}>
                        {item.view ? (
                          <button
                            onClick={() => onOpen(item.view as ViewKey, item.filters)}
                            className="flex w-full items-center gap-3 px-4 py-3 transition-colors duration-150 ease-standard hover:bg-surface-secondary"
                          >
                            {body}
                          </button>
                        ) : (
                          <div className="flex items-center gap-3 px-4 py-3">{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
