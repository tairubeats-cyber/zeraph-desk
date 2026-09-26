/**
 * The Financial Health Center's numbers. Six areas (cash flow, savings, debt, investing, spending, goals), each a
 * handful of plain figures worked out from the same data the rest of the app shows, and never boiled down to one
 * score: a single grade would hide the parts that matter and invite a verdict this app has no standing to give.
 *
 * Everything here reuses the existing calculations (cash flow, recurring, goals, debt payoff, investment
 * performance, spending analysis) so a figure means the same thing on every screen. Each metric says what kind of
 * statement it is (fact, calculation or projection), and when something can't be worked out it says why instead
 * of showing a zero.
 */
import {
  ACCOUNT_KINDS,
  ASSET_CLASSES,
  type Basis,
  type BalancePoint,
  type Category,
  type DebtTerms,
  type FinancialAccount,
  type Goal,
  type GoalContribution,
  type Holding,
  type InvestmentActivity,
  type LongTermAssumptions,
  type PlannedItem,
  type Position,
  type RecurringPayment,
  type ResolvedTransaction,
} from "./types";
import type { ViewKey } from "../../nav";
import { addDays, formatMoney, friendlyDate, monthKey, monthLabel, monthYearLabel } from "./money";
import { average, completeMonths, monthlyFlows, spendingSplit, upcoming, type MonthFlow } from "./cashflow";
import { goalProgress, type GoalProgress } from "./goals";
import { modellableDebts, payoffProgress, simulatePayoff } from "./debt";
import { spendingAccounts } from "./forecast";
import { allocation, contributionSummary, investmentAccounts, performance, portfolioSummary, type AllocationSlice } from "./investments";
import { monthsToTarget } from "./longterm";
import { RANGES } from "./networth";
import { spendingReport, spendingTrend, yearUnavailableReason, type CategoryLine, type TrendPoint } from "./spending";

export type DimensionKey = "cash-flow" | "savings" | "debt" | "investing" | "spending" | "goals";

export type MetricKind = "money" | "percent" | "months" | "count" | "text";

export interface Metric {
  id: string;
  label: string;
  basis: Basis;
  kind: MetricKind;
  /** Cents for money, a fraction for percent (0.1 is 10%), months, or a count. null when it can't be worked out. */
  value: number | null;
  /** For kind "text", or the words that go with the number. */
  text?: string;
  /** Show a plus or minus sign: the figure is a change, not an amount. */
  signed?: boolean;
  /** One plain sentence on how the figure is worked out. */
  note?: string;
  /** Why there's no number, in plain words. Shown instead of a figure. */
  missing?: string;
}

export interface GoalRow {
  goal: Goal;
  progress: GoalProgress;
}

export interface DebtRow {
  id: string;
  name: string;
  kind: FinancialAccount["kind"];
  balanceCents: number;
  aprBps: number | null;
  paymentCents: number | null;
  /** About a month's interest at today's balance and the rate entered; null without a rate. */
  monthlyInterestCents: number | null;
  /** How much of the largest balance on record has been paid off; null with no history. */
  paidFraction: number | null;
  since: string | null;
}

export interface LargeExpense {
  date: string;
  name: string;
  cents: number;
  source: "recurring" | "planned";
}

export type Detail =
  | { kind: "cash-flow"; months: MonthFlow[]; recurringMonthlyCents: number; large: LargeExpense[] }
  | {
      kind: "savings";
      cashAccounts: { id: string; name: string; balanceCents: number }[];
      cashCents: number;
      monthsCovered: number | null;
      targetMonths: number | null;
      targetCents: number | null;
      goals: GoalRow[];
    }
  | { kind: "debt"; debts: DebtRow[]; debtFreeDate: string | null; modelledAll: boolean; interestToPayOffCents: number | null }
  | {
      kind: "investing";
      valueCents: number;
      allocation: (AllocationSlice & { label: string })[];
      accounts: { id: string; name: string; balanceCents: number }[];
      targetCents: number | null;
    }
  | { kind: "spending"; month: string; lines: CategoryLine[]; trend: TrendPoint[]; totalCents: number }
  | { kind: "goals"; goals: GoalRow[] };

export interface Dimension {
  key: DimensionKey;
  label: string;
  /** The screen with the fuller picture. */
  view: ViewKey;
  /** A neutral sentence about where this area stands, or that there isn't enough to say. */
  summary: string;
  metrics: Metric[];
  detail: Detail;
  /** False when there's nothing here to look at yet (no debts, no investments). */
  hasData: boolean;
}

export interface HealthInput {
  today: string;
  accounts: FinancialAccount[];
  transactions: ResolvedTransaction[];
  categories: Map<string, Category>;
  recurring: RecurringPayment[];
  goals: Goal[];
  contributions: GoalContribution[];
  terms: Map<string, DebtTerms>;
  holdings: Holding[];
  planned: PlannedItem[];
  balanceHistory: BalancePoint[];
  positions: Position[];
  activity: InvestmentActivity[];
  longTerm: LongTermAssumptions;
  /** The checking balance the person likes to stay above. */
  reserveCents: number | null;
  /** How many months of spending the person wants set aside; null until they say. */
  emergencyMonths: number | null;
}

const NO_FULL_MONTH = "Needs at least one complete month of transactions.";
const money = (cents: number) => formatMoney(cents);

// ---------------------------------------------------------------------------------------------------------------------

/** What a typical recent month looks like, from the last complete months (up to three). */
function recentMonths(input: HealthInput) {
  const flows = monthlyFlows(input.transactions, input.categories, input.today, 7);
  const complete = completeMonths(flows, input.today);
  const last3 = complete.slice(-3);
  const income = last3.reduce((s, f) => s + f.incomeCents, 0);
  const surplus = last3.reduce((s, f) => s + f.surplusCents, 0);
  const spending = last3.reduce((s, f) => s + f.spendingCents, 0);
  return {
    flows,
    complete,
    count: last3.length,
    avgIncomeCents: last3.length ? Math.round(income / last3.length) : null,
    avgSpendingCents: last3.length ? Math.round(spending / last3.length) : null,
    avgSurplusCents: last3.length ? average(last3.map((f) => f.surplusCents)) : null,
    rate: income > 0 ? surplus / income : null,
  };
}

/** The last three complete months against the three before them, or null without six. */
function trendOf(complete: MonthFlow[], pick: (f: MonthFlow) => number): { changeCents: number; recentCents: number; earlierCents: number } | null {
  if (complete.length < 6) return null;
  const recentCents = average(complete.slice(-3).map(pick));
  const earlierCents = average(complete.slice(-6, -3).map(pick));
  return { changeCents: recentCents - earlierCents, recentCents, earlierCents };
}

// ---- cash flow --------------------------------------------------------------------------------------------------------

function cashFlow(input: HealthInput): Dimension {
  const r = recentMonths(input);
  const current = r.flows[r.flows.length - 1];
  const recurringOut = input.recurring.filter((p) => p.direction === "out" && p.kind === "expense");
  const recurringMonthly = Math.round(recurringOut.reduce((s, p) => s + p.annualCents, 0) / 12);
  const trend = trendOf(r.complete, (f) => f.surplusCents);

  const ahead = upcoming(input.recurring, input.today, 30).occurrences
    .filter((o) => o.payment.direction === "out" && o.payment.kind === "expense")
    .map<LargeExpense>((o) => ({ date: o.date, name: o.payment.merchant, cents: o.payment.amountCents, source: "recurring" }));
  const planned = input.planned
    .filter((p) => p.direction === "out" && p.date >= input.today && p.date <= addDays(input.today, 30))
    .map<LargeExpense>((p) => ({ date: p.date, name: p.name, cents: p.amountCents, source: "planned" }));
  const large = [...ahead, ...planned].sort((a, b) => b.cents - a.cents || a.date.localeCompare(b.date)).slice(0, 5);

  const metrics: Metric[] = [
    { id: "income", label: `Income, ${monthLabel(monthKey(input.today))} so far`, basis: "calculation", kind: "money", value: current.incomeCents },
    { id: "spending", label: `Spending, ${monthLabel(monthKey(input.today))} so far`, basis: "calculation", kind: "money", value: current.spendingCents, note: "Transfers, card payments and investing aren't counted as spending." },
    {
      id: "surplus",
      label: current.surplusCents >= 0 ? "Left over so far this month" : "Spent beyond income so far this month",
      basis: "calculation",
      kind: "money",
      value: Math.abs(current.surplusCents),
    },
    r.avgSurplusCents === null
      ? { id: "avg-surplus", label: "Usual monthly surplus", basis: "calculation", kind: "money", value: null, missing: NO_FULL_MONTH }
      : { id: "avg-surplus", label: "Usual monthly surplus", basis: "calculation", kind: "money", value: r.avgSurplusCents, note: `Income minus spending, averaged over the last ${r.count} complete ${r.count === 1 ? "month" : "months"}.` },
    trend
      ? {
          id: "trend",
          label: "Change in monthly surplus",
          basis: "calculation",
          kind: "money",
          signed: true,
          value: trend.changeCents,
          note: `The last 3 complete months averaged ${money(trend.recentCents)} a month, against ${money(trend.earlierCents)} for the 3 before.`,
        }
      : { id: "trend", label: "Change in monthly surplus", basis: "calculation", kind: "money", value: null, missing: "Needs six complete months of transactions to compare." },
    {
      id: "recurring",
      label: "Recurring expenses, per month",
      basis: "calculation",
      kind: "money",
      value: recurringMonthly,
      note: "Bills and subscriptions found in your transactions, at their usual amounts.",
    },
    large[0]
      ? { id: "large", label: "Largest known payment, next 30 days", basis: "projection", kind: "money", value: large[0].cents, text: large[0].name, note: "From recurring patterns and payments you planned; not everything that will happen." }
      : { id: "large", label: "Largest known payment, next 30 days", basis: "projection", kind: "money", value: null, missing: "No recurring or planned payments are expected in the next 30 days." },
  ];

  const summary =
    current.incomeCents === 0 && current.spendingCents === 0
      ? "Nothing has come in or gone out yet this month."
      : current.surplusCents >= 0
        ? `${money(current.surplusCents)} more has come in than gone out so far this month.`
        : `${money(-current.surplusCents)} more has gone out than come in so far this month.`;

  return { key: "cash-flow", label: "Cash flow", view: "cash-flow", summary, metrics, hasData: input.transactions.length > 0, detail: { kind: "cash-flow", months: r.flows, recurringMonthlyCents: recurringMonthly, large } };
}

// ---- savings ---------------------------------------------------------------------------------------------------------

/** Goals that are about setting money aside for something, as opposed to paying a debt down or investing. */
const SAVINGS_GOAL_KINDS = new Set<Goal["kind"]>(["emergency_fund", "new_car", "house", "vacation", "large_purchase", "custom"]);

function goalRows(input: HealthInput, keep: (g: Goal) => boolean = () => true): GoalRow[] {
  return input.goals.filter(keep).map((goal) => ({ goal, progress: goalProgress(goal, input.contributions, input.today) }));
}

function savings(input: HealthInput): Dimension {
  const r = recentMonths(input);
  const cashAccounts = input.accounts.filter((a) => ACCOUNT_KINDS[a.kind].group === "cash").map((a) => ({ id: a.id, name: a.name, balanceCents: a.balanceCents }));
  const cashCents = cashAccounts.reduce((s, a) => s + a.balanceCents, 0);
  const monthsCovered = r.avgSpendingCents !== null && r.avgSpendingCents > 0 ? cashCents / r.avgSpendingCents : null;
  const targetMonths = input.emergencyMonths;
  const targetCents = targetMonths !== null && r.avgSpendingCents !== null ? Math.round(targetMonths * r.avgSpendingCents) : null;

  const checking = spendingAccounts(input.accounts).reduce((s, a) => s + a.balanceCents, 0);
  const goals = goalRows(input, (g) => SAVINGS_GOAL_KINDS.has(g.kind));
  const goalTarget = goals.reduce((s, g) => s + g.goal.targetCents, 0);
  const goalCurrent = goals.reduce((s, g) => s + g.progress.currentCents, 0);

  const metrics: Metric[] = [
    r.rate === null
      ? { id: "rate", label: "Savings rate", basis: "calculation", kind: "percent", value: null, missing: r.count === 0 ? NO_FULL_MONTH : "No income was recorded in the last complete months." }
      : { id: "rate", label: "Savings rate", basis: "calculation", kind: "percent", value: r.rate, note: `The share of income not spent, over the last ${r.count} complete ${r.count === 1 ? "month" : "months"}. Money moved to savings or investments counts as not spent.` },
    { id: "cash", label: "Cash on hand", basis: "fact", kind: "money", value: cashCents, note: "Checking, savings and cash accounts together." },
    monthsCovered === null
      ? { id: "months", label: "Months of spending covered", basis: "calculation", kind: "months", value: null, missing: "Needs at least one complete month of spending." }
      : { id: "months", label: "Months of spending covered", basis: "calculation", kind: "months", value: monthsCovered, note: `Cash on hand divided by average monthly spending of ${money(r.avgSpendingCents ?? 0)}.` },
    targetMonths === null
      ? { id: "emergency", label: "Emergency fund progress", basis: "calculation", kind: "percent", value: null, missing: "Set how many months of spending you'd like to have on hand to see this." }
      : monthsCovered === null
        ? { id: "emergency", label: "Emergency fund progress", basis: "calculation", kind: "percent", value: null, missing: NO_FULL_MONTH }
        : { id: "emergency", label: "Emergency fund progress", basis: "calculation", kind: "percent", value: Math.min(1, monthsCovered / targetMonths), text: `of the ${targetMonths} ${targetMonths === 1 ? "month" : "months"} you set`, note: targetCents === null ? undefined : `That's about ${money(targetCents)} at your usual spending.` },
    input.reserveCents === null
      ? { id: "reserve", label: "Checking against your reserve", basis: "fact", kind: "money", value: null, missing: "You haven't set a checking reserve. You can under Preferences." }
      : { id: "reserve", label: checking >= input.reserveCents ? "Checking above your reserve" : "Checking below your reserve", basis: "fact", kind: "money", value: Math.abs(checking - input.reserveCents), note: `Your reserve is ${money(input.reserveCents)}; checking and cash hold ${money(checking)}.` },
    goals.length === 0
      ? { id: "goals", label: "Savings goals", basis: "calculation", kind: "percent", value: null, missing: "No savings goals yet. Goals you add appear here." }
      : { id: "goals", label: "Savings goals", basis: "calculation", kind: "percent", value: goalTarget > 0 ? Math.min(1, goalCurrent / goalTarget) : null, text: `across ${goals.length} ${goals.length === 1 ? "goal" : "goals"}`, note: `${money(goalCurrent)} set aside of ${money(goalTarget)}.` },
  ];

  const summary =
    monthsCovered === null
      ? `Cash on hand is ${money(cashCents)}. There isn't a full month of spending yet to compare it with.`
      : `Cash on hand of ${money(cashCents)} covers about ${monthsCovered.toFixed(1)} months of usual spending.`;

  return { key: "savings", label: "Savings", view: "goals", summary, metrics, hasData: cashAccounts.length > 0, detail: { kind: "savings", cashAccounts, cashCents, monthsCovered, targetMonths, targetCents, goals } };
}

// ---- debt ------------------------------------------------------------------------------------------------------------

function debt(input: HealthInput): Dimension {
  const r = recentMonths(input);
  const owed = input.accounts.filter((a) => ACCOUNT_KINDS[a.kind].class === "liability" && a.balanceCents > 0);
  const totalCents = owed.reduce((s, a) => s + a.balanceCents, 0);

  const rows: DebtRow[] = owed
    .map((a) => {
      const t = input.terms.get(a.id);
      const payment = t?.paymentCents ?? t?.minPaymentCents ?? null;
      const p = payoffProgress(a, input.balanceHistory);
      return {
        id: a.id,
        name: a.name,
        kind: a.kind,
        balanceCents: a.balanceCents,
        aprBps: t?.aprBps ?? null,
        paymentCents: payment !== null && payment > 0 ? payment : null,
        monthlyInterestCents: t?.aprBps != null ? Math.round((a.balanceCents * t.aprBps) / 10_000 / 12) : null,
        paidFraction: p ? p.fraction : null,
        since: p ? p.since : null,
      };
    })
    .sort((a, b) => b.balanceCents - a.balanceCents);

  const withPayment = rows.filter((d) => d.paymentCents !== null);
  const paymentsCents = withPayment.reduce((s, d) => s + (d.paymentCents ?? 0), 0);
  const withRate = rows.filter((d) => d.monthlyInterestCents !== null);
  const interestCents = withRate.reduce((s, d) => s + (d.monthlyInterestCents ?? 0), 0);

  const progressed = owed.map((a) => payoffProgress(a, input.balanceHistory)).filter((p): p is NonNullable<typeof p> => p !== null);
  const peak = progressed.reduce((s, p) => s + p.startCents, 0);
  const paidDown = progressed.reduce((s, p) => s + p.paidDownCents, 0);
  const since = progressed.map((p) => p.since).sort()[0] ?? null;

  const modelled = modellableDebts(input.accounts, input.terms);
  const payoff = modelled.length ? simulatePayoff(modelled, input.today) : null;
  const modelledAll = modelled.length === owed.length && owed.length > 0;

  const partial = (n: number) => (n < rows.length ? ` Based on the ${n} of ${rows.length} ${rows.length === 1 ? "debt" : "debts"} where you've entered it.` : "");

  const metrics: Metric[] = [
    { id: "total", label: "Total debt", basis: "fact", kind: "money", value: totalCents, note: rows.length ? `Across ${rows.length} ${rows.length === 1 ? "account" : "accounts"}.` : undefined },
    withPayment.length === 0
      ? { id: "payments", label: "Monthly debt payments", basis: "fact", kind: "money", value: null, missing: rows.length ? "Enter what you pay on each debt under Debt to see this." : "No debts." }
      : { id: "payments", label: "Monthly debt payments", basis: "fact", kind: "money", value: paymentsCents, note: "What you entered as paid each month (or the minimum)." + partial(withPayment.length) },
    withRate.length === 0
      ? { id: "interest", label: "Interest cost, per month", basis: "calculation", kind: "money", value: null, missing: rows.length ? "Enter each debt's rate under Debt to see this." : "No debts." }
      : { id: "interest", label: "Interest cost, per month", basis: "calculation", kind: "money", value: interestCents, note: `About ${money(interestCents * 12)} a year at today's balances and the rates you entered.` + partial(withRate.length) },
    withPayment.length === 0 || r.avgIncomeCents === null || r.avgIncomeCents <= 0
      ? { id: "dti", label: "Debt payments against income", basis: "calculation", kind: "percent", value: null, missing: withPayment.length === 0 ? "Needs the payments you enter under Debt." : "Needs a complete month with income." }
      : { id: "dti", label: "Debt payments against income", basis: "calculation", kind: "percent", value: paymentsCents / r.avgIncomeCents, note: `Monthly payments of ${money(paymentsCents)} against average monthly income of ${money(r.avgIncomeCents)}.` + partial(withPayment.length) },
    peak > 0
      ? { id: "progress", label: "Paid down so far", basis: "calculation", kind: "percent", value: paidDown / peak, note: `Of the largest balances on record${since ? ` since ${friendlyDate(since)}` : ""}. This is how far back the history goes, not necessarily the original loans.` }
      : { id: "progress", label: "Paid down so far", basis: "calculation", kind: "percent", value: null, missing: rows.length ? "There's no balance history to measure against yet." : "No debts." },
    payoff && payoff.payoffDate
      ? { id: "free", label: modelledAll ? "Debt-free date" : "Date the modelled debts are cleared", basis: "projection", kind: "text", value: null, text: friendlyDate(payoff.payoffDate), note: "At the payments entered, with nothing new charged." + (modelledAll ? "" : ` Covers ${modelled.length} of ${owed.length} debts; the rest need a rate and payment under Debt.`) }
      : { id: "free", label: "Debt-free date", basis: "projection", kind: "text", value: null, missing: rows.length ? "Needs a rate and a payment for each debt, entered under Debt." : "No debts." },
  ];

  const summary = rows.length === 0 ? "No debts are recorded." : `${money(totalCents)} is owed across ${rows.length} ${rows.length === 1 ? "account" : "accounts"}.`;

  return {
    key: "debt",
    label: "Debt",
    view: "debt",
    summary,
    metrics,
    hasData: rows.length > 0,
    detail: { kind: "debt", debts: rows, debtFreeDate: payoff?.payoffDate ?? null, modelledAll, interestToPayOffCents: payoff && payoff.months !== null ? payoff.totalInterestCents : null },
  };
}

// ---- investing -------------------------------------------------------------------------------------------------------

function investing(input: HealthInput): Dimension {
  const inv = investmentAccounts(input.accounts);
  const summary0 = portfolioSummary(input.accounts, input.positions);
  const contrib = contributionSummary(input.accounts, input.activity, input.today);
  const perf = performance(input.accounts, input.balanceHistory, input.activity, input.today, RANGES[3]);
  const slices = allocation(input.accounts, input.positions).map((s) => ({ ...s, label: s.key === "unclassified" ? "Not broken down" : ASSET_CLASSES[s.key] }));
  const value = summary0.valueCents;
  const target = input.longTerm.targetCents;
  const monthly = input.longTerm.monthlyCents ?? Math.max(0, contrib.monthlyCents);
  const toTarget = target !== null && value < target ? monthsToTarget(value, monthly, input.longTerm.returnBps, target) : null;

  const metrics: Metric[] = [
    inv.length === 0
      ? { id: "value", label: "Portfolio value", basis: "fact", kind: "money", value: null, missing: "No investment accounts are recorded." }
      : { id: "value", label: "Portfolio value", basis: "fact", kind: "money", value, note: `Across ${inv.length} ${inv.length === 1 ? "account" : "accounts"}.` },
    input.activity.some((a) => inv.some((i) => i.id === a.accountId))
      ? { id: "contrib", label: "Put in, last 12 months", basis: "calculation", kind: "money", value: contrib.last12Cents, note: `About ${money(contrib.monthlyCents)} a month, after withdrawals.` }
      : { id: "contrib", label: "Put in, last 12 months", basis: "calculation", kind: "money", value: null, missing: "No deposits are on record for these accounts." },
    perf && perf.returnPct !== null
      ? {
          id: "growth",
          label: perf.clipped ? `Growth since ${friendlyDate(perf.from)}` : "Growth, last 12 months",
          basis: "calculation",
          kind: "money",
          value: perf.growthCents,
          text: `${(perf.returnPct * 100).toFixed(1)}% over the period`,
          note: "After money put in; dividends count as growth. An estimate, not an annual rate.",
        }
      : { id: "growth", label: "Growth, last 12 months", basis: "calculation", kind: "money", value: null, missing: "Needs balance history for these accounts." },
    slices[0]
      ? { id: "allocation", label: "Largest share", basis: "calculation", kind: "text", value: slices[0].fraction, text: `${slices[0].label}, ${Math.round(slices[0].fraction * 100)}%`, note: "By the holdings the accounts list. It only describes the split." }
      : { id: "allocation", label: "Largest share", basis: "calculation", kind: "text", value: null, missing: "No holdings are listed for these accounts." },
    target === null
      ? { id: "long-term", label: "Progress to your long-term target", basis: "projection", kind: "percent", value: null, missing: "Set a target in the Long-term plan on the Investments screen to see this." }
      : {
          id: "long-term",
          label: "Progress to your long-term target",
          basis: "projection",
          kind: "percent",
          value: Math.min(1, value / target),
          text: `of ${money(target)}`,
          note:
            value >= target
              ? "The target has been reached."
              : toTarget === null
                ? "At the growth and monthly amount you assumed, the target isn't reached within 60 years."
                : `At ${(input.longTerm.returnBps / 100).toFixed(1)}% growth and ${money(monthly)} a month, which are your assumptions, about ${Math.floor(toTarget / 12)} years and ${toTarget % 12} months to go. Not a prediction.`,
        },
  ];

  const summary = inv.length === 0 ? "No investment accounts are recorded." : `${money(value)} is invested across ${inv.length} ${inv.length === 1 ? "account" : "accounts"}.`;

  return {
    key: "investing",
    label: "Investing",
    view: "investments",
    summary,
    metrics,
    hasData: inv.length > 0,
    detail: { kind: "investing", valueCents: value, allocation: slices, accounts: inv.map((a) => ({ id: a.id, name: a.name, balanceCents: a.balanceCents })), targetCents: target },
  };
}

// ---- spending --------------------------------------------------------------------------------------------------------

function spending(input: HealthInput): Dimension {
  const month = monthKey(input.today);
  const report = spendingReport(input.transactions, input.categories, month, input.today);
  const r = recentMonths(input);
  const trend = trendOf(r.complete, (f) => f.spendingCents);
  const split = spendingSplit(input.transactions, input.categories, input.recurring, input.today, 3);
  const top = report.lines[0];
  const topName = top ? (input.categories.get(top.categoryId)?.name ?? "Other") : null;

  const metrics: Metric[] = [
    { id: "spent", label: `Spent, ${monthLabel(month)} so far`, basis: "calculation", kind: "money", value: report.totalCents, note: "Transfers, card payments and investing aren't counted as spending." },
    report.previousMonth
      ? {
          id: "vs-month",
          label: "Against the same stretch of last month",
          basis: "calculation",
          kind: "money",
          signed: true,
          value: report.previousMonth.change.cents,
          text: report.previousMonth.change.fraction === null ? undefined : `${report.previousMonth.change.fraction >= 0 ? "+" : "−"}${Math.abs(Math.round(report.previousMonth.change.fraction * 1000) / 10)}%`,
          note: `${money(report.previousMonth.totalCents)} over the same days of ${monthLabel(report.previousMonth.month)}.`,
        }
      : { id: "vs-month", label: "Against the same stretch of last month", basis: "calculation", kind: "money", value: null, missing: "Needs transactions from before last month." },
    report.previousYear
      ? {
          id: "vs-year",
          label: "Against the same stretch a year ago",
          basis: "calculation",
          kind: "money",
          signed: true,
          value: report.previousYear.change.cents,
          text: report.previousYear.change.fraction === null ? undefined : `${report.previousYear.change.fraction >= 0 ? "+" : "−"}${Math.abs(Math.round(report.previousYear.change.fraction * 1000) / 10)}%`,
          note: `${money(report.previousYear.totalCents)} over the same days of ${monthYearLabel(report.previousYear.month)}.`,
        }
      : { id: "vs-year", label: "Against the same stretch a year ago", basis: "calculation", kind: "money", value: null, missing: yearUnavailableReason(report) },
    top ? { id: "top", label: "Largest category so far", basis: "calculation", kind: "money", value: top.cents, text: `${topName}, ${Math.round(top.share * 100)}% of spending` } : { id: "top", label: "Largest category so far", basis: "calculation", kind: "money", value: null, missing: "Nothing has been spent yet this month." },
    trend
      ? { id: "trend", label: "Change in monthly spending", basis: "calculation", kind: "money", signed: true, value: trend.changeCents, note: `The last 3 complete months averaged ${money(trend.recentCents)} a month, against ${money(trend.earlierCents)} for the 3 before.` }
      : { id: "trend", label: "Change in monthly spending", basis: "calculation", kind: "money", value: null, missing: "Needs six complete months of transactions to compare." },
    split.recurringCents + split.otherCents > 0
      ? { id: "recurring", label: "Recurring share of spending", basis: "calculation", kind: "percent", value: split.recurringCents / (split.recurringCents + split.otherCents), note: `About ${money(split.recurringCents)} of a usual month's ${money(split.recurringCents + split.otherCents)} repeats every month or year.` }
      : { id: "recurring", label: "Recurring share of spending", basis: "calculation", kind: "percent", value: null, missing: NO_FULL_MONTH },
  ];

  const summary = report.totalCents === 0 ? "Nothing has been spent yet this month." : `${money(report.totalCents)} has been spent so far this month${topName ? `, most of it on ${topName.toLowerCase()}` : ""}.`;

  return {
    key: "spending",
    label: "Spending",
    view: "spending",
    summary,
    metrics,
    hasData: input.transactions.length > 0,
    detail: { kind: "spending", month, lines: report.lines, trend: spendingTrend(input.transactions, input.categories, null, month, input.today, 12), totalCents: report.totalCents },
  };
}

// ---- goals -----------------------------------------------------------------------------------------------------------

function goals(input: HealthInput): Dimension {
  const rows = goalRows(input);
  const open = rows.filter((g) => !g.progress.reached);
  const target = rows.reduce((s, g) => s + g.goal.targetCents, 0);
  const current = rows.reduce((s, g) => s + g.progress.currentCents, 0);
  const required = open.reduce((s, g) => s + (g.progress.requiredMonthlyCents ?? 0), 0);
  const withDeadline = open.filter((g) => g.progress.finishesByDeadline !== null);
  const finishing = withDeadline.filter((g) => g.progress.finishesByDeadline === true).length;
  const pace = rows.reduce((s, g) => s + g.progress.recentMonthlyCents, 0);
  const reached = rows.filter((g) => g.progress.reached).length;

  const none = "No goals yet. Goals you add appear here.";
  const metrics: Metric[] = [
    rows.length === 0
      ? { id: "progress", label: "Progress across goals", basis: "calculation", kind: "percent", value: null, missing: none }
      : { id: "progress", label: "Progress across goals", basis: "calculation", kind: "percent", value: target > 0 ? Math.min(1, current / target) : null, text: `${reached} of ${rows.length} reached`, note: `${money(current)} set aside of ${money(target)} in total.` },
    rows.length === 0
      ? { id: "required", label: "Needed each month to meet deadlines", basis: "calculation", kind: "money", value: null, missing: none }
      : { id: "required", label: "Needed each month to meet deadlines", basis: "calculation", kind: "money", value: required, note: "For goals with a deadline that aren't reached yet." },
    rows.length === 0
      ? { id: "pace", label: "Added each month lately", basis: "calculation", kind: "money", value: null, missing: none }
      : { id: "pace", label: "Added each month lately", basis: "calculation", kind: "money", value: pace, note: "Average recorded across all goals over the last 90 days." },
    withDeadline.length === 0
      ? { id: "trajectory", label: "Finishing by their deadlines", basis: "projection", kind: "count", value: null, missing: rows.length === 0 ? none : "No open goal has both a deadline and a monthly amount to project from." }
      : { id: "trajectory", label: "Finishing by their deadlines", basis: "projection", kind: "count", value: finishing, text: `of ${withDeadline.length} at the current rate`, note: "Each goal's own recent or planned monthly amount, carried forward. A projection, not a promise." },
  ];

  const summary = rows.length === 0 ? "No goals are set." : `${reached} of ${rows.length} ${rows.length === 1 ? "goal is" : "goals are"} reached; ${money(current)} is set aside of ${money(target)}.`;

  return { key: "goals", label: "Goals", view: "goals", summary, metrics, hasData: rows.length > 0, detail: { kind: "goals", goals: rows } };
}

// ---------------------------------------------------------------------------------------------------------------------

export const DIMENSION_ORDER: DimensionKey[] = ["cash-flow", "savings", "debt", "investing", "spending", "goals"];

/** All six areas, in a fixed order. Never a score. */
export function buildHealth(input: HealthInput): Dimension[] {
  return [cashFlow(input), savings(input), debt(input), investing(input), spending(input), goals(input)];
}

/** A metric as it reads on screen. A figure that can't be worked out reads "Not available yet"; the reason is shown beside it. */
export function formatMetric(m: Metric): string {
  if (m.kind === "text") return m.text ?? "Not available yet";
  if (m.value === null) return "Not available yet";
  let figure: string;
  switch (m.kind) {
    case "money":
      figure = formatMoney(m.value, { signed: m.signed === true });
      break;
    case "percent":
      figure = `${Math.round(m.value * 100)}%`;
      break;
    case "months":
      figure = `${m.value.toFixed(1)} ${m.value.toFixed(1) === "1.0" ? "month" : "months"}`;
      break;
    default:
      figure = String(m.value);
  }
  if (!m.text) return figure;
  return m.kind === "money" ? `${figure} · ${m.text}` : `${figure} ${m.text}`;
}
