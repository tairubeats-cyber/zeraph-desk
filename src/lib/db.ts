/**
 * The only place that touches SQLite. Components never write SQL.
 *
 * Backed by `tauri-plugin-sql` against the file created from
 * `src-tauri/migrations/001_init.sql`. One connection, opened lazily and
 * reused for the life of the window.
 */
import Database from "@tauri-apps/plugin-sql";
import type { Action, ActionKind, ActionPayload, ActionStatus } from "./actions";
import type { Contact, Thread, Channel, Message } from "./types";
import { type BusinessFacts, EMPTY_FACTS } from "./facts";
import { type Event, type EventKind, newEvent } from "./events";
import type {
  Autopay,
  Budget,
  Category,
  CategoryKind,
  Frequency,
  Goal,
  GoalContribution,
  GoalKind,
  ManualRecurring,
  Necessity,
  RecurringMark,
  RecurringStatus,
  TransactionOverride,
} from "./finance/types";
import { DEFAULT_CATEGORIES } from "./finance/categories";
import { FIXTURE_ACTIONS, FIXTURE_CONTACTS, FIXTURE_THREADS } from "./fixtures";

const DB_PATH = "sqlite:zeraph.db";
const FACTS_KEY = "business_facts";
const SYNC_CURSOR_KEY = "mail_sync_cursor";
const SEAT_TOKEN_KEY = "seat_token";

interface ContactRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  first_seen: string;
  last_seen: string;
  tags: string;
}

interface ThreadRow {
  id: string;
  contact_id: string;
  channel: string;
  subject: string;
  intent: string;
  status: string;
  last_message_at: string;
}

interface ActionRow {
  id: string;
  kind: string;
  thread_id: string | null;
  rationale: string;
  payload: string;
  citations: string;
  status: string;
  created_at: string;
  decided_at: string | null;
  decline_reason: string | null;
}

interface EventRow {
  id: string;
  kind: string;
  subject_id: string | null;
  at: string;
  meta: string;
}

interface MessageRow {
  id: string;
  thread_id: string;
  direction: string;
  body: string;
  sent_at: string;
  from_action_id: string | null;
  message_id: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
  kind: string;
  position: number;
  hidden: number;
}

interface OverrideRow {
  tx_id: string;
  category_id: string | null;
  note: string;
  flagged: number;
}

function rowToContact(r: ContactRow): Contact {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    tags: JSON.parse(r.tags) as string[],
  };
}

function rowToThread(r: ThreadRow): Thread {
  return {
    id: r.id,
    contactId: r.contact_id,
    channel: r.channel as Channel,
    subject: r.subject,
    intent: r.intent as Thread["intent"],
    status: r.status as Thread["status"],
    lastMessageAt: r.last_message_at,
  };
}

function rowToAction(r: ActionRow): Action {
  return {
    id: r.id,
    kind: r.kind as ActionKind,
    threadId: r.thread_id,
    rationale: r.rationale,
    payload: JSON.parse(r.payload) as ActionPayload,
    citations: JSON.parse(r.citations) as Action["citations"],
    status: r.status as ActionStatus,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    declineReason: r.decline_reason,
  };
}

function rowToEvent(r: EventRow): Event {
  return {
    id: r.id,
    kind: r.kind as EventKind,
    subjectId: r.subject_id,
    at: r.at,
    meta: JSON.parse(r.meta) as Event["meta"],
  };
}

function rowToMessage(r: MessageRow): Message {
  return {
    id: r.id,
    threadId: r.thread_id,
    direction: r.direction as Message["direction"],
    body: r.body,
    sentAt: r.sent_at,
    fromActionId: r.from_action_id,
    messageId: r.message_id,
  };
}

/** Columns an `updateAction` patch may touch, in the shape the table expects. */
const ACTION_COLUMNS: Partial<Record<keyof Action, string>> = {
  kind: "kind",
  threadId: "thread_id",
  rationale: "rationale",
  payload: "payload",
  citations: "citations",
  status: "status",
  createdAt: "created_at",
  decidedAt: "decided_at",
  declineReason: "decline_reason",
};

const JSON_ACTION_FIELDS = new Set<keyof Action>(["payload", "citations"]);

/** Columns an `updateThread` patch may touch. */
const THREAD_COLUMNS: Partial<Record<keyof Thread, string>> = {
  contactId: "contact_id",
  channel: "channel",
  subject: "subject",
  intent: "intent",
  status: "status",
  lastMessageAt: "last_message_at",
};

let connection: Promise<Database> | null = null;

function open(): Promise<Database> {
  if (!connection) {
    connection = Database.load(DB_PATH).then(async (handle) => {
      await seedIfEmpty(handle);
      return handle;
    });
  }
  return connection;
}

/**
 * First run only: seed the same demo data the app has always shown, now as
 * real rows instead of an in-memory array. Once a real inbox is wired
 * (BUILD-PLAN step 5), this seed is what real pulled email replaces.
 */
async function seedIfEmpty(handle: Database): Promise<void> {
  const [row] = await handle.select<{ count: number }[]>("SELECT COUNT(*) as count FROM actions");
  if (row.count > 0) return;

  for (const c of FIXTURE_CONTACTS) {
    await handle.execute(
      `INSERT INTO contacts (id, name, email, phone, first_seen, last_seen, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [c.id, c.name, c.email, c.phone, c.firstSeen, c.lastSeen, JSON.stringify(c.tags)],
    );
  }
  for (const t of FIXTURE_THREADS) {
    await handle.execute(
      `INSERT INTO threads (id, contact_id, channel, subject, intent, status, last_message_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [t.id, t.contactId, t.channel, t.subject, t.intent, t.status, t.lastMessageAt],
    );
  }
  for (const a of FIXTURE_ACTIONS) {
    await handle.execute(
      `INSERT INTO actions (id, kind, thread_id, rationale, payload, citations, status, created_at, decided_at, decline_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        a.id,
        a.kind,
        a.threadId,
        a.rationale,
        JSON.stringify(a.payload),
        JSON.stringify(a.citations),
        a.status,
        a.createdAt,
        a.decidedAt,
        a.declineReason,
      ],
    );
  }
}

export const db = {
  async pendingActions(): Promise<Action[]> {
    const handle = await open();
    const rows = await handle.select<ActionRow[]>(
      "SELECT * FROM actions WHERE status = 'pending' ORDER BY created_at ASC",
    );
    return rows.map(rowToAction);
  },

  async recentActions(limit = 50): Promise<Action[]> {
    const handle = await open();
    const rows = await handle.select<ActionRow[]>(
      "SELECT * FROM actions WHERE status != 'pending' ORDER BY decided_at DESC LIMIT $1",
      [limit],
    );
    return rows.map(rowToAction);
  },

  async updateAction(id: string, patch: Partial<Action>): Promise<void> {
    const keys = (Object.keys(patch) as (keyof Action)[]).filter((k) => k !== "id" && ACTION_COLUMNS[k]);
    if (keys.length === 0) return;

    const handle = await open();
    const sets: string[] = [];
    const values: unknown[] = [];
    keys.forEach((key, i) => {
      sets.push(`${ACTION_COLUMNS[key]} = $${i + 1}`);
      const value = patch[key];
      values.push(JSON_ACTION_FIELDS.has(key) ? JSON.stringify(value) : value);
    });
    values.push(id);
    await handle.execute(`UPDATE actions SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
  },

  /** Insert a brand-new action, e.g. a reply proposed from an inbound email. */
  async queueAction(action: Action): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO actions (id, kind, thread_id, rationale, payload, citations, status, created_at, decided_at, decline_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        action.id,
        action.kind,
        action.threadId,
        action.rationale,
        JSON.stringify(action.payload),
        JSON.stringify(action.citations),
        action.status,
        action.createdAt,
        action.decidedAt,
        action.declineReason,
      ],
    );
  },

  async contacts(): Promise<Contact[]> {
    const handle = await open();
    const rows = await handle.select<ContactRow[]>("SELECT * FROM contacts ORDER BY first_seen ASC");
    return rows.map(rowToContact);
  },

  /**
   * Insert a contact pulled from mail, or return the existing one if this
   * email address is already known. Email is the only reliable dedupe key
   * a connector can offer.
   */
  async upsertContact(contact: Contact): Promise<Contact> {
    const handle = await open();
    if (contact.email) {
      const existing = await handle.select<ContactRow[]>("SELECT * FROM contacts WHERE email = $1", [
        contact.email,
      ]);
      if (existing.length > 0) {
        await handle.execute("UPDATE contacts SET last_seen = $1 WHERE id = $2", [
          contact.lastSeen,
          existing[0].id,
        ]);
        return rowToContact({ ...existing[0], last_seen: contact.lastSeen });
      }
    }
    await handle.execute(
      `INSERT INTO contacts (id, name, email, phone, first_seen, last_seen, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        contact.id,
        contact.name,
        contact.email,
        contact.phone,
        contact.firstSeen,
        contact.lastSeen,
        JSON.stringify(contact.tags),
      ],
    );
    return contact;
  },

  async contact(id: string): Promise<Contact | null> {
    const handle = await open();
    const rows = await handle.select<ContactRow[]>("SELECT * FROM contacts WHERE id = $1", [id]);
    return rows.length ? rowToContact(rows[0]) : null;
  },

  async threads(): Promise<Thread[]> {
    const handle = await open();
    const rows = await handle.select<ThreadRow[]>("SELECT * FROM threads ORDER BY last_message_at DESC");
    return rows.map(rowToThread);
  },

  async insertThread(thread: Thread): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO threads (id, contact_id, channel, subject, intent, status, last_message_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [thread.id, thread.contactId, thread.channel, thread.subject, thread.intent, thread.status, thread.lastMessageAt],
    );
  },

  async updateThread(id: string, patch: Partial<Thread>): Promise<void> {
    const keys = (Object.keys(patch) as (keyof Thread)[]).filter((k) => k !== "id" && THREAD_COLUMNS[k]);
    if (keys.length === 0) return;

    const handle = await open();
    const sets: string[] = [];
    const values: unknown[] = [];
    keys.forEach((key, i) => {
      sets.push(`${THREAD_COLUMNS[key]} = $${i + 1}`);
      values.push(patch[key]);
    });
    values.push(id);
    await handle.execute(`UPDATE threads SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
  },

  async messages(threadId: string): Promise<Message[]> {
    const handle = await open();
    const rows = await handle.select<MessageRow[]>(
      "SELECT * FROM messages WHERE thread_id = $1 ORDER BY sent_at ASC",
      [threadId],
    );
    return rows.map(rowToMessage);
  },

  async insertMessage(message: Message): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO messages (id, thread_id, direction, body, sent_at, from_action_id, message_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [message.id, message.threadId, message.direction, message.body, message.sentAt, message.fromActionId, message.messageId],
    );
  },

  /**
   * Open threads whose last message is ours, sent before `cutoffIso`, and
   * that have never had a follow-up proposed — "one follow-up nudge," not a
   * repeating reminder.
   */
  async threadsAwaitingFollowUp(cutoffIso: string): Promise<Thread[]> {
    const handle = await open();
    const rows = await handle.select<ThreadRow[]>(
      `SELECT t.* FROM threads t
       WHERE t.status = 'open'
       AND t.id IN (
         SELECT m1.thread_id FROM messages m1
         WHERE m1.direction = 'out'
         AND m1.sent_at = (SELECT MAX(m2.sent_at) FROM messages m2 WHERE m2.thread_id = m1.thread_id)
         AND m1.sent_at <= $1
       )
       AND t.id NOT IN (SELECT thread_id FROM actions WHERE kind = 'follow_up' AND thread_id IS NOT NULL)`,
      [cutoffIso],
    );
    return rows.map(rowToThread);
  },

  async facts(): Promise<BusinessFacts> {
    const handle = await open();
    const rows = await handle.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", [
      FACTS_KEY,
    ]);
    return rows.length ? (JSON.parse(rows[0].value) as BusinessFacts) : { ...EMPTY_FACTS };
  },

  /** One row in `settings`. Written during setup, read on every draft. */
  async saveFacts(next: BusinessFacts): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [FACTS_KEY, JSON.stringify(next)],
    );
  },

  /** The IMAP UID watermark from the last successful pull. Null before the first. */
  async syncCursor(): Promise<string | null> {
    const handle = await open();
    const rows = await handle.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", [
      SYNC_CURSOR_KEY,
    ]);
    return rows.length ? rows[0].value : null;
  },

  async saveSyncCursor(cursor: string): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [SYNC_CURSOR_KEY, cursor],
    );
  },

  /** Issued by hand per BUILD-PLAN step 3. Authenticates calls to the proxy, not to mail. */
  async seatToken(): Promise<string | null> {
    const handle = await open();
    const rows = await handle.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", [
      SEAT_TOKEN_KEY,
    ]);
    return rows.length ? rows[0].value : null;
  },

  async saveSeatToken(token: string): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [SEAT_TOKEN_KEY, token],
    );
  },

  // --- Finance. Only the user's own choices are stored; account and transaction data comes from a provider. ---

  /** The user's categories. First call writes the defaults, after which the database is the source of truth. */
  async finCategories(): Promise<Category[]> {
    const handle = await open();
    let rows = await handle.select<CategoryRow[]>("SELECT * FROM fin_categories ORDER BY position ASC");
    if (rows.length === 0) {
      for (const [i, c] of DEFAULT_CATEGORIES.entries()) {
        await handle.execute(
          "INSERT INTO fin_categories (id, name, kind, position, hidden) VALUES ($1, $2, $3, $4, 0)",
          [c.id, c.name, c.kind, i],
        );
      }
      rows = await handle.select<CategoryRow[]>("SELECT * FROM fin_categories ORDER BY position ASC");
    }
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind as CategoryKind,
      position: r.position,
      hidden: r.hidden === 1,
    }));
  },

  async saveCategory(c: Category): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO fin_categories (id, name, kind, position, hidden) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind,
         position = excluded.position, hidden = excluded.hidden`,
      [c.id, c.name, c.kind, c.position, c.hidden ? 1 : 0],
    );
  },

  async finOverrides(): Promise<TransactionOverride[]> {
    const handle = await open();
    const rows = await handle.select<OverrideRow[]>("SELECT * FROM fin_tx_overrides");
    return rows.map((r) => ({
      txId: r.tx_id,
      categoryId: r.category_id,
      note: r.note,
      flagged: r.flagged === 1,
    }));
  },

  async saveOverride(o: TransactionOverride): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO fin_tx_overrides (tx_id, category_id, note, flagged, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(tx_id) DO UPDATE SET category_id = excluded.category_id, note = excluded.note,
         flagged = excluded.flagged, updated_at = excluded.updated_at`,
      [o.txId, o.categoryId, o.note, o.flagged ? 1 : 0, new Date().toISOString()],
    );
  },

  // --- Finance phase 2: budgets, goals, recurring marks. Again only the user's own choices. ---

  async budgets(): Promise<Budget[]> {
    const handle = await open();
    const rows = await handle.select<{ category_id: string; amount_cents: number }[]>(
      "SELECT category_id, amount_cents FROM fin_budgets",
    );
    return rows.map((r) => ({ categoryId: r.category_id, amountCents: r.amount_cents }));
  },

  async saveBudget(categoryId: string, amountCents: number): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO fin_budgets (category_id, amount_cents, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT(category_id) DO UPDATE SET amount_cents = excluded.amount_cents, updated_at = excluded.updated_at`,
      [categoryId, amountCents, new Date().toISOString()],
    );
  },

  async deleteBudget(categoryId: string): Promise<void> {
    const handle = await open();
    await handle.execute("DELETE FROM fin_budgets WHERE category_id = $1", [categoryId]);
  },

  async goals(): Promise<Goal[]> {
    const handle = await open();
    const rows = await handle.select<
      {
        id: string;
        name: string;
        kind: string;
        target_cents: number;
        start_cents: number;
        deadline: string | null;
        monthly_plan_cents: number;
        created_at: string;
      }[]
    >("SELECT * FROM fin_goals ORDER BY created_at ASC");
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind as GoalKind,
      targetCents: r.target_cents,
      startCents: r.start_cents,
      deadline: r.deadline,
      monthlyPlanCents: r.monthly_plan_cents,
      createdAt: r.created_at,
    }));
  },

  async saveGoal(g: Goal): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO fin_goals (id, name, kind, target_cents, start_cents, deadline, monthly_plan_cents, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, target_cents = excluded.target_cents,
         start_cents = excluded.start_cents, deadline = excluded.deadline, monthly_plan_cents = excluded.monthly_plan_cents`,
      [g.id, g.name, g.kind, g.targetCents, g.startCents, g.deadline, g.monthlyPlanCents, g.createdAt],
    );
  },

  async deleteGoal(id: string): Promise<void> {
    const handle = await open();
    await handle.execute("DELETE FROM fin_goal_contributions WHERE goal_id = $1", [id]);
    await handle.execute("DELETE FROM fin_goals WHERE id = $1", [id]);
  },

  async goalContributions(): Promise<GoalContribution[]> {
    const handle = await open();
    const rows = await handle.select<
      { id: string; goal_id: string; amount_cents: number; date: string; note: string }[]
    >("SELECT * FROM fin_goal_contributions ORDER BY date DESC");
    return rows.map((r) => ({ id: r.id, goalId: r.goal_id, amountCents: r.amount_cents, date: r.date, note: r.note }));
  },

  async addGoalContribution(c: GoalContribution): Promise<void> {
    const handle = await open();
    await handle.execute(
      "INSERT INTO fin_goal_contributions (id, goal_id, amount_cents, date, note) VALUES ($1, $2, $3, $4, $5)",
      [c.id, c.goalId, c.amountCents, c.date, c.note],
    );
  },

  async deleteGoalContribution(id: string): Promise<void> {
    const handle = await open();
    await handle.execute("DELETE FROM fin_goal_contributions WHERE id = $1", [id]);
  },

  async recurringMarks(): Promise<RecurringMark[]> {
    const handle = await open();
    const rows = await handle.select<
      { key: string; status: string; necessity: string; autopay: string; is_bill: number | null }[]
    >("SELECT * FROM fin_recurring_marks");
    return rows.map((r) => ({
      key: r.key,
      status: r.status as RecurringStatus,
      necessity: r.necessity as Necessity,
      autopay: r.autopay as Autopay,
      isBill: r.is_bill === null ? null : r.is_bill === 1,
    }));
  },

  async saveRecurringMark(m: RecurringMark): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO fin_recurring_marks (key, status, necessity, autopay, is_bill) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(key) DO UPDATE SET status = excluded.status, necessity = excluded.necessity,
         autopay = excluded.autopay, is_bill = excluded.is_bill`,
      [m.key, m.status, m.necessity, m.autopay, m.isBill === null ? null : m.isBill ? 1 : 0],
    );
  },

  async manualRecurring(): Promise<ManualRecurring[]> {
    const handle = await open();
    const rows = await handle.select<
      {
        id: string;
        name: string;
        amount_cents: number;
        direction: string;
        frequency: string;
        next_date: string;
        category_id: string;
      }[]
    >("SELECT * FROM fin_recurring_manual");
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      amountCents: r.amount_cents,
      direction: r.direction as ManualRecurring["direction"],
      frequency: r.frequency as Frequency,
      nextDate: r.next_date,
      categoryId: r.category_id,
    }));
  },

  async saveManualRecurring(m: ManualRecurring): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO fin_recurring_manual (id, name, amount_cents, direction, frequency, next_date, category_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, amount_cents = excluded.amount_cents,
         direction = excluded.direction, frequency = excluded.frequency, next_date = excluded.next_date,
         category_id = excluded.category_id`,
      [m.id, m.name, m.amountCents, m.direction, m.frequency, m.nextDate, m.categoryId],
    );
  },

  async deleteManualRecurring(id: string): Promise<void> {
    const handle = await open();
    await handle.execute("DELETE FROM fin_recurring_manual WHERE id = $1", [id]);
    await handle.execute("DELETE FROM fin_recurring_marks WHERE key = $1", [`manual:${id}`]);
  },

  async log(...entries: Event[]): Promise<void> {
    if (entries.length === 0) return;
    const handle = await open();
    for (const e of entries) {
      await handle.execute(
        `INSERT INTO events (id, kind, subject_id, at, meta) VALUES ($1, $2, $3, $4, $5)`,
        [e.id, e.kind, e.subjectId, e.at, JSON.stringify(e.meta)],
      );
    }
  },

  async events(): Promise<Event[]> {
    const handle = await open();
    const rows = await handle.select<EventRow[]>("SELECT * FROM events ORDER BY at ASC");
    return rows.map(rowToEvent);
  },
};

export { newEvent };
