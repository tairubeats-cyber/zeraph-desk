/**
 * Ask ZeraphDesk: answers to questions about the user's own finances.
 *
 * This engine is deterministic code, not a language model. It reads the same
 * data the screens show and works out the answer, so it cannot invent a
 * figure, and nothing about the question or the data leaves the computer.
 * Every answer says what it was based on. A question it doesn't understand,
 * or that the data can't answer (like why net worth moved, when balances have
 * no history), gets a plain "I can't" and never a guess.
 *
 * A model could later sit in front of this to understand wording better. It
 * would call the same functions and add nothing of its own to the numbers.
 * Whether any of the data may be sent to one is a separate decision.
 */
import type { ViewKey } from "../../nav";
import type {
  BalancePoint,
  Basis,
  Category,
  DebtTerms,
  FinancialAccount,
  Goal,
  GoalContribution,
  Holding,
  InvestmentActivity,
  LongTermAssumptions,
  PlannedItem,
  Position,
  RecurringPayment,
  ResolvedTransaction,
} from "./types";
import { ACCOUNT_GROUPS, ACCOUNT_KINDS, ASSET_CLASSES } from "./types";
import type { TxFilters } from "./filters";
import { accountTotals } from "./analysis";
import { modellableDebts, simulatePayoff } from "./debt";
import { buildForecast } from "./forecast";
import { netWorthHistory, netWorthNow, RANGES, SLICE_LABELS } from "./networth";
import { allocation, concentration, contributionSummary, holdingRows, investmentAccounts, performance, portfolioSummary } from "./investments";
import { DEFAULT_LONG_TERM, monthsToTarget, projectRange } from "./longterm";
import { average, completeMonths, monthlyFlows, upcoming } from "./cashflow";
import { budgetRows } from "./budget";
import { goalProgress } from "./goals";
import { FREQUENCY_LABELS } from "./recurring";
import {
  addDays,
  dayOfMonth,
  endOfMonth,
  formatMoney,
  monthKey,
  monthLabel,
  parseISODate,
  recentMonthKeys,
  shiftMonth,
} from "./money";

export interface AskContext {
  today: string;
  /** Whether the data is the built-in sample. Every answer says so if it is. */
  sample: boolean;
  transactions: ResolvedTransaction[];
  categories: Category[];
  accounts: FinancialAccount[];
  institutions: Map<string, string>;
  recurring: RecurringPayment[];
  budgets: Map<string, number>;
  goals: Goal[];
  contributions: GoalContribution[];
  holdings: Holding[];
  history: BalancePoint[];
  debtTerms: Map<string, DebtTerms>;
  planned: PlannedItem[];
  positions: Position[];
  activity: InvestmentActivity[];
  longTerm: LongTermAssumptions;
}

export interface AnswerLink {
  label: string;
  view: ViewKey;
  filters?: Partial<TxFilters>;
}

export interface Answer {
  question: string;
  /** False when the question wasn't understood, or the data can't answer it. */
  answered: boolean;
  headline: string;
  paragraphs: string[];
  facts: { label: string; value: string }[];
  table: { title?: string; columns: string[]; rows: string[][] } | null;
  /** What the answer was worked out from. */
  used: string[];
  notes: string[];
  links: AnswerLink[];
  basis: Basis;
}

export const SUGGESTED_QUESTIONS = [
  "Where did most of my money go this month?",
  "What changed compared with last month?",
  "What bills are coming up?",
  "What subscriptions am I paying for?",
  "Show me my largest recurring expenses.",
  "How much did I spend on dining this month?",
  "How much can I put toward my goals based on my cash flow?",
  "Am I within my budgets?",
  "What's my net worth?",
  "How has my net worth changed?",
  "Will I run low on cash in the next 30 days?",
  "When will I be debt free?",
  "How are my investments doing?",
  "How are my investments split?",
  "What could my investments be worth in 20 years?",
];

// ---------------------------------------------------------------- language

const clean = (q: string) =>
  q
    .toLowerCase()
    .replace(/[?!.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Words people use for the categories, beyond the category's own name. */
const SYNONYMS: Record<string, string[]> = {
  dining: ["restaurant", "restaurants", "eating out", "coffee", "takeout", "take out", "cafe", "cafes", "bars"],
  food: ["grocery", "groceries", "supermarket", "supermarkets"],
  transportation: ["gas", "fuel", "gasoline", "rideshare", "uber", "lyft", "transit", "commute"],
  housing: ["rent", "mortgage"],
  utilities: ["utility", "electric", "electricity", "power", "internet", "water", "phone"],
  subscriptions: ["subscription", "streaming", "memberships", "membership"],
  healthcare: ["health", "medical", "doctor", "pharmacy", "dental", "dentist"],
  travel: ["flight", "flights", "hotel", "hotels", "vacation", "trips", "trip"],
  entertainment: ["movies", "movie", "concerts", "fun"],
  shopping: ["clothes", "clothing", "retail", "stores"],
  insurance: ["insurance"],
  debt: ["loan", "loans", "debt"],
};

interface Period {
  from: string;
  to: string;
  label: string;
  /** Set when the period is a single calendar month, so it can be compared with the one before. */
  month?: string;
}

function parsePeriod(q: string, today: string): Period {
  const month = monthKey(today);
  if (/\blast month\b|\bprevious month\b/.test(q)) {
    const m = shiftMonth(month, -1);
    return { from: `${m}-01`, to: endOfMonth(`${m}-01`), label: monthLabel(m), month: m };
  }
  if (/\b(last|past) (30|thirty) days\b/.test(q)) return { from: addDays(today, -29), to: today, label: "the last 30 days" };
  if (/\b(last|past) (90|ninety|3|three) (days|months)\b/.test(q)) return { from: addDays(today, -89), to: today, label: "the last 90 days" };
  if (/\bthis year\b|\bso far this year\b/.test(q)) return { from: `${today.slice(0, 4)}-01-01`, to: today, label: `${today.slice(0, 4)} so far` };
  if (/\ball time\b|\bever\b|\bin total\b|\boverall\b/.test(q)) return { from: "0000-01-01", to: today, label: "all the history ZeraphDesk has" };
  return { from: `${month}-01`, to: today, label: `${monthLabel(month)} so far`, month };
}

/** The stretch just before `p`, of the same length, so the two can be compared fairly. */
function previousPeriod(p: Period, today: string): Period | null {
  if (p.month) {
    const prev = shiftMonth(p.month, -1);
    const isCurrent = p.month === monthKey(today);
    const lastDay = Number(endOfMonth(`${prev}-01`).slice(8));
    // The same day of the month, or the last day if the earlier month is shorter (the 31st against February).
    const cutoff = String(Math.min(dayOfMonth(today), lastDay)).padStart(2, "0");
    const to = isCurrent ? `${prev}-${cutoff}` : endOfMonth(`${prev}-01`);
    return { from: `${prev}-01`, to, label: isCurrent ? `${monthLabel(prev)} by the same day` : monthLabel(prev), month: prev };
  }
  if (p.from === "0000-01-01") return null;
  const days = Math.round((parseISODate(p.to).getTime() - parseISODate(p.from).getTime()) / 86_400_000) + 1;
  return { from: addDays(p.from, -days), to: addDays(p.from, -1), label: "the period before" };
}

const inRange = (t: ResolvedTransaction, p: Period) => t.date >= p.from && t.date <= p.to;

// ---------------------------------------------------------------- helpers

function kindMap(c: AskContext) {
  return new Map(c.categories.map((x) => [x.id, x]));
}

/** Money out in expense categories over a period, net of refunds. */
function spendIn(c: AskContext, p: Period, filter?: (t: ResolvedTransaction) => boolean) {
  const cats = kindMap(c);
  let cents = 0;
  let count = 0;
  for (const t of c.transactions) {
    if (!inRange(t, p) || cats.get(t.categoryId)?.kind !== "expense") continue;
    if (filter && !filter(t)) continue;
    cents -= t.amountCents;
    count += 1;
  }
  return { cents, count };
}

/** Money out over a period whatever the category kind, for transfers that aren't "spending". */
function outflowIn(c: AskContext, p: Period, filter: (t: ResolvedTransaction) => boolean) {
  let cents = 0;
  let count = 0;
  for (const t of c.transactions) {
    if (!inRange(t, p) || t.amountCents >= 0 || !filter(t)) continue;
    cents -= t.amountCents;
    count += 1;
  }
  return { cents, count };
}

function byCategory(c: AskContext, p: Period) {
  const cats = kindMap(c);
  const by = new Map<string, number>();
  for (const t of c.transactions) {
    if (!inRange(t, p) || cats.get(t.categoryId)?.kind !== "expense") continue;
    by.set(t.categoryId, (by.get(t.categoryId) ?? 0) - t.amountCents);
  }
  return by;
}

const catName = (c: AskContext, id: string) => c.categories.find((x) => x.id === id)?.name ?? "Other";
const day = (iso: string) => parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const dayLong = (iso: string) => parseISODate(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "n/a");
const change = (now: number, before: number) => formatMoney(now - before, { signed: true });

function historyNote(c: AskContext, p: Period): string[] {
  const first = c.transactions.reduce((m, t) => (t.date < m ? t.date : m), c.today);
  return p.from < first ? [`ZeraphDesk's history starts ${day(first)}, so anything earlier isn't included.`] : [];
}

function frame(c: AskContext, question: string, partial: Partial<Answer> & Pick<Answer, "headline">): Answer {
  const notes = [...(partial.notes ?? [])];
  if (c.sample) notes.push("This is based on sample data, not real accounts.");
  return {
    question,
    answered: true,
    paragraphs: [],
    facts: [],
    table: null,
    used: [],
    links: [],
    basis: "calculation",
    ...partial,
    notes,
  };
}

// ---------------------------------------------------------------- answers

function topCategories(c: AskContext, q: string, p: Period): Answer {
  const now = byCategory(c, p);
  const prevP = previousPeriod(p, c.today);
  const prev = prevP ? byCategory(c, prevP) : null;
  const total = [...now.values()].reduce((s, v) => s + v, 0);
  const rows = [...now.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) {
    return frame(c, q, { headline: `No spending recorded for ${p.label}.`, used: [`Transactions from ${day(p.from)} to ${day(p.to)}`] });
  }
  const top = rows[0];
  return frame(c, q, {
    headline: `You spent ${formatMoney(total)} in ${p.label}. Most of it, ${formatMoney(top[1])} (${pct(top[1], total)}), went to ${catName(c, top[0])}.`,
    table: {
      columns: prev ? ["Category", "Spent", "Share", `vs ${prevP?.label}`] : ["Category", "Spent", "Share"],
      rows: rows.slice(0, 8).map(([id, v]) => [catName(c, id), formatMoney(v), pct(v, total), ...(prev ? [change(v, prev.get(id) ?? 0)] : [])]),
    },
    used: [
      `${rows.reduce((n, [id]) => n + c.transactions.filter((t) => t.categoryId === id && inRange(t, p)).length, 0)} transactions from ${day(p.from)} to ${day(p.to)}`,
      "Transfers, card payments and investment contributions are left out of spending",
    ],
    notes: historyNote(c, p),
    links: [{ label: "See these transactions", view: "transactions", filters: { period: p.month === monthKey(c.today) ? "this_month" : p.month ? "last_month" : "all" } }],
  });
}

function categorySpend(c: AskContext, q: string, p: Period, target: { categoryId?: string; merchant?: string }): Answer {
  const label = target.merchant ?? catName(c, target.categoryId as string);
  const spoken = target.merchant ?? label.toLowerCase();
  const moved = !target.merchant && kindMap(c).get(target.categoryId as string)?.kind === "transfer";
  const match = (t: ResolvedTransaction) => (target.merchant ? t.merchant === target.merchant : t.categoryId === target.categoryId);
  const spend = (period: Period) => (moved ? outflowIn(c, period, match) : spendIn(c, period, match));
  const now = spend(p);
  const prevP = previousPeriod(p, c.today);
  const prev = prevP ? spend(prevP) : null;

  const months = recentMonthKeys(c.today, 6).map((m) => {
    const mp: Period = { from: `${m}-01`, to: endOfMonth(`${m}-01`), label: monthLabel(m), month: m };
    return [monthLabel(m), formatMoney(spend(mp).cents)];
  });

  const merchants = new Map<string, number>();
  for (const t of c.transactions) if (inRange(t, p) && match(t) && t.amountCents < 0) merchants.set(t.merchant, (merchants.get(t.merchant) ?? 0) - t.amountCents);
  const topMerchants = [...merchants.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const recurring = c.recurring.filter((r) => r.direction === "out" && r.status !== "cancelled" && (target.merchant ? r.merchant === target.merchant : r.categoryId === target.categoryId));

  const paragraphs: string[] = [];
  if (prev && prevP) paragraphs.push(`That's ${change(now.cents, prev.cents)} compared with ${prevP.label} (${formatMoney(prev.cents)}).`);
  if (topMerchants.length > 1 && !target.merchant) paragraphs.push(`Largest: ${topMerchants.map(([m, v]) => `${m} ${formatMoney(v)}`).join(", ")}.`);
  if (recurring.length > 0) {
    paragraphs.push(`Recurring here: ${recurring.map((r) => `${r.merchant} ${formatMoney(r.amountCents)} ${FREQUENCY_LABELS[r.frequency].toLowerCase()}`).join("; ")}.`);
  }

  return frame(c, q, {
    headline: moved
      ? `${formatMoney(now.cents, { cents: now.cents < 10_000 })} moved to ${spoken} in ${p.label}, across ${now.count} ${now.count === 1 ? "transaction" : "transactions"}. That's not counted as spending.`
      : `You spent ${formatMoney(now.cents, { cents: now.cents < 10_000 })} on ${spoken} in ${p.label}, across ${now.count} ${now.count === 1 ? "transaction" : "transactions"}.`,
    paragraphs,
    table: { title: "Month by month", columns: ["Month", "Spent"], rows: months },
    used: [`${now.count} ${target.merchant ? `transactions with ${target.merchant}` : `${label} transactions`} from ${day(p.from)} to ${day(p.to)}`],
    notes: historyNote(c, p),
    links: [
      {
        label: `See ${label} transactions`,
        view: "transactions",
        filters: target.merchant
          ? { query: target.merchant, period: "all" }
          : { categoryId: target.categoryId, period: p.month === monthKey(c.today) ? "this_month" : p.month ? "last_month" : "all" },
      },
    ],
  });
}

function compareMonths(c: AskContext, q: string): Answer {
  const month = monthKey(c.today);
  const now: Period = { from: `${month}-01`, to: c.today, label: `${monthLabel(month)} so far`, month };
  const prevP = previousPeriod(now, c.today) as Period;
  const a = byCategory(c, now);
  const b = byCategory(c, prevP);
  const totalNow = [...a.values()].reduce((s, v) => s + v, 0);
  const totalPrev = [...b.values()].reduce((s, v) => s + v, 0);

  const ids = new Set([...a.keys(), ...b.keys()]);
  const moves = [...ids]
    .map((id) => ({ id, now: a.get(id) ?? 0, prev: b.get(id) ?? 0 }))
    .filter((m) => m.now !== m.prev)
    .sort((x, y) => Math.abs(y.now - y.prev) - Math.abs(x.now - x.prev))
    .slice(0, 6);

  const income = (p: Period) =>
    c.transactions.filter((t) => inRange(t, p) && kindMap(c).get(t.categoryId)?.kind === "income").reduce((s, t) => s + t.amountCents, 0);

  const diff = totalNow - totalPrev;
  return frame(c, q, {
    headline:
      diff === 0
        ? `Spending is the same as it was by this point last month (${formatMoney(totalNow)}).`
        : `You've spent ${formatMoney(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than by this point last month: ${formatMoney(totalNow)} against ${formatMoney(totalPrev)}.`,
    facts: [
      { label: `Spending, ${now.label}`, value: formatMoney(totalNow) },
      { label: `Spending, ${prevP.label}`, value: formatMoney(totalPrev) },
      { label: "Income now vs then", value: `${formatMoney(income(now))} vs ${formatMoney(income(prevP))}` },
    ],
    table: {
      title: "Biggest changes by category",
      columns: ["Category", "Now", "Then", "Change"],
      rows: moves.map((m) => [catName(c, m.id), formatMoney(m.now), formatMoney(m.prev), change(m.now, m.prev)]),
    },
    used: [`Spending through day ${dayOfMonth(c.today)} of ${monthLabel(month)} and of ${monthLabel(shiftMonth(month, -1))}`],
    notes: ["Both months are cut off at the same day, so a partly finished month isn't compared with a whole one."],
    links: [{ label: "See this month's transactions", view: "transactions", filters: { period: "this_month" } }],
  });
}

function billsComing(c: AskContext, q: string): Answer {
  const ahead = upcoming(c.recurring, c.today, 30);
  const outgoing = ahead.occurrences.filter((o) => o.payment.direction === "out" && o.payment.kind === "expense");
  if (outgoing.length === 0) {
    return frame(c, q, { headline: "No recurring bills or subscriptions are expected in the next 30 days.", basis: "projection", used: ["Recurring payments found in your transactions"] });
  }
  const cash = accountTotals(c.accounts).cashCents;
  return frame(c, q, {
    headline: `${outgoing.length} ${outgoing.length === 1 ? "payment is" : "payments are"} expected in the next 30 days, about ${formatMoney(ahead.spendingCents)} in all.`,
    facts: [
      { label: "Expected bills and subscriptions", value: formatMoney(ahead.spendingCents) },
      { label: "Cash available today", value: formatMoney(cash) },
    ],
    table: {
      columns: ["Due", "Payment", "Amount", "Autopay"],
      rows: outgoing.slice(0, 12).map((o) => [dayLong(o.date), o.payment.merchant, `${o.payment.variable ? "about " : ""}${formatMoney(o.payment.amountCents)}`, o.payment.autopay === "on" ? "On" : o.payment.autopay === "off" ? "Off" : "Not set"]),
    },
    used: ["Recurring payments detected in your transactions, and any you added"],
    notes: ["These come from repeating patterns. One-off spending isn't included, and dates and amounts can differ."],
    links: [{ label: "Open bills", view: "bills" }],
    basis: "projection",
  });
}

function subscriptions(c: AskContext, q: string): Answer {
  const list = c.recurring
    .filter((r) => r.direction === "out" && r.kind === "expense" && !r.isBill && r.status !== "cancelled")
    .sort((a, b) => b.annualCents - a.annualCents);
  if (list.length === 0) return frame(c, q, { headline: "No subscriptions found in your recurring payments.", used: ["Recurring payments found in your transactions"] });
  const yearly = list.reduce((s, r) => s + r.annualCents, 0);
  return frame(c, q, {
    headline: `You're paying for ${list.length} ${list.length === 1 ? "subscription" : "subscriptions"}, about ${formatMoney(Math.round(yearly / 12))} a month and ${formatMoney(yearly)} a year.`,
    table: {
      columns: ["Subscription", "Amount", "Per year", "Next"],
      rows: list.map((r) => [r.merchant, `${formatMoney(r.amountCents, { cents: true })} / ${r.frequency === "monthly" ? "month" : FREQUENCY_LABELS[r.frequency].toLowerCase()}`, formatMoney(r.annualCents), day(r.nextDate)]),
    },
    used: [`${list.length} recurring payments that aren't marked as bills`, "Ones you've marked cancelled aren't counted"],
    notes: ["Yearly charges need over a year of history to be found. Add them under Recurring."],
    links: [{ label: "Open recurring", view: "recurring" }],
  });
}

function largestRecurring(c: AskContext, q: string): Answer {
  const list = c.recurring
    .filter((r) => r.direction === "out" && r.kind === "expense" && r.status !== "cancelled")
    .sort((a, b) => b.annualCents - a.annualCents)
    .slice(0, 6);
  if (list.length === 0) return frame(c, q, { headline: "No recurring expenses found.", used: ["Recurring payments found in your transactions"] });
  const total = c.recurring.filter((r) => r.direction === "out" && r.kind === "expense" && r.status !== "cancelled").reduce((s, r) => s + r.annualCents, 0);
  return frame(c, q, {
    headline: `Your largest recurring expense is ${list[0].merchant}, about ${formatMoney(list[0].annualCents)} a year (${pct(list[0].annualCents, total)} of all recurring spending).`,
    table: {
      columns: ["Payment", "Amount", "How often", "Per year"],
      rows: list.map((r) => [r.merchant, `${r.variable ? "about " : ""}${formatMoney(r.amountCents)}`, FREQUENCY_LABELS[r.frequency], formatMoney(r.annualCents)]),
    },
    used: ["Recurring payments detected in your transactions, ranked by yearly cost"],
    links: [{ label: "Open recurring", view: "recurring" }],
  });
}

function savingsCapacity(c: AskContext, q: string): Answer {
  const flows = completeMonths(monthlyFlows(c.transactions, kindMap(c), c.today), c.today);
  if (flows.length === 0) return frame(c, q, { answered: false, headline: "There isn't a full month of history yet, so I can't say.", used: [] });
  const avg = average(flows.map((f) => f.surplusCents));
  const low = flows.reduce((m, f) => (f.surplusCents < m.surplusCents ? f : m), flows[0]);
  const goals = c.goals.map((g) => ({ g, p: goalProgress(g, c.contributions, c.today) })).filter((x) => !x.p.reached).slice(0, 3);
  const paragraphs = goals.map(({ g, p }) =>
    p.requiredMonthlyCents !== null
      ? `${g.name} needs about ${formatMoney(p.requiredMonthlyCents)} a month to hit its deadline.`
      : `${g.name} has ${formatMoney(p.remainingCents)} to go and no deadline.`,
  );
  return frame(c, q, {
    headline: `Over the last ${flows.length} full months, about ${formatMoney(avg)} a month was left over after spending. The smallest month left ${formatMoney(low.surplusCents)} (${monthLabel(low.month)}).`,
    paragraphs,
    facts: [
      { label: "Average left over", value: formatMoney(avg) },
      { label: `Lowest month (${monthLabel(low.month)})`, value: formatMoney(low.surplusCents) },
      { label: "Months looked at", value: String(flows.length) },
    ],
    used: [`Income and spending for ${flows.length} complete months`],
    notes: [
      "This is a look back, not a forecast. It doesn't know about one-off costs or changes in your income, and ZeraphDesk can't tell you what amount is safe for you.",
      "Money moved to savings or investments counts as left over, since transfers aren't treated as spending.",
    ],
    links: [
      { label: "Open goals", view: "goals" },
      { label: "Open cash flow", view: "cash-flow" },
    ],
  });
}

function budgetStatus(c: AskContext, q: string): Answer {
  const rows = budgetRows(c.transactions, c.categories, c.recurring, c.budgets, c.today).filter((r) => r.budgetCents !== null);
  if (rows.length === 0) {
    return frame(c, q, { headline: "You haven't set any budgets yet.", used: [], links: [{ label: "Open budgets", view: "budgets" }] });
  }
  const over = rows.filter((r) => (r.remainingCents ?? 0) < 0);
  return frame(c, q, {
    headline: over.length === 0 ? `All ${rows.length} of your budgets are within their limits so far this month.` : `${over.length} of ${rows.length} budgets are over their limit so far this month: ${over.map((r) => catName(c, r.categoryId)).join(", ")}.`,
    table: {
      columns: ["Category", "Budget", "Spent", "Left", "Projected"],
      rows: rows.map((r) => [catName(c, r.categoryId), formatMoney(r.budgetCents ?? 0), formatMoney(r.actualCents), formatMoney(r.remainingCents ?? 0), formatMoney(r.projectedCents)]),
    },
    used: [`${monthLabel(monthKey(c.today))} spending so far, and your ${rows.length} budgets`],
    notes: ["Projected is an estimate: spent so far, plus recurring payments still expected, plus your everyday pace."],
    links: [{ label: "Open budgets", view: "budgets" }],
  });
}

function goalsStatus(c: AskContext, q: string): Answer {
  if (c.goals.length === 0) return frame(c, q, { headline: "You haven't set any goals yet.", links: [{ label: "Open goals", view: "goals" }] });
  const rows = c.goals.map((g) => ({ g, p: goalProgress(g, c.contributions, c.today) }));
  return frame(c, q, {
    headline: `You have ${rows.length} ${rows.length === 1 ? "goal" : "goals"}: ${rows.filter((r) => r.p.reached).length} reached.`,
    table: {
      columns: ["Goal", "Saved", "Progress", "Needed / month", "Projected finish"],
      rows: rows.map(({ g, p }) => [g.name, `${formatMoney(p.currentCents)} of ${formatMoney(g.targetCents)}`, `${Math.round(p.fraction * 100)}%`, p.requiredMonthlyCents === null ? "n/a" : formatMoney(p.requiredMonthlyCents), p.reached ? "Reached" : p.projectedDate ? `${monthLabel(monthKey(p.projectedDate))} ${p.projectedDate.slice(0, 4)}` : "n/a"]),
    },
    used: ["The goals and contributions you've recorded"],
    notes: ["Progress is what you've recorded, not read from an account. Projected finishes assume the same amount every month."],
    links: [{ label: "Open goals", view: "goals" }],
    basis: "projection",
  });
}

function netWorth(c: AskContext, q: string): Answer {
  const t = netWorthNow(c.accounts, c.holdings);
  const groups = ACCOUNT_GROUPS.map((g) => ({
    label: g.label,
    cents: c.accounts.filter((a) => ACCOUNT_KINDS[a.kind].group === g.key).reduce((s, a) => s + a.balanceCents, 0),
    owed: g.key === "credit" || g.key === "loans",
  }));
  if (t.otherAssetsCents > 0) groups.push({ label: "Homes, vehicles and other assets you entered", cents: t.otherAssetsCents, owed: false });
  if (t.otherDebtCents > 0) groups.push({ label: "Other debts you entered", cents: t.otherDebtCents, owed: true });
  return frame(c, q, {
    headline: `Your net worth is ${formatMoney(t.netWorthCents)}: ${formatMoney(t.assetsCents)} in assets minus ${formatMoney(t.liabilitiesCents)} owed.`,
    table: { columns: ["Group", "Balance"], rows: groups.filter((g) => g.cents > 0).map((g) => [g.label, `${formatMoney(g.cents)}${g.owed ? " owed" : ""}`]) },
    used: [`${c.accounts.length} account balances as last reported`, ...(c.holdings.length ? [`${c.holdings.length} ${c.holdings.length === 1 ? "item" : "items"} you entered by hand`] : [])],
    links: [{ label: "Open net worth", view: "net-worth" }],
  });
}

function netWorthWhy(c: AskContext, q: string): Answer {
  const t = netWorthNow(c.accounts, c.holdings);
  if (c.history.length === 0) {
    return frame(c, q, {
      answered: false,
      headline: "I can't say how your net worth changed, because this data doesn't include past balances.",
      paragraphs: [`I can tell you where it stands today: ${formatMoney(t.netWorthCents)}. Without earlier balances to compare, any explanation would be a guess, so I won't offer one.`],
      used: ["Current balances only. There is no balance history."],
      links: [{ label: "Open cash flow", view: "cash-flow" }],
    });
  }
  const said = q.toLowerCase();
  const range = /year|12 months|annual/.test(said) ? RANGES[3] : /90|three months|quarter/.test(said) ? RANGES[2] : RANGES[1];
  const h = netWorthHistory(c.accounts, c.history, c.holdings, c.today, range);
  const first = h.points[0];
  const delta = t.netWorthCents - first.netWorthCents;
  const words = range.days === 365 ? "the last year" : `the last ${range.days} days`;
  const lead = /\bwhy\b/.test(said) ? "I can show what moved, though not why. " : "";
  return frame(c, q, {
    headline:
      lead +
      (delta === 0
        ? `Your net worth is the same as it was ${words} ago, ${formatMoney(t.netWorthCents)}.`
        : `Your net worth is ${delta > 0 ? "up" : "down"} ${formatMoney(Math.abs(delta))} over ${words}, from ${formatMoney(first.netWorthCents)} to ${formatMoney(t.netWorthCents)}.`),
    table: {
      columns: ["Group", `${day(h.from)}`, "Today", "Effect on net worth"],
      rows: h.slices.map((r) => [
        SLICE_LABELS[r.slice] + (r.owed ? " (owed)" : ""),
        formatMoney(r.startCents),
        formatMoney(r.endCents),
        formatMoney(r.owed ? r.startCents - r.endCents : r.endCents - r.startCents, { signed: true }),
      ]),
    },
    used: [`Account balances from ${day(h.from)} to today`, ...h.notes],
    notes: ["This shows which balances moved, not why. ZeraphDesk can't tell whether a change came from saving, spending, paying down debt or the market."],
    links: [{ label: "Open net worth", view: "net-worth" }],
  });
}

/** A share as a percent with a real minus sign, matching how money is written. */
const rate = (x: number, digits = 1) => `${x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(digits)}%`;

function portfolioAnswer(c: AskContext, q: string): Answer {
  const inv = investmentAccounts(c.accounts);
  if (inv.length === 0) {
    return frame(c, q, { answered: false, headline: "I can't answer that: there are no investment accounts.", used: [] });
  }
  const said = q.toLowerCase();
  const range = /all time|since (the )?(start|beginning)|overall/.test(said) ? RANGES[5] : /90|three months|quarter/.test(said) ? RANGES[2] : /30|month/.test(said) ? RANGES[1] : RANGES[3];
  const words = range.days === null ? "all the history there is" : range.days === 365 ? "the last year" : `the last ${range.days} days`;
  const s = portfolioSummary(c.accounts, c.positions);
  const contrib = contributionSummary(c.accounts, c.activity, c.today);
  const p = performance(c.accounts, c.history, c.activity, c.today, range);
  const facts = [
    { label: "Value today (reported)", value: formatMoney(s.valueCents) },
    ...(s.dailyChangeCents === null ? [] : [{ label: "Today's change", value: `${formatMoney(s.dailyChangeCents, { signed: true })}${s.dailyPct === null ? "" : ` (${rate(s.dailyPct, 2)})`}` }]),
    { label: "Put in, last 12 months", value: formatMoney(contrib.last12Cents) },
    ...(p ? [{ label: `Growth over ${words}`, value: formatMoney(p.growthCents, { signed: true }) }] : []),
    ...(p && p.returnPct !== null ? [{ label: "Return (estimate)", value: `${rate(p.returnPct)}${p.annualizedPct !== null ? `, about ${rate(p.annualizedPct)} a year` : ""}` }] : []),
  ];
  return frame(c, q, {
    headline: p
      ? `Your investments are worth ${formatMoney(s.valueCents)}. Over ${words} they're ${p.growthCents >= 0 ? "up" : "down"} ${formatMoney(Math.abs(p.growthCents))} from growth, after ${formatMoney(p.netContributionsCents)} you put in.`
      : `Your investments are worth ${formatMoney(s.valueCents)}. I can't say how they've moved: this data doesn't include past balances.`,
    facts,
    table: {
      columns: ["Account", "Value", "Today"],
      rows: inv.map((a) => {
        const held = c.positions.filter((x) => x.accountId === a.id);
        const ch = held.reduce((t, x) => t + Math.round(x.quantity * (x.priceCents - x.previousCloseCents)), 0);
        return [a.name, formatMoney(a.balanceCents), held.length ? formatMoney(ch, { signed: true, cents: true }) : "n/a"];
      }),
    },
    used: ["Investment account balances and holdings as last reported", ...(p ? [`Balance history and deposits from ${day(p.from)} to today`] : [])],
    notes: ["Return uses the Modified Dietz method, which counts when money went in. It's an estimate, and it says nothing about what comes next.", ...(p ? p.notes : [])],
    links: [{ label: "Open investments", view: "investments" }],
  });
}

function allocationAnswer(c: AskContext, q: string): Answer {
  const s = portfolioSummary(c.accounts, c.positions);
  const slices = allocation(c.accounts, c.positions);
  if (slices.length === 0 || s.valueCents === 0) {
    return frame(c, q, { answered: false, headline: "I can't say how your investments are split: there aren't any listed.", used: [] });
  }
  const conc = concentration(holdingRows(c.accounts, c.positions));
  const label = (k: string) => (k === "unclassified" ? "Not broken down" : ASSET_CLASSES[k as keyof typeof ASSET_CLASSES]);
  const top = slices[0];
  return frame(c, q, {
    headline: `${Math.round(top.fraction * 100)}% of your ${formatMoney(s.valueCents)} in investments is ${top.key === "unclassified" ? "in accounts whose holdings aren't listed" : `in ${label(top.key)}`}.`,
    table: { columns: ["Kind", "Value", "Share"], rows: slices.map((x) => [label(x.key), formatMoney(x.cents), `${(x.fraction * 100).toFixed(1)}%`]) },
    facts: [
      ...(conc.largest ? [{ label: "Largest single holding", value: `${conc.largest.position.name}, ${(conc.largest.share * 100).toFixed(1)}%` }] : []),
      ...(conc.largestStock ? [{ label: "Largest single company", value: `${conc.largestStock.position.name}, ${(conc.largestStock.share * 100).toFixed(1)}%` }] : []),
    ],
    used: ["The holdings listed in your investment accounts, at their latest prices"],
    notes: ["This describes how your money is split. It isn't a view on whether the split suits you, and it isn't advice."],
    links: [{ label: "Open allocation", view: "investments" }],
  });
}

function longTermAnswer(c: AskContext, q: string): Answer {
  const s = portfolioSummary(c.accounts, c.positions);
  const contrib = contributionSummary(c.accounts, c.activity, c.today);
  const asked = q.match(/(\d+)\s*years?/);
  const years = asked ? Math.min(60, Math.max(1, Number(asked[1]))) : c.longTerm.years;
  const a = { ...c.longTerm, years };
  const monthly = a.monthlyCents ?? Math.max(0, contrib.monthlyCents);
  const r = projectRange(s.valueCents, monthly, a);
  const end = (p: typeof r.mid) => p.years[years].nominalCents;
  const reach = a.targetCents ? monthsToTarget(s.valueCents, monthly, a.returnBps, a.targetCents) : null;
  const usingDefaults = JSON.stringify(c.longTerm) === JSON.stringify(DEFAULT_LONG_TERM);
  const rate = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;
  return frame(c, q, {
    headline: `If your investments grew ${rate(a.returnBps)} a year and you added ${formatMoney(monthly)} a month, they could be about ${formatMoney(end(r.mid))} in ${years} ${years === 1 ? "year" : "years"}. That's a projection, not a prediction.`,
    facts: [
      { label: "Starting value", value: formatMoney(s.valueCents) },
      { label: `At ${rate(r.low.returnBps)} a year`, value: formatMoney(end(r.low)) },
      { label: `At ${rate(r.mid.returnBps)} a year (assumed)`, value: formatMoney(end(r.mid)) },
      { label: `At ${rate(r.high.returnBps)} a year`, value: formatMoney(end(r.high)) },
      { label: "What you'd have put in", value: formatMoney(r.mid.years[years].contributedCents) },
      ...(a.targetCents ? [{ label: `Time to reach ${formatMoney(a.targetCents)}`, value: reach === null ? "not within 60 years" : reach === 0 ? "already there" : `${Math.floor(reach / 12)} years ${reach % 12} months` }] : []),
    ],
    used: ["Your investment accounts' value today", a.monthlyCents !== null ? "The monthly amount you entered" : "Your pace of deposits over the last year", "The growth rate and length you set on the Long-term plan"],
    notes: [
      ...(usingDefaults ? ["You haven't set your own assumptions, so these are the defaults (5% a year, 20 years). They're a starting point, not a forecast."] : []),
      "Markets don't grow steadily. Fees and taxes aren't included.",
    ],
    links: [{ label: "Open the long-term plan", view: "investments" }],
    basis: "projection",
  });
}

function forecastAnswer(c: AskContext, q: string): Answer {
  const asked = q.match(/(\d+) days?/);
  const days = asked ? Math.min(180, Math.max(1, Number(asked[1]))) : /end of (the )?month/.test(q) ? Math.max(1, Number(endOfMonth(c.today).slice(8)) - dayOfMonth(c.today)) : 30;
  const f = buildForecast({
    today: c.today,
    days,
    accounts: c.accounts,
    transactions: c.transactions,
    categories: kindMap(c),
    recurring: c.recurring,
    planned: c.planned,
    includeEveryday: true,
  });
  if (!f) {
    return frame(c, q, { answered: false, headline: "I can't project that: there's no checking or cash account to follow.", basis: "projection", used: [] });
  }
  const names = f.accounts.map((a) => a.name).join(", ");
  const end = f.points[f.points.length - 1].date;
  const below = f.firstBelowZero;
  const biggest = [...f.events].sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents)).slice(0, 6);
  return frame(c, q, {
    headline: below
      ? `At this pace, ${names} is projected to go below $0 around ${dayLong(below)}. That's an estimate, not a certainty.`
      : `${names} is projected to hold above $0 for the next ${days} days, ending near ${formatMoney(f.endCents)} on ${day(end)}. That's an estimate, not a promise.`,
    facts: [
      { label: "Balance today (reported)", value: formatMoney(f.startCents) },
      { label: `Projected on ${day(end)}`, value: formatMoney(f.endCents) },
      { label: "Lowest projected", value: `${formatMoney(f.lowest.balanceCents)} around ${day(f.lowest.date)}` },
    ],
    table: {
      title: "Largest expected items",
      columns: ["Date", "Item", "Amount"],
      rows: biggest.map((e) => [day(e.date), e.label, formatMoney(e.amountCents, { signed: true, cents: true })]),
    },
    used: [
      `Recurring payments and income expected on ${names}`,
      ...(c.planned.length ? ["Items you planned"] : []),
      "A steady estimate of everyday spending from the last few months",
    ],
    notes: [...f.notes, "It assumes each payment arrives on its usual date for its usual amount."],
    links: [{ label: "Open forecast", view: "forecast" }],
    basis: "projection",
  });
}

function debtFreeAnswer(c: AskContext, q: string): Answer {
  const debts = modellableDebts(c.accounts, c.debtTerms);
  if (debts.length === 0) {
    return frame(c, q, {
      answered: false,
      headline: "I can't estimate a payoff date yet: none of your debts has a rate and monthly payment entered.",
      paragraphs: ["A payoff date needs the interest rate and what you pay each month. ZeraphDesk can't work those out from a balance. Add them on the Debt page and ask again."],
      basis: "projection",
      used: [],
      links: [{ label: "Open debt", view: "debt" }],
    });
  }
  const r = simulatePayoff(debts, c.today);
  const missing = c.accounts.filter((a) => ACCOUNT_KINDS[a.kind].class === "liability" && a.balanceCents > 0 && !debts.some((d) => d.id === a.id));
  const when = (iso: string | null) => (iso ? `${monthLabel(monthKey(iso))} ${iso.slice(0, 4)}` : "Not within 50 years");
  return frame(c, q, {
    headline: r.payoffDate
      ? `At the payments you entered, ${missing.length ? "the debts with a rate and payment are" : "your debts are"} projected to be paid off around ${when(r.payoffDate)}, with about ${formatMoney(r.totalInterestCents)} in interest.`
      : "At the payments you entered, at least one debt isn't projected to be paid off within 50 years.",
    table: { columns: ["Debt", "Owed", "Rate", "Payment", "Paid off"], rows: debts.map((d) => [d.name, formatMoney(d.balanceCents), `${(d.aprBps / 100).toFixed(2)}%`, formatMoney(d.paymentCents, { cents: true }), when(r.perDebt.find((p) => p.id === d.id)?.payoffDate ?? null)]) },
    used: ["The rates and payments you entered under Debt", "Interest compounding monthly, with no new charges"],
    notes: [
      ...(missing.length ? [`${missing.map((a) => a.name).join(", ")} ${missing.length === 1 ? "has" : "have"} no rate or payment entered, so ${missing.length === 1 ? "it isn't" : "they aren't"} counted.`] : []),
      "Real statements round slightly differently, so treat the date as close, not exact.",
    ],
    links: [{ label: "Open debt", view: "debt" }],
    basis: "projection",
  });
}

function cashNow(c: AskContext, q: string): Answer {
  const cash = c.accounts.filter((a) => ACCOUNT_KINDS[a.kind].group === "cash");
  const total = cash.reduce((s, a) => s + a.balanceCents, 0);
  return frame(c, q, {
    headline: `You have ${formatMoney(total)} in cash across ${cash.length} ${cash.length === 1 ? "account" : "accounts"}.`,
    table: { columns: ["Account", "Institution", "Balance"], rows: cash.map((a) => [a.name, c.institutions.get(a.institutionId) ?? "", formatMoney(a.balanceCents, { cents: true })]) },
    used: ["Cash account balances as last reported"],
    basis: "fact",
    links: [{ label: "Open accounts", view: "accounts" }],
  });
}

function incomeAnswer(c: AskContext, q: string, p: Period): Answer {
  const cats = kindMap(c);
  const income = c.transactions.filter((t) => inRange(t, p) && cats.get(t.categoryId)?.kind === "income");
  const total = income.reduce((s, t) => s + t.amountCents, 0);
  const sources = new Map<string, number>();
  for (const t of income) sources.set(t.merchant, (sources.get(t.merchant) ?? 0) + t.amountCents);
  return frame(c, q, {
    headline: `${formatMoney(total)} came in during ${p.label}, across ${income.length} ${income.length === 1 ? "deposit" : "deposits"}.`,
    table: { columns: ["Source", "Received"], rows: [...sources.entries()].sort((a, b) => b[1] - a[1]).map(([m, v]) => [m, formatMoney(v, { cents: true })]) },
    used: [`Income transactions from ${day(p.from)} to ${day(p.to)}`],
    notes: historyNote(c, p),
    links: [{ label: "Open cash flow", view: "cash-flow" }],
  });
}

function notUnderstood(c: AskContext, q: string): Answer {
  return frame(c, q, {
    answered: false,
    headline: "I can't answer that one yet.",
    paragraphs: [
      "I answer questions about your spending, recurring payments, bills, budgets, goals, cash flow and balances, using the data on this computer. I only give numbers I can point to. Try asking one of these, or name a category or a merchant.",
    ],
    used: [],
  });
}

// ---------------------------------------------------------------- routing

function findTarget(c: AskContext, q: string): { categoryId?: string; merchant?: string } | null {
  // Merchants first: "Netflix" is more specific than the category it belongs to.
  const merchants = [...new Set(c.transactions.map((t) => t.merchant))].sort((a, b) => b.length - a.length);
  const merchant = merchants.find((m) => q.includes(m.toLowerCase()));
  if (merchant) return { merchant };

  const words = (s: string) => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`);
  for (const cat of c.categories) {
    if (cat.kind === "income") continue;
    const names = [cat.name.toLowerCase(), ...(SYNONYMS[cat.id] ?? [])];
    if (names.some((n) => words(n).test(q))) return { categoryId: cat.id };
  }
  return null;
}

/** Work out an answer to a plain-English question from the data in `c`. */
export function answer(question: string, c: AskContext): Answer {
  const q = clean(question);
  if (!q) return notUnderstood(c, question);
  const p = parsePeriod(q, c.today);

  const investy = /(invest|portfolio|401|brokerage|retirement (account|fund)|nest egg)/.test(q);
  if (/(retire|long.?term|nest egg)/.test(q) || (investy && /(\d+\s*years?|future|grow)/.test(q))) return longTermAnswer(c, question);
  if (/(allocation|diversif|asset class|\bstocks?\b|\bbonds?\b|concentrat)/.test(q) || (investy && /(split|mix|risk|spread)/.test(q))) return allocationAnswer(c, question);
  if (investy) return portfolioAnswer(c, question);
  if (/net worth|worth/.test(q)) return /(why|what|how).*(change|changed|move|moved|drop|dropped|go up|went up|go down|went down|differ)|change.*net worth/.test(q) ? netWorthWhy(c, question) : netWorth(c, question);
  if (/(debt.?free|pay(ing)? (it |them |my \w+ )?off|payoff|pay down)/.test(q) || (/when (will|do) i/.test(q) && /(debt|loan|card|mortgage)/.test(q))) return debtFreeAnswer(c, question);
  if (/(run (out|low|short)|go (negative|below zero|overdrawn)|overdraft|will i have enough|forecast|projected|project my|what will my (balance|cash|checking)|balance (in|by|after|at the end)|cash (in|by|at the end of))/.test(q)) return forecastAnswer(c, question);
  if (/(compared|compare|versus|vs)\b.*\b(last|previous) month|what changed|how (does|is) this month/.test(q)) return compareMonths(c, question);
  if (/\bbills?\b/.test(q) && /(coming|upcoming|due|next|soon|owe)/.test(q)) return billsComing(c, question);
  if (/subscriptions?/.test(q)) return subscriptions(c, question);
  if (/(largest|biggest|top|most expensive).*(recurring|repeating|monthly)|recurring.*(largest|biggest)/.test(q)) return largestRecurring(c, question);
  if (/how much (can|could|should)|put toward|set aside|afford to (save|put)|safely/.test(q)) return savingsCapacity(c, question);
  if (/\bbudgets?\b/.test(q)) return budgetStatus(c, question);
  if (/\bgoals?\b/.test(q)) return goalsStatus(c, question);
  if (/(how much|what).*(cash|balance)|cash do i have|money do i have/.test(q)) return cashNow(c, question);

  const target = findTarget(c, q);
  if (target && /(spend|spent|pay|paid|cost|much|total)/.test(q)) return categorySpend(c, question, p, target);

  if (/(income|earn|earned|paycheck|salary|make|made|got paid)/.test(q) && !target) return incomeAnswer(c, question, p);
  if (/(where|what).*(money|spend|spent|go|went)|top (spending|categories)|biggest (spending|expense)|breakdown|spending by/.test(q)) return topCategories(c, question, p);
  if (target) return categorySpend(c, question, p, target);
  if (/(spend|spent|spending)/.test(q)) return topCategories(c, question, p);

  return notUnderstood(c, question);
}

