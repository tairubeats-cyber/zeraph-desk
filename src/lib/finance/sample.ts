import type {
  AssetClass,
  BalancePoint,
  Connection,
  FinancialAccount,
  FinancialSnapshot,
  Institution,
  InvestmentActivity,
  Position,
  PositionType,
  Transaction,
} from "./types";
import { addDays, recentMonthKeys, toISODate } from "./money";

/**
 * Sample data, so the app is usable before any real provider exists.
 *
 * Everything here is invented: the institutions, the merchants, the balances.
 * It is generated deterministically (same month, same transactions) so the
 * user's edits, which are keyed by transaction id, keep pointing at the same
 * rows from one launch to the next. The UI labels all of it as sample data.
 */

const INSTITUTIONS: Institution[] = [
  { id: "inst-harbor", name: "Harbor Bank" },
  { id: "inst-summit", name: "Summit Invest" },
  { id: "inst-ridgeline", name: "Ridgeline Finance" },
];

const ACCOUNTS: Omit<FinancialAccount, "connectionId">[] = [
  { id: "acct-checking", institutionId: "inst-harbor", name: "Everyday Checking", kind: "checking", mask: "4821", balanceCents: 421_800 },
  { id: "acct-savings", institutionId: "inst-harbor", name: "Reserve Savings", kind: "savings", mask: "9034", balanceCents: 1_260_000 },
  { id: "acct-brokerage", institutionId: "inst-summit", name: "Brokerage", kind: "brokerage", mask: "7712", balanceCents: 2_845_000 },
  { id: "acct-401k", institutionId: "inst-summit", name: "401(k)", kind: "retirement", mask: "1180", balanceCents: 6_430_000 },
  { id: "acct-card", institutionId: "inst-harbor", name: "Rewards Card", kind: "credit_card", mask: "3307", balanceCents: 124_000 },
  { id: "acct-auto", institutionId: "inst-ridgeline", name: "Auto Loan", kind: "auto_loan", mask: "5520", balanceCents: 1_240_000 },
  { id: "acct-student", institutionId: "inst-ridgeline", name: "Student Loan", kind: "student_loan", mask: "0417", balanceCents: 1_890_000 },
];

/** Small seeded generator: the same seed always gives the same sequence. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Fixed {
  key: string;
  day: number;
  merchant: string;
  description: string;
  cents: number | [number, number];
  category: string;
  account: string;
}

const FIXED: Fixed[] = [
  { key: "pay-a", day: 1, merchant: "Brightline Payroll", description: "BRIGHTLINE PAYROLL DIRECT DEP", cents: 240_000, category: "income", account: "acct-checking" },
  { key: "pay-b", day: 15, merchant: "Brightline Payroll", description: "BRIGHTLINE PAYROLL DIRECT DEP", cents: 240_000, category: "income", account: "acct-checking" },
  { key: "rent", day: 1, merchant: "Maple Court Apartments", description: "MAPLE COURT APTS RENT", cents: -185_000, category: "housing", account: "acct-checking" },
  { key: "to-broker", day: 2, merchant: "Summit Invest", description: "TRANSFER TO BROKERAGE 7712", cents: -50_000, category: "investments", account: "acct-checking" },
  { key: "to-savings", day: 3, merchant: "Harbor Bank Savings", description: "TRANSFER TO SAVINGS 9034", cents: -30_000, category: "transfers", account: "acct-checking" },
  { key: "gym", day: 5, merchant: "Pulse Fitness", description: "PULSE FITNESS MEMBERSHIP", cents: -4_500, category: "subscriptions", account: "acct-card" },
  { key: "electric", day: 8, merchant: "Metro Power", description: "METRO POWER AUTOPAY", cents: [-12_800, -8_600], category: "utilities", account: "acct-checking" },
  { key: "music", day: 9, merchant: "Spotify", description: "SPOTIFY USA", cents: -1_299, category: "subscriptions", account: "acct-card" },
  { key: "internet", day: 12, merchant: "Fibernet", description: "FIBERNET INTERNET", cents: -8_500, category: "utilities", account: "acct-checking" },
  { key: "auto-loan", day: 20, merchant: "Ridgeline Finance", description: "RIDGELINE AUTO LOAN PMT", cents: -35_000, category: "debt", account: "acct-checking" },
  { key: "student-loan", day: 22, merchant: "Ridgeline Finance", description: "RIDGELINE STUDENT LOAN PMT", cents: -28_000, category: "debt", account: "acct-checking" },
  { key: "card-pay", day: 24, merchant: "Harbor Bank Card", description: "PAYMENT TO REWARDS CARD 3307", cents: [-130_000, -92_000], category: "transfers", account: "acct-checking" },
  { key: "insurance", day: 26, merchant: "Anchor Auto Insurance", description: "ANCHOR AUTO INS PREMIUM", cents: -17_200, category: "insurance", account: "acct-checking" },
  { key: "video", day: 28, merchant: "Netflix", description: "NETFLIX.COM", cents: -2_299, category: "subscriptions", account: "acct-card" },
  { key: "interest", day: 28, merchant: "Harbor Bank", description: "INTEREST PAID", cents: [1_700, 2_300], category: "income", account: "acct-savings" },
];

interface Variable {
  key: string;
  merchants: string[];
  /** How many times a month, inclusive. */
  count: [number, number];
  /** Chance the recipe happens at all in a given month. */
  chance: number;
  cents: [number, number];
  category: string;
  account: string;
}

const VARIABLE: Variable[] = [
  { key: "groc", merchants: ["Harbor Grocers", "Greenfield Market", "Corner Fresh"], count: [5, 6], chance: 1, cents: [4_500, 14_500], category: "food", account: "acct-checking" },
  { key: "dine", merchants: ["Basil & Stone", "Tamarind Kitchen", "Blue Door Coffee", "Noodle Yard", "Copper Grill"], count: [5, 8], chance: 1, cents: [900, 7_800], category: "dining", account: "acct-card" },
  { key: "gas", merchants: ["Fuelstop"], count: [2, 3], chance: 1, cents: [3_800, 6_200], category: "transportation", account: "acct-card" },
  { key: "ride", merchants: ["Ridewell"], count: [1, 2], chance: 0.6, cents: [1_200, 2_800], category: "transportation", account: "acct-card" },
  { key: "shop", merchants: ["Northfield Outfitters", "Homeware Co.", "Pageturn Books", "Bytehouse Electronics"], count: [2, 4], chance: 1, cents: [1_800, 14_000], category: "shopping", account: "acct-card" },
  { key: "fun", merchants: ["Lumen Cinemas", "Ticketline"], count: [1, 3], chance: 0.85, cents: [1_400, 7_500], category: "entertainment", account: "acct-card" },
  { key: "health", merchants: ["Willow Pharmacy", "Lakeside Dental"], count: [1, 1], chance: 0.6, cents: [1_500, 9_500], category: "healthcare", account: "acct-checking" },
  { key: "travel", merchants: ["Skyway Airlines"], count: [1, 1], chance: 0.34, cents: [22_000, 48_000], category: "travel", account: "acct-card" },
];

function between(rand: () => number, [lo, hi]: [number, number]): number {
  return Math.round(lo + rand() * (hi - lo));
}

/** Round to whole cents that end in 0 or 5, so the sample doesn't look machine-made. */
function tidy(cents: number): number {
  return Math.round(cents / 5) * 5;
}

/** Three years, so the longer Net Worth ranges have something to show. */
const HISTORY_DAYS = 1095;
const DAYS_PER_MONTH = 30.4375;

/**
 * An invented balance history for each account, ending exactly at today's
 * balance. Each account follows a simple story (a savings account that grew, a
 * loan that shrank) with some seeded wobble, anchored once a month and joined
 * by straight lines, so the same day always gives the same figure.
 */
function generateBalanceHistory(today: string, accounts: FinancialAccount[]): BalancePoint[] {
  /** Balance k months ago, in dollars, given a random draw in [0, 1). */
  const story: Record<string, (k: number, r: number) => number> = {
    "acct-checking": (_k, r) => 3_000 + r * 2_600,
    "acct-savings": (k, r) => 12_600 - 320 * k + (r - 0.5) * 120,
    "acct-brokerage": (k, r) => (28_450 - 640 * k) * (1 + (r - 0.5) * 0.08),
    "acct-401k": (k, r) => (64_300 - 1_000 * k) * (1 + (r - 0.5) * 0.06),
    "acct-card": (_k, r) => 600 + r * 1_400,
    "acct-auto": (k, r) => 12_400 + 290 * k + (r - 0.5) * 10,
    "acct-student": (k, r) => 18_900 + 200 * k + (r - 0.5) * 10,
  };

  const points: BalancePoint[] = [];
  for (const a of accounts) {
    const shape = story[a.id];
    if (!shape) continue;
    const seed = [...a.id].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
    const months = Math.ceil(HISTORY_DAYS / DAYS_PER_MONTH) + 2;
    const anchors = Array.from({ length: months }, (_, k) =>
      k === 0 ? a.balanceCents : Math.max(0, Math.round(shape(k, rng(seed + k)()) * 100)),
    );
    for (let daysAgo = 0; daysAgo <= HISTORY_DAYS; daysAgo++) {
      const pos = daysAgo / DAYS_PER_MONTH;
      const k = Math.floor(pos);
      const t = pos - k;
      points.push({
        accountId: a.id,
        date: addDays(today, -daysAgo),
        balanceCents: daysAgo === 0 ? a.balanceCents : Math.round(anchors[k] * (1 - t) + anchors[k + 1] * t),
      });
    }
  }
  return points;
}

interface PositionPlan {
  symbol: string;
  name: string;
  type: PositionType;
  assetClass: AssetClass;
  /** Share of the account, in percent. Cash takes whatever is left, so the total is exact. */
  weight: number;
  /** Price per unit in cents. */
  price: number;
  /** Typical cost basis as a share of today's value, or null when the account doesn't report one. */
  basis: number | null;
}

const POSITION_PLANS: Record<string, PositionPlan[]> = {
  "acct-brokerage": [
    { symbol: "NTMX", name: "Northfield U.S. Total Market Index", type: "fund", assetClass: "us_stock", weight: 42, price: 14_872, basis: 0.81 },
    { symbol: "MRIX", name: "Meridian International Index", type: "fund", assetClass: "intl_stock", weight: 18, price: 6_390, basis: 0.94 },
    { symbol: "HLSY", name: "Harborline Systems", type: "stock", assetClass: "us_stock", weight: 14, price: 21_845, basis: 0.72 },
    { symbol: "CPLF", name: "Copperleaf Energy", type: "stock", assetClass: "us_stock", weight: 8, price: 5_236, basis: 1.02 },
    { symbol: "RABX", name: "Ridgeline Aggregate Bond", type: "fund", assetClass: "bond", weight: 12, price: 4_811, basis: 0.97 },
  ],
  "acct-401k": [
    { symbol: "SM500", name: "Summit 500 Index", type: "fund", assetClass: "us_stock", weight: 50, price: 31_260, basis: null },
    { symbol: "SMINT", name: "Summit International Index", type: "fund", assetClass: "intl_stock", weight: 20, price: 2_715, basis: null },
    { symbol: "SMBND", name: "Summit Bond Index", type: "fund", assetClass: "bond", weight: 25, price: 1_042, basis: null },
  ],
};

/** A stable number from text, so a symbol always draws the same wobble on the same day. */
function hashOf(text: string): number {
  return [...text].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
}

/**
 * Invented holdings for the investment accounts. Each account's holdings add up
 * to exactly its balance: the last position is cash, taking the remainder.
 * Yesterday's price is drawn from the date, so "today's change" moves day to
 * day but never differs between two looks on the same day.
 */
function generatePositions(today: string, accounts: FinancialAccount[]): Position[] {
  const dayNumber = Number(today.replace(/-/g, ""));
  const out: Position[] = [];
  for (const a of accounts) {
    const plans = POSITION_PLANS[a.id];
    if (!plans) continue;
    let used = 0;
    for (const p of plans) {
      const target = Math.round((a.balanceCents * p.weight) / 100);
      const quantity = Math.round((target / p.price) * 1000) / 1000;
      const value = Math.round(quantity * p.price);
      used += value;
      const swing = p.type === "stock" ? 0.024 : 0.012;
      const wobble = (rng(dayNumber + hashOf(p.symbol))() - 0.5) * swing;
      out.push({
        id: `pos-${a.id}-${p.symbol}`,
        accountId: a.id,
        symbol: p.symbol,
        name: p.name,
        type: p.type,
        assetClass: p.assetClass,
        quantity,
        priceCents: p.price,
        previousCloseCents: Math.round(p.price / (1 + wobble)),
        costBasisCents: p.basis === null ? null : Math.round(value * p.basis),
      });
    }
    const cash = a.balanceCents - used;
    out.push({
      id: `pos-${a.id}-CASH`,
      accountId: a.id,
      symbol: "CASH",
      name: "Cash",
      type: "cash",
      assetClass: "cash",
      quantity: cash / 100,
      priceCents: 100,
      previousCloseCents: 100,
      costBasisCents: plans.some((p) => p.basis !== null) ? cash : null,
    });
  }
  return out;
}

/** Monthly contributions and quarterly dividends over the same three years as the balance history. */
function generateActivity(today: string): InvestmentActivity[] {
  const out: InvestmentActivity[] = [];
  const earliest = addDays(today, -HISTORY_DAYS);
  for (const month of recentMonthKeys(today, 38)) {
    const [y, m] = month.split("-").map(Number);
    const rand = rng(y * 100 + m + 7);
    const on = (day: number) => toISODate(new Date(y, m - 1, day));
    const add = (accountId: string, key: string, day: number, kind: InvestmentActivity["kind"], amountCents: number) => {
      const date = on(day);
      if (date > today || date < earliest) return;
      out.push({ id: `act-${month}-${key}`, accountId, date, kind, amountCents });
    };
    add("acct-brokerage", "b-contrib", 2, "contribution", 50_000);
    add("acct-401k", "k-contrib", 15, "contribution", 65_000);
    if (m % 3 === 0) add("acct-brokerage", "b-div", 20, "dividend", 4_500 + Math.round(rand() * 2_700));
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export function generateSample(today: string): FinancialSnapshot {
  const connections: Connection[] = INSTITUTIONS.map((i) => ({
    id: `conn-${i.id}`,
    institutionId: i.id,
    status: "sample",
    origin: "sample",
    lastSyncedAt: null,
  }));
  const accounts: FinancialAccount[] = ACCOUNTS.map((a) => ({ ...a, connectionId: `conn-${a.institutionId}` }));

  const transactions: Transaction[] = [];
  const cutoff = today;

  for (const month of recentMonthKeys(today, 6)) {
    const [y, m] = month.split("-").map(Number);
    const rand = rng(y * 100 + m);
    const push = (t: Omit<Transaction, "pending">) => {
      if (t.date > cutoff) return;
      // Pending is derived, never drawn from the generator, so it can't shift the other amounts.
      transactions.push({ ...t, pending: t.date === cutoff && t.accountId === "acct-card" });
    };
    const dateOf = (day: number) => toISODate(new Date(y, m - 1, day));

    for (const f of FIXED) {
      const amountCents = Array.isArray(f.cents) ? tidy(between(rand, f.cents)) : f.cents;
      push({
        id: `smp-${month}-${f.key}`,
        accountId: f.account,
        date: dateOf(f.day),
        merchant: f.merchant,
        description: f.description,
        amountCents,
        categoryHint: f.category,
      });
    }

    for (const v of VARIABLE) {
      if (rand() > v.chance) continue;
      const n = between(rand, v.count);
      for (let i = 0; i < n; i++) {
        const merchant = v.merchants[Math.floor(rand() * v.merchants.length)];
        push({
          id: `smp-${month}-${v.key}-${i}`,
          accountId: v.account,
          date: dateOf(1 + Math.floor(rand() * 28)),
          merchant,
          description: `${merchant.toUpperCase()} #${1000 + Math.floor(rand() * 900)}`,
          amountCents: -tidy(between(rand, v.cents)),
          categoryHint: v.category,
        });
      }
    }
  }

  transactions.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : b.date.localeCompare(a.date)));
  return { institutions: INSTITUTIONS, connections, accounts, transactions, balanceHistory: generateBalanceHistory(today, accounts),
    positions: generatePositions(today, accounts),
    investmentActivity: generateActivity(today),
  };
}
