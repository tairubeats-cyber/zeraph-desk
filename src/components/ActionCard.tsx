import { useState } from "react";
import { type Action, ACTION_LABELS, APPROVE_VERB } from "../lib/actions";

interface Props {
  action: Action;
  onApprove: (action: Action, editedBody: string) => void;
  onDecline: (action: Action, reason: string) => void;
}

function bodyOf(action: Action): string {
  const p = action.payload;
  switch (p.kind) {
    case "draft_reply":
      return p.body;
    case "follow_up":
      return p.body;
    case "request_review":
      return p.body;
    case "answer_question":
      return p.answer;
    case "build_quote":
      return p.notes;
    case "schedule":
      return `${p.title} — ${new Date(p.startsAt).toLocaleString()}`;
  }
}

function recipientOf(action: Action): string | null {
  const p = action.payload;
  return "to" in p ? p.to : null;
}

export function ActionCard({ action, onApprove, onDecline }: Props) {
  const [body, setBody] = useState(bodyOf(action));
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const verb = APPROVE_VERB[action.kind];
  const to = recipientOf(action);

  return (
    <article className="border-b border-paper-edge py-8 first:pt-0">
      <header className="flex items-baseline gap-3">
        <span className="text-sm font-medium text-ink">{ACTION_LABELS[action.kind]}</span>
        {to && <span className="text-sm text-ink-soft">to {to}</span>}
        <span className="ml-auto text-xs text-ink-soft">
          {new Date(action.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
      </header>

      <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-ink-soft">{action.rationale}</p>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={Math.min(14, body.split("\n").length + 2)}
        className="mt-4 w-full max-w-[72ch] resize-y rounded-md border border-paper-edge bg-white px-4 py-3 text-sm leading-relaxed text-ink"
        aria-label="Message text, editable before you approve it"
      />

      {action.citations.length > 0 && (
        <p className="mt-2 text-xs text-ink-soft">
          Priced from {action.citations.map((c) => c.documentTitle).join(", ")}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => onApprove(action, body)}
          className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy-900 hover:bg-gold-deep hover:text-paper"
        >
          {verb.do}
        </button>
        <button
          onClick={() => setDeclining((v) => !v)}
          className="rounded-md px-3 py-2 text-sm text-ink-soft hover:text-ink"
        >
          Skip
        </button>
      </div>

      {declining && (
        <div className="mt-3 flex max-w-[72ch] gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What was wrong with it?"
            className="flex-1 rounded-md border border-paper-edge bg-white px-3 py-2 text-sm"
          />
          <button
            onClick={() => onDecline(action, reason)}
            className="rounded-md border border-paper-edge px-3 py-2 text-sm text-ink-soft hover:text-ink"
          >
            Skip it
          </button>
        </div>
      )}
    </article>
  );
}
