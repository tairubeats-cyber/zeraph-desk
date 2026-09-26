/**
 * The detection engine. Each detector is a pure function over the same data
 * the screens show and returns findings. It reads; it never writes, sends or
 * changes anything. A finding is a CALCULATION or a PROJECTION (see `Basis`),
 * never something invented: every fact in it is a number from the user's data,
 * and it says what it's built on.
 *
 * Findings feed the Action Center, the Activity feed, notifications and (later)
 * the AI's context, so they carry everything each of those needs.
 *
 * Ids are stable for the thing they describe and the period it belongs to
 * ("budget-over:dining:2026-09"), so dismissing one stays dismissed for that
 * month without hiding next month's.
 *
 * Not here yet, on purpose: changes in debt balances.
 */
import type { ViewKey } from "../../nav";
import type {
  BalancePoint,
  Basis,
  Category,
  FinancialAccount,
  Goal,
  GoalContribution,
  InvestmentActivity,
  Position,
  RecurringPayment,
  ResolvedTransaction,
} from "./types";
import { holdingRows, performance } from "./investments";
import { RANGES } from "./networth";
import { median, UNUSUAL_FACTOR, UNUSUAL_MIN_CENTS, UNUSUAL_MIN_HISTORY } from "./spending";
import type { TxFilters } from "./filters";
import { DETECTORS, type DetectorId, type FinancePreferences, type NotificationCategory } from "./prefs";
import { averageMonthlySpend, budgetRows } from "./budget";
import { completeMonths, monthlyFlows, upcoming } from "./cashflow";
import { goalProgress } from "./goals";
import { billState } from "./recurring";
import {
  addDays,
  dayOfMonth,
  daysBetween,
  formatMoney,
  monthKey,
  monthLabel,
  parseISODate,
} from "./money";

export type Severity = "attention" | "notice";

/** Something the person can do about a finding. Always a choice they make, never an instruction. */
export type InsightOption =
  | { kind: "open"; label: string; view: ViewKey; filters?: Partial<TxFilters> }
  | { kind: "review"; label: string; recurringKey: string };

export interface Insight {
  id: string;
  detector: DetectorId;
  severity: Severity;
  category: NotificationCategory;
  title: string;
  /** One or two plain sentences. */
  summary: string;
  /** The numbers behind it. */
  facts: { label: string; value: string }[];
  /** Why it might matter, and what it isn't saying. */
  why: string;
  options: InsightOption[];
  basis: Extract<Basis, "calculation" | "projection">;
  /** The date the thing happened or falls due, YYYY-MM-DD. */
  on: string;
}

export interface DetectContext {
  today: string;
  transactions: ResolvedTransaction[];
  categories: Category[];
  accounts: FinancialAccount[];
  recurring: RecurringPayment[];
  budgets: Map<string, number>;
  goals: Goal[];
  contributions: GoalContribution[];
  /** Holdings, balance history and deposits, when the provider has them. Without them the investment detectors stay quiet. */
  investments?: { positions: Position[]; history: BalancePoint[]; activity: InvestmentActivity[] };
  prefs: FinancePreferences;
}

const day = (iso: string) =>
  parseISODate(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);

const catName = (c: DetectContext, id: string) => c.categories.find((x) => x.id === id)?.name ?? "Other";

type Detector = (c: DetectContext) => Insight[];

const cashPressure: Detector = (c) => {
  const checking = c.accounts.filter((a) => a.kind === "checking");
  if (checking.length === 0) return [];
  const start = checking.reduce((s, a) => s + a.balanceCents, 0);
  const ahead = upcoming(c.recurring, c.today, 30);

  let balance = start;
  let lowest = start;
  let lowestOn = c.today;
  for (const o of ahead.occurrences) {
    balance += o.payment.direction === "in" ? o.payment.amountCents : -o.payment.amountCents;
    if (balance < lowest) {
      lowest = balance;
      lowestOn = o.date;
    }
  }
  const reserve = c.prefs.reserveCents ?? 0;
  if (lowest >= reserve) return [];

  return [
    {
      id: `cash-pressure:${monthKey(lowestOn)}`,
      detector: "cash-pressure",
      severity: "attention",
      category: "money",
      title: reserve > 0 ? "Checking may dip below your reserve" : "Checking may run low",
      summary: `Known payments and income would take your checking balance to about ${formatMoney(lowest)} around ${day(lowestOn)}.`,
      facts: [
        { label: "Checking today", value: formatMoney(start) },
        { label: "Lowest expected", value: `${formatMoney(lowest)} on ${day(lowestOn)}` },
        { label: reserve > 0 ? "Your reserve" : "Reference", value: reserve > 0 ? formatMoney(reserve) : "$0" },
        { label: "Window", value: "next 30 days" },
      ],
      why: "This counts only payments and income that repeat. Everyday spending isn't included, and dates and amounts can differ, so treat it as a rough picture of what's already spoken for.",
      options: [
        { kind: "open", label: "See upcoming bills", view: "bills" },
        { kind: "open", label: "See cash flow", view: "cash-flow" },
      ],
      basis: "projection",
      on: lowestOn,
    },
  ];
};

const billDueSoon: Detector = (c) =>
  c.recurring
    .filter((r) => r.isBill && r.direction === "out" && r.kind === "expense" && r.status === "active" && !r.possiblyStopped)
    .flatMap((r) => {
      const days = daysBetween(c.today, r.nextDate);
      if (days < 0 || days > c.prefs.billLeadDays || r.autopay === "on") return [];
      const cash = c.accounts.filter((a) => a.kind === "checking").reduce((s, a) => s + a.balanceCents, 0);
      return [
        {
          id: `bill-due:${r.key}:${r.nextDate}`,
          detector: "bill-due-soon" as const,
          severity: "notice" as const,
          category: "bills" as const,
          title: `${r.merchant} is due ${inDays(days)}`,
          summary: `${r.variable ? "About " : ""}${formatMoney(r.amountCents)} is expected ${day(r.nextDate)}${
            r.autopay === "off" ? ", and autopay is off." : "; autopay isn't set."
          }`,
          facts: [
            { label: "Amount", value: `${r.variable ? "about " : ""}${formatMoney(r.amountCents, { cents: !r.variable })}` },
            { label: "Due", value: day(r.nextDate) },
            { label: "Autopay", value: r.autopay === "off" ? "Off" : "Not set" },
            { label: "Checking today", value: formatMoney(cash) },
          ],
          why: "ZeraphDesk mentions bills that aren't on autopay a few days ahead (you can change how far ahead in Preferences). The date comes from this bill's usual pattern.",
          options: [
            { kind: "open" as const, label: "Open bills", view: "bills" as const },
            { kind: "open" as const, label: "See its payments", view: "transactions" as const, filters: { query: r.merchant, period: "all" as const } },
          ],
          basis: "projection" as const,
          on: r.nextDate,
        },
      ];
    });

const billNotSeen: Detector = (c) =>
  c.recurring
    .filter((r) => r.isBill && r.direction === "out" && r.kind === "expense" && r.status === "active")
    .flatMap((r) => {
      const s = billState(r, c.today);
      if (s.kind !== "not_seen") return [];
      return [
        {
          id: `bill-unseen:${r.key}:${s.date}`,
          detector: "bill-not-seen" as const,
          severity: "attention" as const,
          category: "bills" as const,
          title: `No payment yet for ${r.merchant}`,
          summary: `It was expected around ${day(s.date)}, ${s.daysLate} ${s.daysLate === 1 ? "day" : "days"} ago, and no matching payment has appeared.`,
          facts: [
            { label: "Expected", value: day(s.date) },
            { label: "Usual amount", value: formatMoney(r.amountCents) },
            { label: "Last payment", value: r.lastDate ? day(r.lastDate) : "none recorded" },
          ],
          why: "It may simply be late to post, or paid another way. ZeraphDesk only sees transactions that match the pattern.",
          options: [
            { kind: "open" as const, label: "Open bills", view: "bills" as const },
            { kind: "open" as const, label: "See its payments", view: "transactions" as const, filters: { query: r.merchant, period: "all" as const } },
          ],
          basis: "calculation" as const,
          on: s.date,
        },
      ];
    });

const priceIncrease: Detector = (c) => {
  const byId = new Map(c.transactions.map((t) => [t.id, t]));
  return c.recurring
    .filter((r) => r.source === "detected" && r.direction === "out" && r.kind === "expense" && r.txIds.length >= 3)
    .flatMap((r) => {
      const last = byId.get(r.txIds[0]);
      if (!last || daysBetween(last.date, c.today) > 60) return [];
      // The payments before the latest must have been steady, so a genuinely variable bill (utilities) never counts as a rise.
      const earlier = r.txIds.slice(1, 4).map((id) => byId.get(id)).filter((t): t is ResolvedTransaction => t !== undefined);
      if (earlier.length < 2) return [];
      const amounts = earlier.map((t) => Math.abs(t.amountCents));
      const was = Math.min(...amounts);
      if (Math.max(...amounts) > was * 1.01) return [];
      const before = earlier[0];
      const now = Math.abs(last.amountCents);
      if (now - was < 100 || now < was * 1.02) return [];
      const yearly = (now - was) * (r.annualCents / Math.max(r.typicalCents, 1));
      return [
        {
          id: `price-up:${r.key}:${last.date}`,
          detector: "price-increase" as const,
          severity: "notice" as const,
          category: "money" as const,
          title: `${r.merchant} went up ${formatMoney(now - was, { cents: true })}`,
          summary: `The latest payment on ${day(last.date)} was ${formatMoney(now, { cents: true })}, up from ${formatMoney(was, { cents: true })} (${day(before.date)}).`,
          facts: [
            { label: "Now", value: formatMoney(now, { cents: true }) },
            { label: "Before", value: formatMoney(was, { cents: true }) },
            { label: "Extra over a year", value: formatMoney(Math.round(yearly)) },
          ],
          why: "A steady payment changed. It might be a price change, a plan change or an extra charge; the statement line doesn't say which.",
          options: [
            { kind: "review" as const, label: "Mark as reviewing", recurringKey: r.key },
            { kind: "open" as const, label: "Open recurring", view: "recurring" as const },
          ],
          basis: "calculation" as const,
          on: last.date,
        },
      ];
    });
};

const newRecurring: Detector = (c) => {
  const byId = new Map(c.transactions.map((t) => [t.id, t]));
  const historyStart = c.transactions.reduce((min, t) => (t.date < min ? t.date : min), c.today);
  return c.recurring
    .filter((r) => r.source === "detected" && r.direction === "out" && r.kind === "expense")
    .flatMap((r) => {
      const first = byId.get(r.txIds[r.txIds.length - 1]);
      if (!first) return [];
      // "New" means it began well inside the history, not that the history began with it.
      if (first.date < addDays(c.today, -90) || first.date < addDays(historyStart, 45)) return [];
      return [
        {
          id: `new-recurring:${r.key}`,
          detector: "new-recurring" as const,
          severity: "notice" as const,
          category: "money" as const,
          title: `${r.merchant} has started repeating`,
          summary: `${r.occurrences} payments since ${day(first.date)}, about ${formatMoney(r.typicalCents, { cents: true })} ${r.frequency === "monthly" ? "a month" : "each time"}.`,
          facts: [
            { label: "Typical amount", value: formatMoney(r.typicalCents, { cents: true }) },
            { label: "Yearly cost", value: formatMoney(r.annualCents) },
            { label: "First seen", value: day(first.date) },
          ],
          why: "It's now in your recurring list and counts toward what's already spoken for each month.",
          options: [
            { kind: "review" as const, label: "Mark as reviewing", recurringKey: r.key },
            { kind: "open" as const, label: "Open recurring", view: "recurring" as const },
          ],
          basis: "calculation" as const,
          on: first.date,
        },
      ];
    });
};

const recurringStopped: Detector = (c) =>
  c.recurring
    .filter((r) => r.source === "detected" && r.direction === "out" && r.kind === "expense" && r.status === "active" && r.possiblyStopped)
    .map((r) => ({
      id: `stopped:${r.key}`,
      detector: "recurring-stopped" as const,
      severity: "notice" as const,
      category: "money" as const,
      title: `${r.merchant} hasn't been charged in a while`,
      summary: `The last payment was ${r.lastDate ? day(r.lastDate) : "a while ago"}. ZeraphDesk has stopped counting it toward what's coming up.`,
      facts: [
        { label: "Last payment", value: r.lastDate ? day(r.lastDate) : "unknown" },
        { label: "Usual amount", value: formatMoney(r.amountCents) },
      ],
      why: "It may have ended, or the pattern changed. Marking it cancelled in Recurring keeps the list tidy.",
      options: [{ kind: "open" as const, label: "Open recurring", view: "recurring" as const }],
      basis: "calculation" as const,
      on: r.lastDate ?? c.today,
    }));

const budgetDetectors = (which: "over" | "projected"): Detector => (c) => {
  const month = monthKey(c.today);
  return budgetRows(c.transactions, c.categories, c.recurring, c.budgets, c.today).flatMap<Insight>((row) => {
    if (row.budgetCents === null || row.budgetCents <= 0) return [];
    const name = catName(c, row.categoryId);
    const open: InsightOption[] = [
      { kind: "open", label: "Open budgets", view: "budgets" },
      { kind: "open", label: `See ${name} transactions`, view: "transactions", filters: { categoryId: row.categoryId, period: "this_month" } },
    ];
    if (which === "over" && row.actualCents > row.budgetCents) {
      return [
        {
          id: `budget-over:${row.categoryId}:${month}`,
          detector: "budget-over" as const,
          severity: "attention" as const,
          category: "money" as const,
          title: `${name} is over budget`,
          summary: `${formatMoney(row.actualCents)} spent against a ${formatMoney(row.budgetCents)} budget, ${formatMoney(row.actualCents - row.budgetCents)} over.`,
          facts: [
            { label: "Budget", value: formatMoney(row.budgetCents) },
            { label: "Spent so far", value: formatMoney(row.actualCents) },
            { label: "Over by", value: formatMoney(row.actualCents - row.budgetCents) },
            { label: "Projected month end", value: formatMoney(row.projectedCents) },
          ],
          why: "Budgets are your own limits, so this is a comparison and not a judgement. You can raise the budget if it was set too low.",
          options: open,
          basis: "calculation" as const,
          on: c.today,
        },
      ];
    }
    if (
      which === "projected" &&
      row.actualCents <= row.budgetCents &&
      row.projectedCents > row.budgetCents &&
      dayOfMonth(c.today) >= 10
    ) {
      return [
        {
          id: `budget-proj:${row.categoryId}:${month}`,
          detector: "budget-projected" as const,
          severity: "notice" as const,
          category: "money" as const,
          title: `${name} is on pace to pass its budget`,
          summary: `At the current pace it would finish ${monthLabel(month)} near ${formatMoney(row.projectedCents)}, against a ${formatMoney(row.budgetCents)} budget.`,
          facts: [
            { label: "Budget", value: formatMoney(row.budgetCents) },
            { label: "Spent so far", value: formatMoney(row.actualCents) },
            { label: "Projected month end", value: formatMoney(row.projectedCents) },
          ],
          why: "The projection is spent so far, plus recurring payments still expected, plus your everyday pace. It's an estimate and can move.",
          options: open,
          basis: "projection" as const,
          on: c.today,
        },
      ];
    }
    return [];
  });
};

const unusualSpend: Detector = (c) => {
  const catKind = new Map(c.categories.map((x) => [x.id, x.kind]));
  const cutoff = addDays(c.today, -14);
  const fresh = c.transactions.filter((t) => t.date >= cutoff && t.amountCents < 0 && catKind.get(t.categoryId) === "expense");
  return fresh.flatMap((t) => {
    const prior = c.transactions
      .filter((p) => p.categoryId === t.categoryId && p.amountCents < 0 && p.date < cutoff)
      .map((p) => -p.amountCents);
    if (prior.length < UNUSUAL_MIN_HISTORY) return [];
    const usual = median(prior);
    const amount = -t.amountCents;
    if (amount < UNUSUAL_MIN_CENTS || amount < usual * UNUSUAL_FACTOR) return [];
    const name = catName(c, t.categoryId);
    return [
      {
        id: `unusual:${t.id}`,
        detector: "unusual-spend" as const,
        severity: "notice" as const,
        category: "money" as const,
        title: `Large ${name.toLowerCase()} purchase at ${t.merchant}`,
        summary: `${formatMoney(amount, { cents: true })} on ${day(t.date)}, about ${Math.round(amount / usual)}× the usual ${name.toLowerCase()} purchase.`,
        facts: [
          { label: "Amount", value: formatMoney(amount, { cents: true }) },
          { label: "Usual purchase", value: formatMoney(Math.round(usual), { cents: true }) },
          { label: "Category", value: name },
        ],
        why: "It's far above what's normal for this category in your history. That can be entirely expected, such as a planned purchase; this just points it out.",
        options: [{ kind: "open" as const, label: "See it in transactions", view: "transactions" as const, filters: { query: t.merchant, period: "last_90" as const } }],
        basis: "calculation" as const,
        on: t.date,
      },
    ];
  });
};

const spendPace: Detector = (c) => {
  if (dayOfMonth(c.today) < 10) return [];
  const catMap = new Map(c.categories.map((x) => [x.id, x]));
  const usual = averageMonthlySpend(c.transactions, catMap, c.today, 3);
  const month = monthKey(c.today);
  return budgetRows(c.transactions, c.categories, c.recurring, new Map(), c.today).flatMap((row) => {
    const avg = usual.get(row.categoryId) ?? 0;
    // Categories with a budget already have their own, sharper detectors.
    if (c.budgets.has(row.categoryId) || avg < 5_000) return [];
    if (row.projectedCents < avg * 1.5 || row.projectedCents - avg < 15_000) return [];
    const name = catName(c, row.categoryId);
    return [
      {
        id: `pace:${row.categoryId}:${month}`,
        detector: "spend-pace" as const,
        severity: "notice" as const,
        category: "money" as const,
        title: `${name} is running above your usual month`,
        summary: `On pace for about ${formatMoney(row.projectedCents)} this month, against a usual ${formatMoney(avg)}.`,
        facts: [
          { label: "Spent so far", value: formatMoney(row.actualCents) },
          { label: "Projected month end", value: formatMoney(row.projectedCents) },
          { label: "Usual month", value: formatMoney(avg) },
          { label: "Difference", value: formatMoney(row.projectedCents - avg, { signed: true }) },
        ],
        why: "\"Usual\" is the average of your last three full months. A single large purchase can explain it; this doesn't say whether it's a problem.",
        options: [
          { kind: "open" as const, label: `See ${name} transactions`, view: "transactions" as const, filters: { categoryId: row.categoryId, period: "this_month" as const } },
          { kind: "open" as const, label: "Set a budget", view: "budgets" as const },
        ],
        basis: "projection" as const,
        on: c.today,
      },
    ];
  });
};

const goalBehind: Detector = (c) =>
  c.goals.flatMap((g) => {
    const p = goalProgress(g, c.contributions, c.today);
    if (p.reached || p.finishesByDeadline !== false || !g.deadline || !p.projectedDate) return [];
    return [
      {
        id: `goal-pace:${g.id}:${monthKey(c.today)}`,
        detector: "goal-behind" as const,
        severity: "notice" as const,
        category: "goals" as const,
        title: `${g.name} is projected to finish after its deadline`,
        summary: `At ${formatMoney(p.assumedMonthlyCents)} a month it would finish around ${monthLabel(monthKey(p.projectedDate))} ${p.projectedDate.slice(0, 4)}, past the ${day(g.deadline)} deadline.`,
        facts: [
          { label: "Saved", value: `${formatMoney(p.currentCents)} of ${formatMoney(g.targetCents)}` },
          { label: "Needed per month", value: p.requiredMonthlyCents === null ? "n/a" : formatMoney(p.requiredMonthlyCents) },
          { label: p.assumedFrom === "plan" ? "Planned per month" : "Recent pace", value: formatMoney(p.assumedMonthlyCents) },
        ],
        why: "The projection assumes the same amount every month. Changing the plan, the deadline or the target changes it.",
        options: [{ kind: "open" as const, label: "Open goals", view: "goals" as const }],
        basis: "projection" as const,
        on: c.today,
      },
    ];
  });

const goalReached: Detector = (c) =>
  c.goals.flatMap((g) => {
    if (!goalProgress(g, c.contributions, c.today).reached) return [];
    return [
      {
        id: `goal-done:${g.id}`,
        detector: "goal-reached" as const,
        severity: "notice" as const,
        category: "goals" as const,
        title: `${g.name} reached its target`,
        summary: `You've recorded ${formatMoney(g.targetCents)} toward it.`,
        facts: [{ label: "Target", value: formatMoney(g.targetCents) }],
        why: "Progress here is what you've recorded, not read from an account.",
        options: [{ kind: "open" as const, label: "Open goals", view: "goals" as const }],
        basis: "calculation" as const,
        on: c.today,
      },
    ];
  });

const incomeChange: Detector = (c) => {
  const flows = completeMonths(monthlyFlows(c.transactions, new Map(c.categories.map((x) => [x.id, x])), c.today), c.today);
  if (flows.length < 4) return [];
  const last = flows[flows.length - 1];
  const before = flows.slice(0, -1);
  const mean = before.reduce((s, f) => s + f.incomeCents, 0) / before.length;
  const diff = last.incomeCents - mean;
  if (mean <= 0 || Math.abs(diff) < 20_000 || Math.abs(diff) / mean < 0.15) return [];
  return [
    {
      id: `income:${last.month}`,
      detector: "income-change" as const,
      severity: "notice" as const,
      category: "money" as const,
      title: `${monthLabel(last.month)} income was ${diff > 0 ? "higher" : "lower"} than usual`,
      summary: `${formatMoney(last.incomeCents)} came in, against about ${formatMoney(Math.round(mean))} in the months before.`,
      facts: [
        { label: monthLabel(last.month), value: formatMoney(last.incomeCents) },
        { label: "Earlier months' average", value: formatMoney(Math.round(mean)) },
        { label: "Difference", value: formatMoney(Math.round(diff), { signed: true }) },
      ],
      why: "Income can vary for ordinary reasons such as pay dates or a bonus. This only notes the difference.",
      options: [{ kind: "open" as const, label: "Open cash flow", view: "cash-flow" as const }],
      basis: "calculation" as const,
      on: `${last.month}-28`,
    },
  ];
};

const pct = (x: number) => `${Math.abs(Math.round(x * 1000) / 10)}%`;

const investmentsDrop: Detector = (c) => {
  if (!c.investments) return [];
  const p = performance(c.accounts, c.investments.history, c.investments.activity, c.today, RANGES[1]);
  if (!p || p.returnPct === null || p.returnPct > -0.1) return [];
  return [
    {
      id: `investments-drop:${monthKey(c.today)}`,
      detector: "investments-drop" as const,
      severity: p.returnPct <= -0.2 ? ("attention" as const) : ("notice" as const),
      category: "investments" as const,
      title: `Your investments are down ${pct(p.returnPct)} over 30 days`,
      summary: `Worth ${formatMoney(p.startCents)} on ${day(p.from)} and ${formatMoney(p.endCents)} now, counting ${formatMoney(p.netContributionsCents)} you put in.`,
      facts: [
        { label: `Value on ${day(p.from)}`, value: formatMoney(p.startCents) },
        { label: "Put in since", value: formatMoney(p.netContributionsCents) },
        { label: "Value now", value: formatMoney(p.endCents) },
        { label: "Market change", value: formatMoney(p.growthCents, { signed: true }) },
      ],
      why: "Investments move up and down, and a fall over a month says nothing certain about what comes next. This only notes the size of the move.",
      options: [{ kind: "open" as const, label: "Open investments", view: "investments" as const }],
      basis: "calculation" as const,
      on: c.today,
    },
  ];
};

const CONCENTRATION_SHARE = 0.15;

const concentrationDetector: Detector = (c) => {
  if (!c.investments) return [];
  return holdingRows(c.accounts, c.investments.positions)
    .filter((r) => r.position.type === "stock" && r.share >= CONCENTRATION_SHARE)
    .map((r) => ({
      id: `concentration:${r.position.symbol}:${monthKey(c.today)}`,
      detector: "concentration" as const,
      severity: "notice" as const,
      category: "investments" as const,
      title: `${r.position.name} is ${pct(r.share)} of your investments`,
      summary: `${formatMoney(r.valueCents)} of your ${formatMoney(r.valueCents / r.share)} in investments is in this one company.`,
      facts: [
        { label: "Holding", value: `${r.position.name} (${r.position.symbol})` },
        { label: "Value", value: formatMoney(r.valueCents) },
        { label: "Share of investments", value: pct(r.share) },
      ],
      why: "One company can move a lot more than a fund of many. This notes how much of your investments it is; it isn't saying that's too much.",
      options: [{ kind: "open" as const, label: "See allocation", view: "investments" as const }],
      basis: "calculation" as const,
      on: c.today,
    }));
};

const DETECTOR_FNS: Record<DetectorId, Detector> = {
  "investments-drop": investmentsDrop,
  concentration: concentrationDetector,
  "cash-pressure": cashPressure,
  "bill-due-soon": billDueSoon,
  "bill-not-seen": billNotSeen,
  "price-increase": priceIncrease,
  "new-recurring": newRecurring,
  "recurring-stopped": recurringStopped,
  "budget-over": budgetDetectors("over"),
  "budget-projected": budgetDetectors("projected"),
  "unusual-spend": unusualSpend,
  "spend-pace": spendPace,
  "goal-behind": goalBehind,
  "goal-reached": goalReached,
  "income-change": incomeChange,
};

/** Run every detector the user has left switched on. Most urgent first, then most recent. */
export function detectInsights(c: DetectContext): Insight[] {
  return DETECTORS.filter((d) => c.prefs.watch[d.id])
    .flatMap((d) => DETECTOR_FNS[d.id](c))
    .sort(
      (a, b) =>
        Number(b.severity === "attention") - Number(a.severity === "attention") || b.on.localeCompare(a.on) || a.id.localeCompare(b.id),
    );
}
