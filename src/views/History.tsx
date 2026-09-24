import { Check, CircleAlert, Minus, Send, type LucideIcon } from "lucide-react";
import { type Action, type ActionStatus, ACTION_LABELS } from "../lib/actions";
import { Card } from "@/components/ui/card";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";

// Status is meaning, so it gets colour; everything else on the row stays neutral.
const STATUS: Record<ActionStatus, { label: string; icon: LucideIcon; tone: string }> = {
  sent: { label: "Sent", icon: Check, tone: "bg-success-soft text-success" },
  approved: { label: "Sending", icon: Send, tone: "bg-surface-secondary text-ink-secondary" },
  declined: { label: "Skipped", icon: Minus, tone: "bg-surface-secondary text-ink-secondary" },
  failed: { label: "Didn't send", icon: CircleAlert, tone: "bg-danger-soft text-danger" },
  pending: { label: "Waiting", icon: Minus, tone: "bg-surface-secondary text-ink-secondary" },
};

function decidedLabel(a: Action): string | null {
  if (!a.decidedAt) return null;
  return new Date(a.decidedAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function History({ actions }: { actions: Action[] }) {
  if (actions.length === 0) {
    return (
      <EmptyState
        icon={<Send className="h-9 w-9" strokeWidth={1.5} />}
        title="Nothing sent yet"
        description="Everything you approve shows up here, with what it was answering."
      />
    );
  }

  return (
    <div>
      <PageHeader title="Sent" description="Everything you've approved or skipped, newest first." />
      <Card>
        <ul className="divide-y divide-line">
          {actions.map((a) => {
            const status = STATUS[a.status];
            const StatusIcon = status.icon;
            const when = decidedLabel(a);
            return (
              <li key={a.id} className="flex items-start gap-4 px-5 py-4 max-md:flex-col max-md:gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-ink">{ACTION_LABELS[a.kind]}</p>
                  <p className="mt-0.5 line-clamp-2 text-body text-ink-tertiary">{a.rationale}</p>
                  {when && (
                    <time dateTime={a.decidedAt ?? undefined} className="mt-1 block text-meta text-ink-tertiary">
                      {when}
                    </time>
                  )}
                </div>
                <span
                  className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-meta font-medium ${status.tone}`}
                >
                  <StatusIcon className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />
                  {status.label}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
