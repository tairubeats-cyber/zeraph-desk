/**
 * The finance data model. Providers (a bank-data aggregator, CSV import, the
 * built-in sample) produce these shapes; nothing above this file knows which
 * one is behind them. Money is always integer cents.
 *
 * Phase 1 covers accounts and transactions. Budgets, goals, recurring payments,
 * holdings and liability detail arrive with the phases that build them.
 */

/** Where a piece of data came from. The UI labels anything that isn't `provider`. */
export type DataOrigin = "sample" | "provider";

export type ConnectionStatus = "sample" | "connected" | "needs_attention" | "disconnected";

export type AccountKind =
  | "checking"
  | "savings"
  | "cash"
  | "brokerage"
  | "retirement"
  | "credit_card"
  | "auto_loan"
  | "student_loan"
  | "mortgage"
  | "personal_loan";

export type AccountGroup = "cash" | "investments" | "credit" | "loans";
export type AccountClass = "asset" | "liability";

export interface AccountKindInfo {
  label: string;
  group: AccountGroup;
  class: AccountClass;
}

export const ACCOUNT_KINDS: Record<AccountKind, AccountKindInfo> = {
  checking: { label: "Checking", group: "cash", class: "asset" },
  savings: { label: "Savings", group: "cash", class: "asset" },
  cash: { label: "Cash", group: "cash", class: "asset" },
  brokerage: { label: "Brokerage", group: "investments", class: "asset" },
  retirement: { label: "Retirement", group: "investments", class: "asset" },
  credit_card: { label: "Credit card", group: "credit", class: "liability" },
  auto_loan: { label: "Auto loan", group: "loans", class: "liability" },
  student_loan: { label: "Student loan", group: "loans", class: "liability" },
  mortgage: { label: "Mortgage", group: "loans", class: "liability" },
  personal_loan: { label: "Personal loan", group: "loans", class: "liability" },
};

export const ACCOUNT_GROUPS: { key: AccountGroup; label: string }[] = [
  { key: "cash", label: "Cash" },
  { key: "investments", label: "Investments" },
  { key: "credit", label: "Credit" },
  { key: "loans", label: "Loans" },
];

export interface Institution {
  id: string;
  name: string;
}

export interface Connection {
  id: string;
  institutionId: string;
  status: ConnectionStatus;
  origin: DataOrigin;
  /** ISO time of the last successful sync; null if it has never synced. */
  lastSyncedAt: string | null;
}

export interface FinancialAccount {
  id: string;
  institutionId: string;
  connectionId: string;
  name: string;
  kind: AccountKind;
  /** Last four digits, when the provider gives them. */
  mask: string | null;
  /**
   * Always the size of the balance, never negative: a credit card that owes
   * $1,240 is 124000 with `ACCOUNT_KINDS.credit_card.class === "liability"`.
   */
  balanceCents: number;
}

export interface Transaction {
  id: string;
  accountId: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  merchant: string;
  /** The raw line from the statement. */
  description: string;
  /** Negative = money out, positive = money in. */
  amountCents: number;
  /** The provider's category, if it gave one. The user's own choice lives in an override. */
  categoryHint: string | null;
  pending: boolean;
}

export type CategoryKind = "income" | "expense" | "transfer";

export interface Category {
  id: string;
  name: string;
  /** `transfer` money moves between the user's own accounts and isn't counted as income or spending. */
  kind: CategoryKind;
  position: number;
  hidden: boolean;
}

/** What the user has changed about one transaction. */
export interface TransactionOverride {
  txId: string;
  categoryId: string | null;
  note: string;
  flagged: boolean;
}

/** A transaction with the user's edits applied. This is what the UI and analysis work on. */
export interface ResolvedTransaction extends Transaction {
  categoryId: string;
  note: string;
  flagged: boolean;
  /** True when the user, not the provider, chose the category. */
  recategorized: boolean;
}

/** Everything a provider hands back in one pull. */
export interface FinancialSnapshot {
  institutions: Institution[];
  connections: Connection[];
  accounts: FinancialAccount[];
  transactions: Transaction[];
}

/**
 * The seam for real data. A bank-data aggregator, a CSV importer or a manual
 * entry screen implements this and is added to `providers.ts`; no view changes.
 */
export interface FinancialDataProvider {
  id: string;
  name: string;
  origin: DataOrigin;
  load(): Promise<FinancialSnapshot>;
}

/**
 * What kind of statement a number is. Never blur these: a balance the bank
 * reported is not the same thing as a sum we computed or a forecast we assumed.
 */
export type Basis = "fact" | "calculation" | "projection" | "insight" | "scenario";
