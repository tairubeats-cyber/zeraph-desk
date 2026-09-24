import { Inbox } from "lucide-react";
import type { Action } from "../lib/actions";
import { ActionCard } from "../components/ActionCard";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { FloatingPathsBackground } from "@/components/ui/floating-paths";

interface Props {
  actions: Action[];
  onApprove: (action: Action, body: string) => void | Promise<void>;
  onDecline: (action: Action, reason: string) => void | Promise<void>;
}

export function Queue({ actions, onApprove, onDecline }: Props) {
  if (actions.length === 0) {
    return (
      <FloatingPathsBackground
        position={-1}
        className="min-h-[70vh] [&>div:first-child]:opacity-60 [&>div:first-child]:[mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,black_20%,transparent_100%)]"
      >
        <EmptyState
          icon={<Inbox className="h-9 w-9" strokeWidth={1.5} />}
          title="Nothing waiting"
          description="New inquiries land here with a reply already written. You read it, change what you want, and send."
        />
      </FloatingPathsBackground>
    );
  }

  return (
    <div>
      <PageHeader
        title={`${actions.length} ${actions.length === 1 ? "reply" : "replies"} waiting`}
        description="Oldest first. Edit anything before you send it."
      />
      <ul className="space-y-4">
        {actions.map((action) => (
          <li key={action.id}>
            <ActionCard action={action} onApprove={onApprove} onDecline={onDecline} />
          </li>
        ))}
      </ul>
    </div>
  );
}
