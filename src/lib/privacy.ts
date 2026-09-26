/**
 * Privacy controls, as pure logic: what ZeraphDesk holds, what an export contains, and how a transactions file is
 * written. Reading and deleting the database is `db.ts`; saving a file is `privacy.rs`. Nothing here touches the
 * network, and nothing here decides whether anything is done: the person clicks.
 *
 * Three promises this file keeps:
 *  - An export never contains a secret. The email app password and the SimpleFIN key live in the system keychain and
 *    were never in the database; the one credential that is (the seat token) is filtered out here.
 *  - Every table the app creates is either described to the person or deliberately left out, and a test fails if a
 *    new table is neither, so a future feature can't quietly store something the person can't see or export.
 *  - The exported values are the ones stored: amounts stay in cents, dates stay as dates.
 */

/** Settings rows that are credentials. They're kept out of every export. */
export const SECRET_SETTING_KEYS: readonly string[] = ["seat_token"];

export type GroupKey = "accounts" | "choices" | "desk" | "activity" | "settings";

export const GROUPS: { key: GroupKey; label: string; about: string }[] = [
  { key: "accounts", label: "Accounts and transactions you added", about: "Imported from files or synced through SimpleFIN, and typed in by hand." },
  { key: "choices", label: "Your choices in finance", about: "Categories, corrections, budgets, goals, debt details, things you own, scenarios and how you've responded to findings." },
  { key: "desk", label: "The email desk", about: "Customers, conversations, the replies waiting for approval and the ones you've sent." },
  { key: "activity", label: "Activity log", about: "A record of what happened, kept as kinds and ids only: no amounts, names or message text." },
  { key: "settings", label: "Saved settings", about: "Your business sheet, preferences, and the seat token that lets this copy write drafts." },
];

/** Every table the app creates, in words the person would use, and the group it's shown under. */
export const TABLES: Record<string, { group: GroupKey; label: string }> = {
  fin_src_accounts: { group: "accounts", label: "accounts" },
  fin_src_transactions: { group: "accounts", label: "transactions" },
  fin_src_balances: { group: "accounts", label: "balance records" },
  fin_src_imports: { group: "accounts", label: "file imports" },
  fin_sync_runs: { group: "accounts", label: "sync records" },
  fin_categories: { group: "choices", label: "categories" },
  fin_tx_overrides: { group: "choices", label: "corrections to transactions" },
  fin_budgets: { group: "choices", label: "budgets" },
  fin_goals: { group: "choices", label: "goals" },
  fin_goal_contributions: { group: "choices", label: "goal deposits" },
  fin_recurring_marks: { group: "choices", label: "marks on recurring payments" },
  fin_recurring_manual: { group: "choices", label: "recurring payments you added" },
  fin_debt_terms: { group: "choices", label: "debt rates and payments" },
  fin_holdings: { group: "choices", label: "things you own" },
  fin_holding_values: { group: "choices", label: "their values over time" },
  fin_planned: { group: "choices", label: "planned items" },
  fin_scenarios: { group: "choices", label: "scenarios" },
  fin_insights: { group: "choices", label: "responses to findings" },
  contacts: { group: "desk", label: "contacts" },
  threads: { group: "desk", label: "conversations" },
  messages: { group: "desk", label: "messages" },
  actions: { group: "desk", label: "replies and follow-ups" },
  events: { group: "activity", label: "log entries" },
  settings: { group: "settings", label: "saved settings" },
};

export interface InventoryItem {
  table: string;
  label: string;
  count: number;
}

export interface InventoryGroup {
  key: GroupKey;
  label: string;
  about: string;
  items: InventoryItem[];
  total: number;
}

/** What ZeraphDesk holds, grouped, from a count per table. A table the app doesn't describe is left out rather than guessed at. */
export function inventory(counts: Record<string, number>): InventoryGroup[] {
  return GROUPS.map((g) => {
    const items = Object.entries(TABLES)
      .filter(([, t]) => t.group === g.key)
      .map(([table, t]) => ({ table, label: t.label, count: counts[table] ?? 0 }));
    return { ...g, items, total: items.reduce((s, i) => s + i.count, 0) };
  });
}

/** Tables in the database that the app doesn't describe. Empty unless a migration added one without updating `TABLES`. */
export function undescribedTables(names: string[]): string[] {
  return names.filter((n) => !(n in TABLES));
}

type Row = Record<string, unknown>;

/** The rows of one table as they belong in an export: everything, except credentials. */
export function exportableRows(table: string, rows: Row[]): Row[] {
  if (table === "settings") return rows.filter((r) => !SECRET_SETTING_KEYS.includes(String(r.key)));
  return rows;
}

export interface ExportMeta {
  appVersion: string;
  exportedAt: string;
}

export interface ExportDocument {
  app: "ZeraphDesk";
  format: 1;
  appVersion: string;
  exportedAt: string;
  notes: string[];
  tables: Record<string, Row[]>;
}

export const EXPORT_NOTES = [
  "Every table ZeraphDesk keeps is here, as stored. Amounts are in cents; a negative amount is money out.",
  "Passwords and keys are not in this file: the email app password and the SimpleFIN key are held in your system's keychain, and the seat token is left out.",
  "This file is not encrypted. It holds your financial details, so keep it somewhere private.",
  "Sample data is never stored, so it isn't here; only what you added, imported or synced is.",
];

export function buildExport(tables: Record<string, Row[]>, meta: ExportMeta): ExportDocument {
  const out: Record<string, Row[]> = {};
  for (const name of Object.keys(tables).sort()) out[name] = exportableRows(name, tables[name]);
  return { app: "ZeraphDesk", format: 1, appVersion: meta.appVersion, exportedAt: meta.exportedAt, notes: EXPORT_NOTES, tables: out };
}

// ---- the transactions file ------------------------------------------------------------------------------------------

export interface TransactionLine {
  date: string;
  account: string;
  merchant: string;
  description: string;
  amountCents: number;
  category: string;
  note: string;
  flagged: boolean;
}

/** 4510 is "45.10", -4510 is "-45.10". Whole-number arithmetic, so there's no rounding to argue about. */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * One CSV cell. Quoted when it needs to be. A text cell that starts with = + - or @ gets a leading apostrophe, which
 * is the standard defence against a spreadsheet treating a merchant name as a formula; numbers aren't touched.
 */
export function csvCell(value: string, opts: { text?: boolean } = {}): string {
  let v = value;
  if (opts.text !== false && /^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export const TRANSACTION_COLUMNS = ["Date", "Account", "Merchant", "Description", "Amount", "Category", "Note", "Flagged"];

/** The transactions as a CSV any spreadsheet opens (and ZeraphDesk's own import reads back). Money out is negative. */
export function transactionsCsv(lines: TransactionLine[]): string {
  const rows = lines.map((t) =>
    [
      t.date,
      csvCell(t.account),
      csvCell(t.merchant),
      csvCell(t.description),
      centsToDecimal(t.amountCents),
      csvCell(t.category),
      csvCell(t.note),
      t.flagged ? "yes" : "",
    ].join(","),
  );
  return [TRANSACTION_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

/** Excel reads a UTF-8 file as text in another encoding unless it starts with a byte-order mark. */
export const CSV_BOM = "﻿";

export function exportFileName(kind: "everything" | "transactions", today: string): string {
  return `zeraphdesk-${kind === "everything" ? "export" : "transactions"}-${today}`;
}

/** Roughly how big a file is, for the person: "3.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
