/**
 * What ZeraphDesk watches for, and which of those things may notify. The user
 * decides both; nothing here is switched on behind their back.
 */

export type NotificationCategory = "money" | "bills" | "goals" | "investments" | "security" | "system";

export const NOTIFICATION_CATEGORIES: { key: NotificationCategory; label: string; description: string; live: boolean }[] = [
  { key: "money", label: "Money", description: "Spending, income, budgets and recurring payments.", live: true },
  { key: "bills", label: "Bills", description: "Bills that are due soon or haven't shown up.", live: true },
  { key: "goals", label: "Goals", description: "Goals that are reached or running behind.", live: true },
  { key: "investments", label: "Investments", description: "Big moves in your investments, and one company making up a lot of them.", live: true },
  { key: "security", label: "Security", description: "Sign-ins and changes to your connections.", live: false },
  { key: "system", label: "System", description: "Things about ZeraphDesk itself.", live: false },
];

export type DetectorId =
  | "cash-pressure"
  | "bill-due-soon"
  | "bill-not-seen"
  | "price-increase"
  | "new-recurring"
  | "recurring-stopped"
  | "budget-over"
  | "budget-projected"
  | "unusual-spend"
  | "spend-pace"
  | "goal-behind"
  | "goal-reached"
  | "income-change"
  | "investments-drop"
  | "concentration";

export interface DetectorInfo {
  id: DetectorId;
  label: string;
  description: string;
  category: NotificationCategory;
}

/**
 * Everything ZeraphDesk can notice today. Changes in debt balances aren't here
 * yet; they'd arrive as new entries in this list.
 */
export const DETECTORS: DetectorInfo[] = [
  { id: "cash-pressure", label: "Checking balance dipping", description: "Known payments and income would take checking below your reserve.", category: "money" },
  { id: "bill-due-soon", label: "Bills due soon", description: "A bill is coming due and isn't on autopay.", category: "bills" },
  { id: "bill-not-seen", label: "Bills not yet seen", description: "A bill was expected but no matching payment has appeared.", category: "bills" },
  { id: "price-increase", label: "Recurring payment went up", description: "A steady payment came in higher than the one before.", category: "money" },
  { id: "new-recurring", label: "New recurring payment", description: "A payment has started repeating.", category: "money" },
  { id: "recurring-stopped", label: "Recurring payment stopped", description: "A payment that used to repeat hasn't appeared for a while.", category: "money" },
  { id: "budget-over", label: "Over budget", description: "Spending in a category has passed its monthly budget.", category: "money" },
  { id: "budget-projected", label: "Projected over budget", description: "A category is on pace to pass its budget this month.", category: "money" },
  { id: "unusual-spend", label: "Unusually large purchase", description: "A purchase far above what's usual for its category.", category: "money" },
  { id: "spend-pace", label: "Spending running high", description: "A category is on pace to finish well above your usual month.", category: "money" },
  { id: "goal-behind", label: "Goal behind its deadline", description: "At the current rate a goal would finish after its deadline.", category: "goals" },
  { id: "goal-reached", label: "Goal reached", description: "A goal has hit its target.", category: "goals" },
  { id: "income-change", label: "Income changed", description: "A full month's income differs noticeably from the months before.", category: "money" },
  { id: "investments-drop", label: "Investments fell", description: "Your investment accounts lost 10% or more over 30 days, after counting money you put in.", category: "investments" },
  { id: "concentration", label: "One company is a big share", description: "A single stock makes up 15% or more of your investments.", category: "investments" },
];

export interface FinancePreferences {
  /** The checking balance you'd like to stay above. null means "just don't go below zero". */
  reserveCents: number | null;
  /** How many days ahead to flag a bill that isn't on autopay. */
  billLeadDays: number;
  /** Which categories may show notifications. Detection continues either way. */
  notify: Record<NotificationCategory, boolean>;
  /** Which detectors run at all. */
  watch: Record<DetectorId, boolean>;
}

export const DEFAULT_PREFS: FinancePreferences = {
  reserveCents: null,
  billLeadDays: 3,
  notify: { money: true, bills: true, goals: true, investments: true, security: true, system: true },
  watch: Object.fromEntries(DETECTORS.map((d) => [d.id, true])) as Record<DetectorId, boolean>,
};

/** Read saved preferences, filling anything missing or malformed from the defaults. */
export function mergePrefs(saved: unknown): FinancePreferences {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<FinancePreferences>;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const notify = { ...DEFAULT_PREFS.notify };
  const watch = { ...DEFAULT_PREFS.watch };
  for (const k of Object.keys(notify) as NotificationCategory[]) notify[k] = bool(s.notify?.[k], notify[k]);
  for (const k of Object.keys(watch) as DetectorId[]) watch[k] = bool(s.watch?.[k], watch[k]);
  const lead = Number(s.billLeadDays);
  return {
    reserveCents: typeof s.reserveCents === "number" && s.reserveCents >= 0 ? Math.round(s.reserveCents) : null,
    billLeadDays: Number.isFinite(lead) && lead >= 0 && lead <= 30 ? Math.round(lead) : DEFAULT_PREFS.billLeadDays,
    notify,
    watch,
  };
}
