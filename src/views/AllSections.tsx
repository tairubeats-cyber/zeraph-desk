import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { GROUPS, OVERVIEW, type ViewKey } from "@/nav";

/** The whole map in one list. It's the phone's "More" tab, and it doubles as the plan: what exists and what doesn't. */
export function AllSections({ onOpen }: { onOpen: (v: ViewKey) => void }) {
  const OverviewIcon = OVERVIEW.icon;
  return (
    <div>
      <PageHeader title="All sections" description="Everything ZeraphDesk covers. Sections marked as not built yet are planned." />
      <div className="space-y-6">
        <Card>
          <button
            onClick={() => onOpen("overview")}
            className="flex w-full items-center gap-3 rounded-card px-5 py-3.5 text-left transition-colors duration-150 ease-standard hover:bg-surface-secondary"
          >
            <OverviewIcon className="h-[18px] w-[18px] text-ink-secondary" strokeWidth={1.75} aria-hidden="true" />
            <span className="text-body font-medium text-ink">{OVERVIEW.label}</span>
          </button>
        </Card>
        {GROUPS.map((g) => (
          <section key={g.key} aria-labelledby={`all-${g.key}`}>
            <h2 id={`all-${g.key}`} className="mb-2 px-1 text-label text-ink-tertiary">
              {g.label}
            </h2>
            <Card className="overflow-hidden">
              <ul className="divide-y divide-line">
                {g.items.map((it) => {
                  const Icon = it.icon;
                  return (
                    <li key={it.key}>
                      <button
                        onClick={() => onOpen(it.key)}
                        className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors duration-150 ease-standard hover:bg-surface-secondary"
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0 text-ink-secondary" strokeWidth={1.75} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-body font-medium text-ink">{it.label}</span>
                          <span className="block truncate text-label font-normal text-ink-tertiary">{it.about}</span>
                        </span>
                        {!it.built && (
                          <span className="shrink-0 rounded-full bg-surface-secondary px-2.5 text-meta font-medium leading-6 text-ink-secondary">
                            Not built yet
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </section>
        ))}
      </div>
    </div>
  );
}
