import type { ID, Citation } from "./types";

/**
 * The closed vocabulary of things this app can do.
 * Every feature is a member of this union. Nothing side-effectful lives
 * outside it. Phase 4 recipes compile down to exactly these kinds.
 */
export type ActionKind =
  | "draft_reply"
  | "answer_question"
  | "build_quote"
  | "schedule"
  | "follow_up"
  | "request_review";

export type ActionStatus = "pending" | "approved" | "sent" | "declined" | "failed";

export interface Action {
  id: ID;
  kind: ActionKind;
  threadId: ID | null;
  /** Plain English, shown to the owner. If you can't write it, the action is too vague. */
  rationale: string;
  /** What will actually be sent or produced, editable before approval. */
  payload: ActionPayload;
  /** Documents the draft leaned on. Empty until Phase 2. */
  citations: Citation[];
  status: ActionStatus;
  createdAt: string;
  decidedAt: string | null;
  /** Owner's words when they decline. Training signal later. */
  declineReason: string | null;
}

export type ActionPayload =
  | { kind: "draft_reply"; to: string; subject: string; body: string; inReplyTo: string | null }
  | { kind: "answer_question"; question: string; answer: string }
  | { kind: "build_quote"; lineItems: QuoteLine[]; total: number; notes: string }
  | { kind: "schedule"; startsAt: string; durationMinutes: number; title: string }
  | { kind: "follow_up"; to: string; body: string; sendAfter: string; inReplyTo: string | null }
  | { kind: "request_review"; to: string; body: string; link: string };

export interface QuoteLine {
  description: string;
  quantity: number;
  unitPrice: number;
}

export const ACTION_LABELS: Record<ActionKind, string> = {
  draft_reply: "Reply",
  answer_question: "Answer",
  build_quote: "Quote",
  schedule: "Booking",
  follow_up: "Follow-up",
  request_review: "Review request",
};

/** Verb shown on the approve button, and in the toast after. Keep them matched. */
export const APPROVE_VERB: Record<ActionKind, { do: string; done: string }> = {
  draft_reply: { do: "Send reply", done: "Reply sent" },
  answer_question: { do: "Keep answer", done: "Answer kept" },
  build_quote: { do: "Send quote", done: "Quote sent" },
  schedule: { do: "Book it", done: "Booked" },
  follow_up: { do: "Schedule follow-up", done: "Follow-up scheduled" },
  request_review: { do: "Ask for review", done: "Review requested" },
};

/**
 * Switched on in v1. The rest of the vocabulary stays defined so the spine
 * doesn't change later, but nothing proposes them yet. Don't turn one on
 * without a customer asking for it.
 */
export const V1_ACTIONS: ActionKind[] = ["draft_reply", "follow_up"];
