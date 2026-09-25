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
import { type FinancePreferences, mergePrefs } from "./finance/prefs";
import { mergeLongTerm } from "./finance/longterm";
import type { InsightState } from "./finance/intel";
import type {
  AccountKind,
  Autopay,
  BalancePoint,
  Budget,
  Category,
  CategoryKind,
  DebtTerms,
  Frequency,
  Goal,
  GoalContribution,
  GoalKind,
  Holding,
  HoldingKind,
  ImportRecord,
  ImportedAccount,
  SyncRun,
  LongTermAssumptions,
  ManualRecurring,
  Necessity,
  PlannedItem,
  RecurringMark,
  RecurringStatus,
  Scenario,
  ScenarioChange,
  Transaction,
  TransactionOverride,
} from "./finance/types";
import { DEFAULT_CATEGORIES } from "./finance/categories";
import { FIXTURE_ACTIONS, FIXTURE_CONTACTS, FIXTURE_THREADS } from "./fixtures";

const DB_PATH = "sqlite:zeraph.db";
const FACTS_KEY = "business_facts";
const SYNC_CURSOR_KEY = "mail_sync_cursor";
const SEAT_TOKEN_KEY = "seat_token";
const FIN_PREFS_KEY = "fin_preferences";
const FIN_LONG_TERM_KEY = "fin_long_term";

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
let categorySeed: Promise<void> | null = null;

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
    // Seed once, and only what's missing. Two loads can arrive together (React's dev double-load, or several
    // screens starting at once); a plain "insert if the table is empty" let each see the other's half-finished
    // work and left categories missing. INSERT OR IGNORE never overwrites an edit, and repairs a table that
    // an earlier launch left short.
    categorySeed ??= (async () => {
      const marks = DEFAULT_CATEGORIES.map((_, i) => `$${i + 1}`).join(", ");
      const [have] = await handle.select<{ count: number }[]>(
        `SELECT COUNT(*) as count FROM fin_categories WHERE id IN (${marks})`,
        DEFAULT_CATEGORIES.map((c) => c.id),
      );
      if (have.count >= DEFAULT_CATEGORIES.length) return;
      for (const [i, c] of DEFAULT_CATEGORIES.entries()) {
        await handle.execute(
          "INSERT OR IGNORE INTO fin_categories (id, name, kind, position, hidden) VALUES ($1, $2, $3, $4, 0)",
          [c.id, c.name, c.kind, i],
        );
      }
    })().catch((err) => {
      categorySeed = null; // a failed seed must be retried, not remembered
      throw err;
    });
    await categorySeed;
    const rows = await handle.select<CategoryRow[]>("SELECT * FROM fin_categories ORDER BY position ASC");
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

  // --- Finance phase 4: debt terms, holdings, planned items, scenarios. Only what the user entered. ---

  async debtTerms(): Promise<DebtTerms[]> {
    const handle = await open();
    const rows = await handle.select<
      {
        account_id: string;
        apr_bps: number | null;
        min_payment_cents: number | null;
        payment_cents: number | null;
        due_day: number | null;
      }[]
    >("SELECT * FROM fin_debt_terms");
    return rows.map((r) => ({
      accountId: r.account_id,
      aprBps: r.apr_bps,
      minPaymentCents: r.min_payment_cents,
      paymentCents: r.payment_cents,
      dueDay: r.due_day,
    }));
  },

  async saveDebtTerms(t: DebtTerms): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO fin_debt_terms (account_id, apr_bps, min_payment_cents, payment_cents, due_day, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT(account_id) DO UPDATE SET apr_bps = excluded.apr_bps, min_payment_cents = excluded.min_payment_cents,
         payment_cents = excluded.payment_cents, due_day = excluded.due_day, updated_at = excluded.updated_at`,
      [t.accountId, t.aprBps, t.minPaymentCents, t.paymentCents, t.dueDay, new Date().toISOString()],
    );
  },

  async deleteDebtTerms(accountId: string): Promise<void> {
    const handle = await open();
    await handle.execute("DELETE FROM fin_debt_terms WHERE account_id = $1", [accountId]);
  },

  async holdings(): Promise<Holding[]> {
    const handle = await open();
    const rows = await handle.select<{ id: string; name: string; kind: string; created_at: string }[]>(
      "SELECT * FROM fin_holdings ORDER BY created_at ASC",
    );
    const values = await handle.select<{ holding_id: string; date: string; value_cents: number }[]>(
      "SELECT * FROM fin_holding_values ORDER BY date ASC",
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind as HoldingKind,
      createdAt: r.created_at,
      values: values.filter((v) => v.holding_id === r.id).map((v) => ({ date: v.date, valueCents: v.value_cents })),
    }));
  },

  async saveHolding(h: Holding): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO fin_holdings (id, name, kind, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind`,
      [h.id, h.name, h.kind, h.createdAt],
    );
  },

  /** A value for a date replaces any earlier one for the same date. */
  async saveHoldingValue(holdingId: string, date: string, valueCents: number): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO fin_holding_values (holding_id, date, value_cents) VALUES ($1, $2, $3)
       ON CONFLICT(holding_id, date) DO UPDATE SET value_cents = excluded.value_cents`,
      [holdingId, date, valueCents],
    );
  },

  async deleteHolding(id: string): Promise<void> {
    const handle = await open();
    await handle.execute("DELETE FROM fin_holding_values WHERE holding_id = $1", [id]);
    await handle.execute("DELETE FROM fin_holdings WHERE id = $1", [id]);
  },

  async plannedItems(): Promise<PlannedItem[]> {
    const handle = await open();
    const rows = await handle.select<
      { id: string; name: string; date: string; amount_cents: number; direction: string }[]
    >("SELECT * FROM fin_planned ORDER BY date ASC");
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      date: r.date,
      amountCents: r.amount_cents,
      direction: r.direction as PlannedItem["direction"],
    }));
  },

  async savePlannedItem(p: PlannedItem): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO fin_planned (id, name, date, amount_cents, direction, created_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, date = excluded.date,
         amount_cents = excluded.amount_cents, direction = excluded.direction`,
      [p.id, p.name, p.date, p.amountCents, p.direction, new Date().toISOString()],
    );
  },

  async deletePlannedItem(id: string): Promise<void> {
    const handle = await open();
    await handle.execute("DELETE FROM fin_planned WHERE id = $1", [id]);
  },

  async scenarios(): Promise<Scenario[]> {
    const handle = await open();
    const rows = await handle.select<
      { id: string; name: string; horizon_months: number; changes: string; created_at: string; updated_at: string }[]
    >("SELECT * FROM fin_scenarios ORDER BY created_at ASC");
    return rows.map((r) => {
      let changes: ScenarioChange[] = [];
      try {
        const parsed: unknown = JSON.parse(r.changes);
        if (Array.isArray(parsed)) changes = parsed as ScenarioChange[];
      } catch {
        /* a damaged scenario opens empty rather than breaking the screen */
      }
      return {
        id: r.id,
        name: r.name,
        horizonMonths: r.horizon_months,
        changes,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  },

  async saveScenario(s: Scenario): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO fin_scenarios (id, name, horizon_months, changes, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, horizon_months = excluded.horizon_months,
         changes = excluded.changes, updated_at = excluded.updated_at`,
      [s.id, s.name, s.horizonMonths, JSON.stringify(s.changes), s.createdAt, s.updatedAt],
    );
  },

  async deleteScenario(id: string): Promise<void> {
    const handle = await open();
    await handle.execute("DELETE FROM fin_scenarios WHERE id = $1", [id]);
  },

  // --- Finance phase 3: preferences and the state of each finding. ---

  async finPreferences(): Promise<FinancePreferences> {
    const handle = await open();
    const rows = await handle.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", [FIN_PREFS_KEY]);
    if (!rows.length) return mergePrefs(null);
    try {
      return mergePrefs(JSON.parse(rows[0].value));
    } catch {
      return mergePrefs(null);
    }
  },

  async saveFinPreferences(prefs: FinancePreferences): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [FIN_PREFS_KEY, JSON.stringify(prefs)],
    );
  },

  // --- Finance phase 6: accounts, transactions and balances the person imported. Read only by the imported provider. ---

  async srcAccountCount(): Promise<number> {
    const handle = await open();
    const rows = await handle.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM fin_src_accounts");
    return rows[0]?.n ?? 0;
  },

  async srcAccounts(): Promise<ImportedAccount[]> {
    const handle = await open();
    const rows = await handle.select<
      {
        id: string;
        name: string;
        kind: string;
        institution: string;
        mask: string | null;
        balance_cents: number;
        created_at: string;
        provider: string | null;
        external_id: string | null;
        owed_positive: number;
      }[]
    >("SELECT * FROM fin_src_accounts ORDER BY created_at ASC");
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind as AccountKind,
      institution: r.institution,
      mask: r.mask,
      balanceCents: r.balance_cents,
      createdAt: r.created_at,
      provider: r.provider === "simplefin" ? "simplefin" : null,
      externalId: r.external_id,
      owedPositive: r.owed_positive === 1,
    }));
  },

  async saveSrcAccount(a: ImportedAccount): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO fin_src_accounts (id, name, kind, institution, mask, balance_cents, created_at, provider, external_id, owed_positive)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, institution = excluded.institution,
         mask = excluded.mask, balance_cents = excluded.balance_cents`,
      [a.id, a.name, a.kind, a.institution, a.mask, a.balanceCents, a.createdAt, a.provider, a.externalId, a.owedPositive ? 1 : 0],
    );
  },

  /** Removes the account and everything imported into it. Notes and category choices on its transactions stay, harmlessly. */
  async deleteSrcAccount(id: string): Promise<void> {
    const handle = await open();
    for (const table of ["fin_src_transactions", "fin_src_balances", "fin_src_imports"]) {
      await handle.execute(`DELETE FROM ${table} WHERE account_id = $1`, [id]);
    }
    await handle.execute("DELETE FROM fin_src_accounts WHERE id = $1", [id]);
  },

  async srcBalances(): Promise<BalancePoint[]> {
    const handle = await open();
    const rows = await handle.select<{ account_id: string; date: string; balance_cents: number }[]>(
      "SELECT * FROM fin_src_balances ORDER BY date ASC",
    );
    return rows.map((r) => ({ accountId: r.account_id, date: r.date, balanceCents: r.balance_cents }));
  },

  /**
   * Record balances for an account, one per day (a day's value replaces an earlier one). The account's own
   * balance is then the one on its latest date, so entering an old balance never overrides a newer one.
   */
  async setSrcBalances(accountId: string, balances: Map<string, number>): Promise<void> {
    if (balances.size === 0) return;
    const handle = await open();
    for (const [date, cents] of balances) {
      await handle.execute(
        `INSERT INTO fin_src_balances (account_id, date, balance_cents) VALUES ($1, $2, $3)
         ON CONFLICT(account_id, date) DO UPDATE SET balance_cents = excluded.balance_cents`,
        [accountId, date, cents],
      );
    }
    await handle.execute(
      `UPDATE fin_src_accounts SET balance_cents =
         (SELECT balance_cents FROM fin_src_balances WHERE account_id = $1 ORDER BY date DESC LIMIT 1)
       WHERE id = $1`,
      [accountId],
    );
  },

  async srcTransactions(): Promise<Transaction[]> {
    const handle = await open();
    const rows = await handle.select<
      { id: string; account_id: string; date: string; merchant: string; description: string; amount_cents: number; category_hint: string | null }[]
    >("SELECT * FROM fin_src_transactions ORDER BY date DESC, id ASC");
    return rows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      date: r.date,
      merchant: r.merchant,
      description: r.description,
      amountCents: r.amount_cents,
      categoryHint: r.category_hint,
      pending: false,
    }));
  },

  /** Adds the rows that aren't already there and returns how many were new. Safe to repeat. */
  async insertSrcTransactions(accountId: string, rows: Transaction[], batchId: string): Promise<number> {
    const handle = await open();
    let added = 0;
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      const marks = part.map((_, k) => `($${k * 8 + 1}, $${k * 8 + 2}, $${k * 8 + 3}, $${k * 8 + 4}, $${k * 8 + 5}, $${k * 8 + 6}, $${k * 8 + 7}, $${k * 8 + 8})`).join(", ");
      const values = part.flatMap((t) => [t.id, accountId, t.date, t.merchant, t.description, t.amountCents, t.categoryHint, batchId]);
      const result = await handle.execute(
        `INSERT OR IGNORE INTO fin_src_transactions (id, account_id, date, merchant, description, amount_cents, category_hint, batch_id) VALUES ${marks}`,
        values,
      );
      added += result.rowsAffected;
    }
    return added;
  },

  async logSrcImport(r: ImportRecord): Promise<void> {
    const handle = await open();
    await handle.execute(
      "INSERT INTO fin_src_imports (id, account_id, at, file_name, rows_total, added, skipped, invalid) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [r.id, r.accountId, r.at, r.fileName, r.rowsTotal, r.added, r.skipped, r.invalid],
    );
  },

  async srcImports(): Promise<ImportRecord[]> {
    const handle = await open();
    const rows = await handle.select<
      { id: string; account_id: string; at: string; file_name: string; rows_total: number; added: number; skipped: number; invalid: number }[]
    >("SELECT * FROM fin_src_imports ORDER BY at DESC");
    return rows.map((r) => ({ id: r.id, accountId: r.account_id, at: r.at, fileName: r.file_name, rowsTotal: r.rows_total, added: r.added, skipped: r.skipped, invalid: r.invalid }));
  },

  async logSyncRun(r: SyncRun): Promise<void> {
    const handle = await open();
    await handle.execute(
      "INSERT INTO fin_sync_runs (id, provider, kind, at, ok, complete, requests, accounts, added, message) VALUES ($1, 'simplefin', $2, $3, $4, $5, $6, $7, $8, $9)",
      [r.id, r.kind, r.at, r.ok ? 1 : 0, r.complete ? 1 : 0, r.requests, r.accounts, r.added, r.message],
    );
  },

  /** Newest first. */
  async syncRuns(): Promise<SyncRun[]> {
    const handle = await open();
    const rows = await handle.select<
      { id: string; kind: string; at: string; ok: number; complete: number; requests: number; accounts: number; added: number; message: string | null }[]
    >("SELECT * FROM fin_sync_runs ORDER BY at DESC");
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind === "discover" ? "discover" : "sync",
      at: r.at,
      ok: r.ok === 1,
      complete: r.complete === 1,
      requests: r.requests,
      accounts: r.accounts,
      added: r.added,
      message: r.message,
    }));
  },

  /** Empties everything that was imported or synced. The app goes back to showing the sample. */
  async clearSrc(): Promise<void> {
    const handle = await open();
    for (const table of ["fin_src_transactions", "fin_src_balances", "fin_src_imports", "fin_src_accounts", "fin_sync_runs"]) {
      await handle.execute(`DELETE FROM ${table}`);
    }
  },

  // --- Finance phase 5: the assumptions behind the long-term projection. Entered by the person. ---

  async finLongTerm(): Promise<LongTermAssumptions> {
    const handle = await open();
    const rows = await handle.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", [FIN_LONG_TERM_KEY]);
    if (!rows.length) return mergeLongTerm(null);
    try {
      return mergeLongTerm(JSON.parse(rows[0].value));
    } catch {
      return mergeLongTerm(null);
    }
  },

  async saveFinLongTerm(a: LongTermAssumptions): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [FIN_LONG_TERM_KEY, JSON.stringify(a)],
    );
  },

  async insightStates(): Promise<InsightState[]> {
    const handle = await open();
    const rows = await handle.select<
      {
        id: string;
        detector: string;
        severity: string;
        category: string;
        title: string;
        summary: string;
        first_seen_at: string;
        status: string;
        read: number;
        notif_hidden: number;
        os_notified: number;
        updated_at: string;
      }[]
    >("SELECT * FROM fin_insights ORDER BY first_seen_at DESC");
    return rows.map((r) => ({
      id: r.id,
      detector: r.detector as InsightState["detector"],
      severity: r.severity as InsightState["severity"],
      category: r.category as InsightState["category"],
      title: r.title,
      summary: r.summary,
      firstSeenAt: r.first_seen_at,
      status: r.status as InsightState["status"],
      read: r.read === 1,
      notifHidden: r.notif_hidden === 1,
      osNotified: r.os_notified === 1,
      updatedAt: r.updated_at,
    }));
  },

  async saveInsightState(s: InsightState): Promise<void> {
    const handle = await open();
    await handle.execute(
      `INSERT INTO fin_insights (id, detector, severity, category, title, summary, first_seen_at, status, read, notif_hidden, os_notified, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, read = excluded.read,
         notif_hidden = excluded.notif_hidden, os_notified = excluded.os_notified, updated_at = excluded.updated_at,
         title = excluded.title, summary = excluded.summary, first_seen_at = excluded.first_seen_at`,
      [s.id, s.detector, s.severity, s.category, s.title, s.summary, s.firstSeenAt, s.status, s.read ? 1 : 0, s.notifHidden ? 1 : 0, s.osNotified ? 1 : 0, s.updatedAt],
    );
  },

  /** The newest events of the given kinds, newest first. */
  async recentEvents(kinds: EventKind[], limit = 200): Promise<Event[]> {
    if (kinds.length === 0) return [];
    const handle = await open();
    const marks = kinds.map((_, i) => `${i + 1}`).join(", ");
    const rows = await handle.select<EventRow[]>(
      `SELECT * FROM events WHERE kind IN (${marks}) ORDER BY at DESC LIMIT ${kinds.length + 1}`,
      [...kinds, limit],
    );
    return rows.map(rowToEvent);
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
