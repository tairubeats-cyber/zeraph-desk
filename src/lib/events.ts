import type { ID } from "./types";

/**
 * Append-only log. Looks unused in Phase 1 — it is not.
 * Phase 3 renders the dashboard from it. Phase 4 triggers recipes off it.
 * Never write secrets or full customer records here; ids and kinds only.
 */
export type EventKind =
  | "message_received"
  | "thread_classified"
  | "action_proposed"
  | "action_approved"
  | "action_declined"
  | "action_sent"
  | "action_failed"
  | "document_indexed"
  | "transaction_recategorized";

export interface Event {
  id: ID;
  kind: EventKind;
  subjectId: ID | null; // thread, action, or document id
  at: string;
  meta: Record<string, string | number>;
}

export function newEvent(
  kind: EventKind,
  subjectId: ID | null,
  meta: Record<string, string | number> = {},
): Event {
  return { id: crypto.randomUUID(), kind, subjectId, at: new Date().toISOString(), meta };
}
