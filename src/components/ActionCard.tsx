import { useState } from "react";
import { type Action, ACTION_LABELS, APPROVE_VERB } from "../lib/actions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";

interface Props {
  action: Action;
  onApprove: (action: Action, editedBody: string) => void | Promise<void>;
  onDecline: (action: Action, reason: string) => void | Promise<void>;
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
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const verb = APPROVE_VERB[action.kind];
  const to = recipientOf(action);

  // Sending takes a moment. Block a second click so nothing goes out twice.
  async function run(kind: "approve" | "decline", fn: () => void | Promise<void>) {
    if (busy) return;
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      as="article"
      aria-label={`${ACTION_LABELS[action.kind]}${to ? ` to ${to}` : ""}`}
      className="animate-fade-in p-5 transition-shadow duration-200 ease-standard focus-within:shadow-elevated md:p-6"
    >
      <>
        <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="inline-flex h-6 items-center rounded-full bg-surface-secondary px-2.5 text-meta font-medium text-ink-secondary">
            {ACTION_LABELS[action.kind]}
          </span>
          {to && <span className="min-w-0 truncate text-body text-ink-secondary">to {to}</span>}
          <time dateTime={action.createdAt} className="ml-auto text-meta text-ink-tertiary">
            {new Date(action.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </time>
        </header>

        <p className="mt-3 max-w-[68ch] text-label font-normal text-ink-tertiary">{action.rationale}</p>

        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={Math.min(14, body.split("\n").length + 2)}
          className="mt-4 resize-y"
          aria-label="Message text, editable before you approve it"
        />

        {action.citations.length > 0 && (
          <p className="mt-2 text-meta text-ink-tertiary">
            Priced from {action.citations.map((c) => c.documentTitle).join(", ")}
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2 max-md:flex-col-reverse max-md:items-stretch">
          <Button
            variant="tertiary"
            onClick={() => setDeclining((v) => !v)}
            aria-expanded={declining}
            disabled={busy !== null}
          >
            Skip
          </Button>
          <Button
            variant="primary"
            loading={busy === "approve"}
            disabled={busy === "decline"}
            onClick={() => void run("approve", () => onApprove(action, body))}
          >
            {verb.do}
          </Button>
        </div>

        {declining && (
          <div className="mt-3 flex animate-fade-in gap-2 max-md:flex-col">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What was wrong with it? (optional)"
              aria-label="Why you're skipping this"
              className="flex-1"
            />
            <Button
              variant="secondary"
              loading={busy === "decline"}
              disabled={busy === "approve"}
              onClick={() => void run("decline", () => onDecline(action, reason))}
            >
              Skip it
            </Button>
          </div>
        )}
      </>
    </Card>
  );
}
