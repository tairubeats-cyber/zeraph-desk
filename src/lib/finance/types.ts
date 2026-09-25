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
  /** Past balances, when the provider has them. Empty otherwise. */
  balanceHistory: BalancePoint[];
  /** Individual holdings inside investment accounts, when the provider has them. */
  positions: Position[];
  /** Contributions, withdrawals and dividends in investment accounts. */
  investmentActivity: InvestmentActivity[];
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

// --- Phase 2: money management -------------------------------------------------

export type Frequency = "weekly" | "biweekly" | "semimonthly" | "monthly" | "quarterly" | "yearly";
export type RecurringStatus = "active" | "reviewing" | "cancelled";
export type Necessity = "unset" | "essential" | "non_essential";
export type Autopay = "unset" | "on" | "off";

/** What the user has said about one recurring payment. Detection never overwrites this. */
export interface RecurringMark {
  key: string;
  status: RecurringStatus;
  necessity: Necessity;
  autopay: Autopay;
  /** null = use the default guess from the category. */
  isBill: boolean | null;
}

/** A recurring payment the user added themselves (rent that predates the history, a new subscription). */
export interface ManualRecurring {
  id: string;
  name: string;
  /** Always positive; `direction` says which way the money moves. */
  amountCents: number;
  direction: "in" | "out";
  frequency: Frequency;
  nextDate: string;
  categoryId: string;
}

export interface RecurringPayment {
  /** Stable across launches: the mark and any manual entry hang off it. */
  key: string;
  source: "detected" | "manual";
  merchant: string;
  categoryId: string;
  direction: "in" | "out";
  /** The category's kind, so callers can tell spending from transfers from income. */
  kind: CategoryKind;
  frequency: Frequency;
  /** Most recent amount, as a positive number. */
  amountCents: number;
  /** Average amount over the history, as a positive number. */
  typicalCents: number;
  /** True when the amount moves around (utilities), so the figure is an estimate. */
  variable: boolean;
  annualCents: number;
  lastDate: string | null;
  /** The next date the pattern says to expect it; may already be past if it hasn't shown up. */
  nextDate: string;
  occurrences: number;
  /** No charge for well over one cycle: it may have stopped. Shown as a note, never acted on. */
  possiblyStopped: boolean;
  /** Days of the month for `semimonthly`, e.g. [1, 15]. */
  monthDays: number[];
  /** Transactions the pattern was built from, newest first. */
  txIds: string[];
  status: RecurringStatus;
  necessity: Necessity;
  autopay: Autopay;
  isBill: boolean;
}

export interface Budget {
  categoryId: string;
  /** Per month. */
  amountCents: number;
}

export type GoalKind =
  | "emergency_fund"
  | "new_car"
  | "house"
  | "vacation"
  | "debt_payoff"
  | "retirement"
  | "investment"
  | "large_purchase"
  | "custom";

export const GOAL_KINDS: Record<GoalKind, string> = {
  emergency_fund: "Emergency fund",
  new_car: "New car",
  house: "House",
  vacation: "Vacation",
  debt_payoff: "Debt payoff",
  retirement: "Retirement",
  investment: "Investment target",
  large_purchase: "Large purchase",
  custom: "Custom goal",
};

export interface Goal {
  id: string;
  name: string;
  kind: GoalKind;
  targetCents: number;
  /** What was already set aside when the goal was created. */
  startCents: number;
  /** Optional finish line, YYYY-MM-DD. */
  deadline: string | null;
  /** What the person intends to put in each month; 0 if they haven't decided. */
  monthlyPlanCents: number;
  createdAt: string;
}

export interface GoalContribution {
  id: string;
  goalId: string;
  amountCents: number;
  date: string;
  note: string;
}

// --- Phase 4: planning ------------------------------------------------------------

/**
 * One reported balance for one account on one day. Like `FinancialAccount.balanceCents`
 * it is the size of the balance, never negative: a card that owed $900 is 90000.
 * A provider that has history supplies it; one that doesn't leaves it empty and the
 * Net Worth screen says so rather than inventing a past.
 */
export interface BalancePoint {
  accountId: string;
  date: string;
  balanceCents: number;
}

export type HoldingKind = "real_estate" | "vehicle" | "other_asset" | "other_debt";

export const HOLDING_KINDS: Record<HoldingKind, { label: string; class: AccountClass }> = {
  real_estate: { label: "Real estate", class: "asset" },
  vehicle: { label: "Vehicle", class: "asset" },
  other_asset: { label: "Other asset", class: "asset" },
  other_debt: { label: "Other debt", class: "liability" },
};

/** One dated value the user entered for a holding. */
export interface HoldingValue {
  date: string;
  valueCents: number;
}

/**
 * Something that counts toward net worth but isn't an account: a home, a car,
 * a loan from a relative. The value is whatever the user last entered; nothing
 * here is read from anywhere. Values are sorted oldest first.
 */
export interface Holding {
  id: string;
  name: string;
  kind: HoldingKind;
  createdAt: string;
  values: HoldingValue[];
}

/**
 * What a debt costs and how it's being paid. Providers may supply this someday;
 * until then the user enters it, and every screen that uses it says "you entered".
 */
export interface DebtTerms {
  accountId: string;
  /** Annual rate in basis points: 19.99% is 1999. */
  aprBps: number | null;
  minPaymentCents: number | null;
  /** What's actually paid each month; null means the minimum. */
  paymentCents: number | null;
  /** Day of the month the payment is due, 1 to 31. */
  dueDay: number | null;
}

/** A one-off expense or income the user expects, so the forecast can include it. */
export interface PlannedItem {
  id: string;
  name: string;
  date: string;
  /** Always positive; `direction` says which way the money moves. */
  amountCents: number;
  direction: "in" | "out";
}

/** A payoff order when there are several debts and some extra money. */
export type PayoffStrategy = "avalanche" | "snowball";

export type ScenarioChange =
  | { id: string; type: "save_more"; monthlyCents: number; goalId: string | null }
  | { id: string; type: "extra_debt"; monthlyCents: number; target: "all" | string; strategy: PayoffStrategy }
  /** Positive = more income each month, negative = less. */
  | { id: string; type: "income"; monthlyCents: number }
  /** Positive = a cost that goes up (rent), negative = one that comes down. */
  | { id: string; type: "expense"; monthlyCents: number; label: string }
  | {
      id: string;
      type: "purchase";
      label: string;
      priceCents: number;
      downCents: number;
      financed: boolean;
      aprBps: number;
      termMonths: number;
      /** Which month from now it happens, 1 = next month. */
      inMonths: number;
      /** What the thing is still worth afterwards, 0 if it shouldn't count as an asset. */
      valueCents: number;
    }
  | { id: string; type: "stop_subscription"; recurringKey: string };

export interface Scenario {
  id: string;
  name: string;
  horizonMonths: number;
  changes: ScenarioChange[];
  createdAt: string;
  updatedAt: string;
}

// --- Phase 5: wealth -------------------------------------------------------------

export type AssetClass = "us_stock" | "intl_stock" | "bond" | "cash" | "other";

export const ASSET_CLASSES: Record<AssetClass, string> = {
  us_stock: "U.S. stocks",
  intl_stock: "International stocks",
  bond: "Bonds",
  cash: "Cash",
  other: "Other",
};

/** A fund holds many things; a stock is one company; cash is cash. Concentration only matters for single stocks. */
export type PositionType = "fund" | "stock" | "cash";

/**
 * One holding inside an investment account, as a provider reports it. The value
 * is `quantity` times `priceCents`; a provider that only knows the value uses a
 * quantity of 1. Quantities can be fractional.
 */
export interface Position {
  id: string;
  accountId: string;
  symbol: string;
  name: string;
  type: PositionType;
  assetClass: AssetClass;
  quantity: number;
  /** Latest price per unit, in cents. */
  priceCents: number;
  /** Price per unit at the previous close, for the day's change. */
  previousCloseCents: number;
  /** What was paid in total, when the provider knows. Retirement plans often don't say. */
  costBasisCents: number | null;
}

/**
 * Money moving into or out of an investment account, as a provider reports it.
 * Dividends are returns, not contributions: they're listed but never counted as money you put in.
 */
export interface InvestmentActivity {
  id: string;
  accountId: string;
  date: string;
  kind: "contribution" | "withdrawal" | "dividend";
  /** Always positive. */
  amountCents: number;
}

/** What the person assumes for a long-term projection. Entered by them, never guessed by us. */
export interface LongTermAssumptions {
  /** Added each month. null means "use my recent pace". */
  monthlyCents: number | null;
  /** Expected yearly growth, in basis points (5% is 500). */
  returnBps: number;
  years: number;
  /** An amount to reach, if any. */
  targetCents: number | null;
  /** Yearly inflation in basis points, for showing today's-money values. 0 shows plain future dollars. */
  inflationBps: number;
}
