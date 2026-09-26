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
  | "transaction_recategorized"
  | "budget_changed"
  | "goal_created"
  | "goal_contribution_added"
  | "recurring_marked"
  | "insight_detected"
  | "insight_dismissed"
  | "insight_reopened"
  | "preferences_changed"
  | "debt_terms_saved"
  | "holding_changed"
  | "planned_item_added"
  | "scenario_saved"
  | "long_term_changed"
  | "data_imported"
  | "system_notifications_changed"
  | "simplefin_connected"
  | "simplefin_disconnected"
  | "account_synced_added"
  | "account_synced"
  | "data_exported"
  | "ai_chat_changed"
  | "ai_message_sent";

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
