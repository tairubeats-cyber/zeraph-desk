import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { PHASES, type NavItem } from "@/nav";

/** What a section that isn't built yet shows: what it's for, when it's planned, and nothing that looks functional. */
export function ComingSoon({ item, onOverview }: { item: NavItem; onOverview: () => void }) {
  const Icon = item.icon;
  return (
    <EmptyState
      icon={<Icon className="h-9 w-9" strokeWidth={1.5} />}
      title={item.label}
      description={item.about}
    >
      <p className="mt-4 rounded-2xl bg-surface-secondary px-3 py-1 text-meta font-medium text-ink-secondary">
        Not built yet
        {item.phase ? ` · planned for phase ${item.phase}, ${PHASES[item.phase].toLowerCase()}` : ""}
      </p>
      <div className="mt-6">
        <Button onClick={onOverview}>Back to Overview</Button>
      </div>
    </EmptyState>
  );
}
