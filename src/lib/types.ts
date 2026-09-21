// Core shapes. Connectors normalize into these; the UI only ever reads these.

export type ID = string;

export type Channel = "email" | "form" | "sms" | "dm";

export interface Contact {
  id: ID;
  name: string | null;
  email: string | null;
  phone: string | null;
  firstSeen: string; // ISO
  lastSeen: string;
  tags: string[];
}

export interface Thread {
  id: ID;
  contactId: ID;
  channel: Channel;
  subject: string;
  /** What this thread is, decided once on arrival. */
  intent: "new_inquiry" | "existing_customer" | "vendor" | "noise" | "unknown";
  status: "open" | "waiting_on_customer" | "closed";
  lastMessageAt: string;
}

export interface Message {
  id: ID;
  threadId: ID;
  direction: "in" | "out";
  body: string;
  sentAt: string;
  /** Set when this message was produced by an approved action. */
  fromActionId: ID | null;
  /** RFC822 Message-ID header. Null for messages that predate this column. */
  messageId: string | null;
}

/**
 * Kept so the Action shape doesn't change when Phase 2 lands, but v1 grounds
 * drafts on the business facts sheet, so citations stay empty.
 */
export interface Citation {
  documentId: ID;
  documentTitle: string;
  chunkId: ID;
}
