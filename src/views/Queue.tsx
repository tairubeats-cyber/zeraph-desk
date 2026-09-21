import type { Action } from "../lib/actions";
import { ActionCard } from "../components/ActionCard";

interface Props {
  actions: Action[];
  onApprove: (action: Action, body: string) => void;
  onDecline: (action: Action, reason: string) => void;
}

export function Queue({ actions, onApprove, onDecline }: Props) {
  if (actions.length === 0) {
    return (
      <div className="mx-auto max-w-[60ch] pt-24 text-center">
        <h1 className="font-display text-4xl text-ink">Nothing waiting</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          New inquiries land here with a reply already written. You read it, change what you
          want, and send.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-4xl text-ink">
        {actions.length} {actions.length === 1 ? "reply" : "replies"} waiting
      </h1>
      <p className="mt-2 text-sm text-ink-soft">Oldest first. Edit anything before you send it.</p>

      <div className="mt-10">
        {actions.map((action) => (
          <ActionCard key={action.id} action={action} onApprove={onApprove} onDecline={onDecline} />
        ))}
      </div>
    </div>
  );
}
