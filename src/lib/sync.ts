/**
 * Ties the spine together for the email channel: pull new mail, classify
 * each new thread, and queue a draft for anything that's clearly a new
 * inquiry. Called on an interval from App.tsx — this is where the logic
 * lives, not there.
 */
import { db, newEvent } from "./db";
import { emailConnector } from "../connectors/email";
import { classify, proposeReply, proposeFollowUp } from "./draft";
import { TRADES } from "./trades";

/** Below this, classify() isn't sure enough to act on — see CLAUDE.md's "nothing leaves the machine without a human click." */
const CONFIDENCE_FLOOR = 0.6;

export interface SyncResult {
  pulled: number;
  queued: number;
}

export async function syncInbox(): Promise<SyncResult> {
  if (!(await emailConnector.isConnected())) return { pulled: 0, queued: 0 };

  const seatToken = await db.seatToken();
  if (!seatToken) return { pulled: 0, queued: 0 };

  const cursor = await db.syncCursor();
  const pulled = await emailConnector.pull(cursor);

  const emailByContactId = new Map(pulled.contacts.map((c) => [c.id, c.email]));
  const resolvedContactIds = new Map<string, string>();
  for (const contact of pulled.contacts) {
    const resolved = await db.upsertContact(contact);
    resolvedContactIds.set(contact.id, resolved.id);
  }

  for (const thread of pulled.threads) {
    const contactId = resolvedContactIds.get(thread.contactId) ?? thread.contactId;
    await db.insertThread({ ...thread, contactId });
  }

  for (const message of pulled.messages) {
    await db.insertMessage(message);
    await db.log(newEvent("message_received", message.threadId, { channel: "email" }));
  }

  const facts = await db.facts();
  const profile = TRADES.home_services;
  let queued = 0;

  for (const thread of pulled.threads) {
    const message = pulled.messages.find((m) => m.threadId === thread.id && m.direction === "in");
    if (!message) continue;

    const classification = await classify(message.body, profile, seatToken);
    await db.updateThread(thread.id, { intent: classification.intent });
    await db.log(
      newEvent("thread_classified", thread.id, {
        intent: classification.intent,
        confidence: classification.confidence,
      }),
    );

    if (classification.confidence < CONFIDENCE_FLOOR) continue;
    if (classification.intent !== "new_inquiry") continue;

    const fromEmail = emailByContactId.get(thread.contactId) ?? "";
    const action = await proposeReply({
      thread: { id: thread.id, subject: thread.subject, from: fromEmail },
      message: message.body,
      inReplyTo: message.messageId,
      profile,
      facts,
      seatToken,
    });
    await db.queueAction(action);
    await db.log(newEvent("action_proposed", action.id, { kind: action.kind }));
    queued++;
  }

  if (pulled.cursor) await db.saveSyncCursor(pulled.cursor);

  return { pulled: pulled.messages.length, queued };
}

/**
 * One nudge per thread, per BUILD-PLAN step 6: threads we replied to and
 * haven't heard back from in `followUpAfterHours` get a follow_up drafted
 * and queued — never sent on their own, same as everything else.
 */
export async function proposeFollowUps(): Promise<{ queued: number }> {
  const seatToken = await db.seatToken();
  if (!seatToken) return { queued: 0 };

  const profile = TRADES.home_services;
  const cutoff = new Date(Date.now() - profile.followUpAfterHours * 60 * 60 * 1000).toISOString();
  const threads = await db.threadsAwaitingFollowUp(cutoff);
  if (threads.length === 0) return { queued: 0 };

  const facts = await db.facts();
  let queued = 0;

  for (const thread of threads) {
    const contact = await db.contact(thread.contactId);
    if (!contact?.email) continue;

    const messages = await db.messages(thread.id);
    const conversation = messages.map((m) => `${m.direction === "in" ? "Customer" : "You"}: ${m.body}`).join("\n\n");
    const lastInbound = [...messages].reverse().find((m) => m.direction === "in");

    const action = await proposeFollowUp({
      thread: { id: thread.id, subject: thread.subject, to: contact.email },
      conversation,
      inReplyTo: lastInbound?.messageId ?? null,
      profile,
      facts,
      seatToken,
    });
    await db.queueAction(action);
    await db.log(newEvent("action_proposed", action.id, { kind: action.kind }));
    queued++;
  }

  return { queued };
}
