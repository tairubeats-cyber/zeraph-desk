import { generateSample } from "../src/lib/finance/sample";
import { accountTotals, resolveTransactions } from "../src/lib/finance/analysis";
import { DEFAULT_CATEGORIES } from "../src/lib/finance/categories";
import { average, completeMonths, monthlyFlows } from "../src/lib/finance/cashflow";
import { goalProgress } from "../src/lib/finance/goals";
import { answer, SUGGESTED_QUESTIONS, type AskContext } from "../src/lib/finance/ask";
import { buildHealth, DIMENSION_ORDER, formatMetric, type Dimension, type HealthInput, type Metric } from "../src/lib/finance/health";
import { portfolioSummary } from "../src/lib/finance/investments";
import { monthsToTarget } from "../src/lib/finance/longterm";
import { DEFAULT_LONG_TERM } from "../src/lib/finance/longterm";
import { friendlyDate, monthYearLabel } from "../src/lib/finance/money";
import { mergePrefs } from "../src/lib/finance/prefs";
import { recurringKey } from "../src/lib/finance/recurring";
import type { Category, FinancialAccount, Goal, GoalContribution, RecurringPayment, ResolvedTransaction } from "../src/lib/finance/types";

let fails = 0;
const eq = (n: string, g: unknown, w: unknown) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  if (!ok) fails++;
  console.log((ok ? "ok   " : "FAIL ") + n + (ok ? "" : `  got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
};
const yes = (n: string, c: boolean) => eq(n, c, true);
const near = (n: string, g: number, w: number, tol: number) => {
  const ok = Math.abs(g - w) <= tol;
  if (!ok) fails++;
  console.log((ok ? "ok   " : "FAIL ") + n + (ok ? "" : `  got ${g} want ${w}±${tol}`));
};

const cats: Category[] = DEFAULT_CATEGORIES.map((c, i) => ({ ...c, position: i, hidden: false }));
const catMap = new Map(cats.map((c) => [c.id, c]));
const today = "2026-09-25";

let n = 0;
const tx = (date: string, categoryId: string, dollars: number, merchant: string): ResolvedTransaction => ({
  id: "t" + ++n, accountId: "chk", date, merchant, description: merchant.toUpperCase(), amountCents: Math.round(dollars * 100),
  categoryHint: null, pending: false, categoryId, note: "", flagged: false, recategorized: false,
});
const acct = (id: string, name: string, kind: FinancialAccount["kind"], dollars: number): FinancialAccount => ({
  id, institutionId: "i", connectionId: "c", name, kind, mask: null, balanceCents: Math.round(dollars * 100),
});

// ---- a household whose figures can be checked by hand ----------------------------------------------------------
// Income 4000 a month. Spending: rent 1500 + food 500 (Mar-May), rent 1500 + food 600 (Jun-Aug), and in September
// (through the 25th) rent 1500 + food 300.
const txs: ResolvedTransaction[] = [];
const rentTx: ResolvedTransaction[] = [];
for (const [mm, food] of [["03", 500], ["04", 500], ["05", 500], ["06", 600], ["07", 600], ["08", 600], ["09", 300]] as [string, number][]) {
  txs.push(tx(`2026-${mm}-01`, "income", 4000, "Payroll"));
  const rent = tx(`2026-${mm}-03`, "housing", -1500, "Oakwood Rent");
  rentTx.push(rent);
  txs.push(rent);
  txs.push(tx(`2026-${mm}-10`, "food", -food, "Green Grocer"));
}

const accounts: FinancialAccount[] = [
  acct("chk", "Checking", "checking", 6300),
  acct("sav", "Savings", "savings", 8400),
  acct("brk", "Brokerage", "brokerage", 50000),
  acct("card", "Card", "credit_card", 1000),
  acct("auto", "Auto loan", "auto_loan", 12000),
  acct("stu", "Student loan", "student_loan", 8000),
];

const recurring: RecurringPayment[] = [
  {
    key: recurringKey(rentTx[0]), source: "manual", merchant: "Oakwood Rent", categoryId: "housing", direction: "out", kind: "expense",
    frequency: "monthly", amountCents: 150_000, typicalCents: 150_000, variable: false, annualCents: 1_800_000, lastDate: "2026-09-03",
    nextDate: "2026-10-03", occurrences: 7, possiblyStopped: false, monthDays: [], txIds: [], status: "active", necessity: "unset", autopay: "unset", isBill: true,
  },
];

const goals: Goal[] = [
  { id: "g1", name: "Emergency fund", kind: "emergency_fund", targetCents: 1_000_000, startCents: 200_000, deadline: "2027-09-25", monthlyPlanCents: 50_000, createdAt: "2026-01-01" },
  { id: "g2", name: "Trip", kind: "vacation", targetCents: 300_000, startCents: 300_000, deadline: null, monthlyPlanCents: 0, createdAt: "2026-01-01" },
];
const contributions: GoalContribution[] = ["2026-07-30", "2026-08-30", "2026-09-20"].map((date, i) => ({ id: "c" + i, goalId: "g1", date, amountCents: 50_000 }));

const input: HealthInput = {
  today, accounts, transactions: txs, categories: catMap, recurring, goals, contributions,
  terms: new Map([
    ["card", { accountId: "card", aprBps: 2000, minPaymentCents: 3000, paymentCents: 20_000, dueDay: 15 }],
    ["auto", { accountId: "auto", aprBps: 600, minPaymentCents: 40_000, paymentCents: null, dueDay: 1 }],
  ]),
  holdings: [],
  planned: [{ id: "p1", name: "Dentist", date: "2026-10-05", amountCents: 80_000, direction: "out" }],
  balanceHistory: [
    { accountId: "card", date: "2026-03-01", balanceCents: 200_000 }, { accountId: "card", date: today, balanceCents: 100_000 },
    { accountId: "auto", date: "2026-03-01", balanceCents: 1_500_000 }, { accountId: "auto", date: today, balanceCents: 1_200_000 },
    { accountId: "brk", date: "2025-09-25", balanceCents: 4_000_000 }, { accountId: "brk", date: today, balanceCents: 5_000_000 },
  ],
  positions: [],
  activity: Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(2025, 9 + i, 5));
    return { id: "a" + i, accountId: "brk", date: d.toISOString().slice(0, 10), kind: "contribution" as const, amountCents: 50_000 };
  }),
  longTerm: { ...DEFAULT_LONG_TERM, targetCents: 10_000_000, returnBps: 600, monthlyCents: 50_000 },
  reserveCents: 500_000,
  emergencyMonths: 12,
};

const dims = buildHealth(input);
const by = (key: string) => dims.find((d) => d.key === key) as Dimension;
const metric = (dim: string, id: string) => by(dim).metrics.find((m) => m.id === id) as Metric;

// ---- shape ------------------------------------------------------------------------------------------------------
eq("six areas, in the spec's order, and no score", dims.map((d) => d.key), DIMENSION_ORDER);
eq("the order", DIMENSION_ORDER, ["cash-flow", "savings", "debt", "investing", "spending", "goals"]);
yes("every area has a summary and metrics", dims.every((d) => d.summary.length > 0 && d.metrics.length >= 4));
yes("metric ids are unique within an area", dims.every((d) => new Set(d.metrics.map((m) => m.id)).size === d.metrics.length));
yes("every metric has a number, some words, or a reason it has neither", dims.every((d) => d.metrics.every((m: Metric) => m.value !== null || !!m.text || !!m.missing)));
yes("every figure is a real number", dims.every((d) => d.metrics.every((m) => m.value === null || Number.isFinite(m.value))));
yes("each metric says what kind of statement it is", dims.every((d) => d.metrics.every((m) => ["fact", "calculation", "projection"].includes(m.basis))));
yes("the screen each area links to exists in the app", dims.every((d) => ["cash-flow", "goals", "debt", "investments", "spending"].includes(d.view)));

// ---- cash flow --------------------------------------------------------------------------------------------------
eq("income so far this month", metric("cash-flow", "income").value, 400_000);
eq("spending so far (rent 1500 + food 300)", metric("cash-flow", "spending").value, 180_000);
eq("left over so far", [metric("cash-flow", "surplus").label, metric("cash-flow", "surplus").value], ["Left over so far this month", 220_000]);
eq("usual surplus: June to August each left 1900", metric("cash-flow", "avg-surplus").value, 190_000);
eq("the trend: 1900 now against 2000 before", metric("cash-flow", "trend").value, -10_000);
eq("recurring per month is a twelfth of the year", metric("cash-flow", "recurring").value, 150_000);
eq("largest known payment ahead is the rent", [metric("cash-flow", "large").value, metric("cash-flow", "large").text], [150_000, "Oakwood Rent"]);
eq("the planned dentist visit is in the list too", (by("cash-flow").detail as { large: { name: string; source: string }[] }).large.map((l) => [l.name, l.source]), [["Oakwood Rent", "recurring"], ["Dentist", "planned"]]);
eq("cash flow summary is neutral about the month", by("cash-flow").summary, "$2,200 more has come in than gone out so far this month.");

// ---- savings ----------------------------------------------------------------------------------------------------
near("savings rate: 3 x 1900 of 3 x 4000", metric("savings", "rate").value as number, 0.475, 1e-9);
eq("cash on hand", metric("savings", "cash").value, 1_470_000);
near("months covered: 14,700 over 2,100", metric("savings", "months").value as number, 7, 1e-9);
near("emergency progress against the 12 months set", metric("savings", "emergency").value as number, 7 / 12, 1e-9);
eq("...and it says which target it used", metric("savings", "emergency").text, "of the 12 months you set");
eq("checking above the reserve: 6300 - 5000", [metric("savings", "reserve").label, metric("savings", "reserve").value], ["Checking above your reserve", 130_000]);
near("savings goals: 3500 + 3000 of 10000 + 3000", metric("savings", "goals").value as number, 0.5, 1e-9);
eq("the target is capped at 100%", buildHealth({ ...input, emergencyMonths: 3 }).find((d) => d.key === "savings")!.metrics.find((m) => m.id === "emergency")!.value, 1);
eq("no target set: it says how to see the figure, and shows no number", [metric("savings", "emergency").missing, buildHealth({ ...input, emergencyMonths: null }).find((d) => d.key === "savings")!.metrics.find((m) => m.id === "emergency")!.value], [undefined, null]);
eq("no reserve set is said plainly", buildHealth({ ...input, reserveCents: null }).find((d) => d.key === "savings")!.metrics.find((m) => m.id === "reserve")!.missing, "You haven't set a checking reserve. You can under Preferences.");

// ---- debt -------------------------------------------------------------------------------------------------------
eq("total debt", metric("debt", "total").value, 2_100_000);
eq("payments entered: 200 on the card, the minimum 400 on the auto loan", metric("debt", "payments").value, 60_000);
eq("...and it says it's only 2 of 3 debts", metric("debt", "payments").note?.includes("2 of 3 debts"), true);
eq("interest per month: 1000 at 20% and 12000 at 6%", metric("debt", "interest").value, 1667 + 6000);
near("debt payments against income: 600 of 4000", metric("debt", "dti").value as number, 0.15, 1e-9);
near("paid down: (1000 + 3000) of (2000 + 15000)", metric("debt", "progress").value as number, 4000 / 17000, 1e-9);
yes("a date for the modelled debts, and it says it isn't all of them", !!metric("debt", "free").text && metric("debt", "free").label === "Date the modelled debts are cleared");
const debtRows = (by("debt").detail as { debts: { id: string; paidFraction: number | null; aprBps: number | null }[] }).debts;
eq("largest debt first", debtRows.map((d) => d.id), ["auto", "stu", "card"]);
eq("a debt with no rate or history shows neither, it isn't guessed", debtRows.find((d) => d.id === "stu"), { id: "stu", name: "Student loan", kind: "student_loan", balanceCents: 800_000, aprBps: null, paymentCents: null, monthlyInterestCents: null, paidFraction: null, since: null });
{
  const bare = buildHealth({ ...input, terms: new Map() }).find((d) => d.key === "debt")!;
  eq("no terms entered: payments, interest and ratio say what to enter", bare.metrics.filter((m) => ["payments", "interest", "dti"].includes(m.id)).map((m) => [m.value, !!m.missing]), [[null, true], [null, true], [null, true]]);
  eq("...and there's no payoff date", [bare.metrics.find((m) => m.id === "free")!.text, (bare.detail as { debtFreeDate: string | null }).debtFreeDate], [undefined, null]);
}

// ---- investing --------------------------------------------------------------------------------------------------
eq("portfolio value", metric("investing", "value").value, 5_000_000);
eq("put in over 12 months: twelve deposits of 500", metric("investing", "contrib").value, 600_000);
eq("growth: 50000 - 40000 - 6000 put in", metric("investing", "growth").value, 400_000);
eq("no holdings listed: the split is 'not broken down', not guessed", metric("investing", "allocation").text, "Not broken down, 100%");
near("progress to the 100,000 target", metric("investing", "long-term").value as number, 0.5, 1e-9);
{
  const months = monthsToTarget(5_000_000, 50_000, 600, 10_000_000) as number;
  eq("time to target uses the assumptions entered, and says so", metric("investing", "long-term").note, `At 6.0% growth and $500 a month, which are your assumptions, about ${Math.floor(months / 12)} years and ${months % 12} months to go. Not a prediction.`);
}
eq("no target: it says where to set one", buildHealth({ ...input, longTerm: { ...input.longTerm, targetCents: null } }).find((d) => d.key === "investing")!.metrics.find((m) => m.id === "long-term")!.value, null);

// ---- spending ---------------------------------------------------------------------------------------------------
eq("spent so far", metric("spending", "spent").value, 180_000);
eq("against the same stretch of last month (2100 through the 25th)", [metric("spending", "vs-month").value, metric("spending", "vs-month").text], [-30_000, "−14.3%"]);
eq("a year of history isn't there, and it says which month is missing and where the data starts", metric("spending", "vs-year").missing, "Nothing is loaded from September 2025 to compare with; the earliest transaction is from Mar 1, 2026.");
eq("largest category", metric("spending", "top").text, "Housing, 83% of spending");
eq("spending trend: 2100 now against 2000 before", metric("spending", "trend").value, 10_000);
near("recurring share: rent 1500 of a usual 2100 month", metric("spending", "recurring").value as number, 1500 / 2100, 1e-9);
eq("spending detail carries the categories and a twelve-month trend", [(by("spending").detail as { lines: unknown[] }).lines.length, (by("spending").detail as { trend: unknown[] }).trend.length], [2, 12]);

// ---- goals ------------------------------------------------------------------------------------------------------
eq("goals summary", by("goals").summary, "1 of 2 goals are reached; $6,500 is set aside of $13,000.");
near("progress across goals", metric("goals", "progress").value as number, 0.5, 1e-9);
{
  const p = goalProgress(goals[0], contributions, today);
  eq("needed each month comes from the goal's own calculation", metric("goals", "required").value, p.requiredMonthlyCents);
  eq("recent pace: three deposits of 500 over 90 days is 500 a month", metric("goals", "pace").value, 500 * 100);
  eq("finishing by the deadline uses the goal's own projection", [metric("goals", "trajectory").value, metric("goals", "trajectory").text], [p.finishesByDeadline ? 1 : 0, "of 1 at the current rate"]);
}

// ---- empty and sample ---------------------------------------------------------------------------------------------
{
  const empty = buildHealth({ ...input, accounts: [], transactions: [], recurring: [], goals: [], contributions: [], terms: new Map(), planned: [], balanceHistory: [], positions: [], activity: [], reserveCents: null, emergencyMonths: null });
  eq("nothing loaded: six areas and no crash", empty.length, 6);
  eq("nothing loaded: no area claims to have data except through transactions it doesn't have", empty.map((d) => d.hasData), [false, false, false, false, false, false]);
  yes("nothing loaded: every figure is a number or says why not", empty.every((d) => d.metrics.every((m) => (m.value === null || Number.isFinite(m.value)) && (m.value !== null || !!m.text || !!m.missing))));
  eq("nothing loaded: neutral summaries", empty.map((d) => d.summary), [
    "Nothing has come in or gone out yet this month.",
    "Cash on hand is $0. There isn't a full month of spending yet to compare it with.",
    "No debts are recorded.",
    "No investment accounts are recorded.",
    "Nothing has been spent yet this month.",
    "No goals are set.",
  ]);
}
{
  const snap = generateSample(today);
  const rs = resolveTransactions(snap.transactions, cats, new Map());
  const s = buildHealth({ ...input, accounts: snap.accounts, transactions: rs, recurring: [], goals: [], contributions: [], terms: new Map(), planned: [], balanceHistory: snap.balanceHistory, positions: snap.positions, activity: snap.investmentActivity });
  const get = (d: string, id: string) => s.find((x) => x.key === d)!.metrics.find((m) => m.id === id) as Metric;
  eq("sample: total debt matches Accounts", get("debt", "total").value, accountTotals(snap.accounts).liabilitiesCents);
  eq("sample: portfolio value matches Investments", get("investing", "value").value, portfolioSummary(snap.accounts, snap.positions).valueCents);
  const complete = completeMonths(monthlyFlows(rs, catMap, today, 7), today);
  eq("sample: usual surplus matches Cash Flow's own average", get("cash-flow", "avg-surplus").value, average(complete.slice(-3).map((f) => f.surplusCents)));
  yes("sample: it has the year of history a comparison needs, so the year figure is a number", get("spending", "vs-year").value !== null);
  yes("sample: the year-ago note names the year, not just the month", /September 2025/.test(get("spending", "vs-year").note ?? ""));
  yes("sample: no figure is NaN or infinite anywhere", s.every((d) => d.metrics.every((m) => m.value === null || Number.isFinite(m.value))));
}

// ---- wording: information, never a verdict -----------------------------------------------------------------------
{
  const all = [...dims].flatMap((d) => [d.summary, ...d.metrics.flatMap((m) => [m.label, m.note ?? "", m.text ?? "", m.missing ?? ""])]).join(" | ");
  const banned = all.match(/\b(should|must|overspent|overspending|too much|bad|poor|unhealthy|risky|score|grade|shame|wasteful|irresponsible)\b/gi);
  eq("no verdict or advice wording anywhere", banned, null);
  eq("dates read as words, never as 2026-09-25", all.match(/d{4}-d{2}-d{2}/g), null);
}

// ---- how a metric reads on screen ---------------------------------------------------------------------------------
eq("money", formatMetric(metric("cash-flow", "income")), "$4,000");
eq("a change shows its sign, with a real minus", formatMetric(metric("cash-flow", "trend")), "−$100");
eq("money with a name beside it", formatMetric(metric("cash-flow", "large")), "$1,500 · Oakwood Rent");
eq("percent with its words", formatMetric(metric("savings", "goals")), "50% across 2 goals");
eq("months", formatMetric(metric("savings", "months")), "7.0 months");
eq("percent alone", formatMetric(metric("savings", "rate")), "48%");
eq("text", formatMetric(metric("investing", "allocation")), "Not broken down, 100%");
eq("a figure that can't be worked out says so, never zero", formatMetric(buildHealth({ ...input, emergencyMonths: null }).find((d) => d.key === "savings")!.metrics.find((m) => m.id === "emergency")!), "Not available yet");
eq("a change with a percentage beside it", formatMetric(metric("spending", "vs-month")), "−$300 · −14.3%");

// ---- Ask answers from the same figures --------------------------------------------------------------------------
{
  const snap = generateSample(today);
  const ctx: AskContext = {
    today, sample: true, transactions: resolveTransactions(snap.transactions, cats, new Map()), categories: cats, accounts: snap.accounts,
    institutions: new Map(), recurring: [], budgets: new Map(), goals: [], contributions: [], holdings: [], history: snap.balanceHistory,
    debtTerms: new Map(), planned: [], positions: snap.positions, activity: snap.investmentActivity, longTerm: DEFAULT_LONG_TERM,
  };
  for (const q of ["How am I doing financially?", "how are my finances", "How do my finances look?", "Give me a financial health check"]) {
    const a = answer(q, ctx);
    eq("Ask understands: " + q, [a.answered, a.table?.rows.map((r) => r[0]), a.links[0]?.view], [true, ["Cash flow", "Savings", "Debt", "Investing", "Spending", "Goals"], "health"]);
  }
  const a = answer("How am I doing financially?", ctx);
  yes("Ask's health answer uses the same summaries as the screen", a.table!.rows.every((r, i) => r[1] === buildHealth({ ...input, accounts: snap.accounts, transactions: ctx.transactions, recurring: [], goals: [], contributions: [], terms: new Map(), planned: [], balanceHistory: snap.balanceHistory, positions: snap.positions, activity: snap.investmentActivity, longTerm: DEFAULT_LONG_TERM, reserveCents: null, emergencyMonths: null })[i].summary));
  yes("it says what isn't available yet, and why", a.notes.some((n) => /^Not available yet:/.test(n) && /only you can enter/.test(n)));
  yes("it says it isn't a grade", a.paragraphs.join(" ").includes("not a grade"));
  yes("no verdict wording in the answer", !/(should|must|bad|poor|risky|unhealthy|overspent)/i.test([a.headline, ...a.paragraphs, ...a.notes, ...a.table!.rows.flat()].join(" ")));
  eq("a question about investments still goes to the portfolio answer", answer("How are my investments doing?", ctx).table?.rows.some((r) => r[0] === "Cash flow") ?? false, false);
  eq("'how am I doing with my investments' is about investments", answer("How am I doing with my investments?", ctx).links.some((l) => l.view === "health"), false);
  yes("the health question is offered as a suggestion", SUGGESTED_QUESTIONS.includes("How am I doing financially?"));
}

// ---- date and month wording --------------------------------------------------------------------------------------
eq("a month with its year", monthYearLabel("2025-09"), "September 2025");
eq("a date in words", friendlyDate("2023-09-27"), "Sep 27, 2023");

// ---- the emergency-fund preference -------------------------------------------------------------------------------
eq("older saved preferences have no target", mergePrefs({ reserveCents: 100 }).emergencyMonths, null);
eq("a saved target survives", mergePrefs({ emergencyMonths: 6 }).emergencyMonths, 6);
eq("a half-month step is kept", mergePrefs({ emergencyMonths: 4.5 }).emergencyMonths, 4.5);
eq("nonsense is dropped, not guessed", [mergePrefs({ emergencyMonths: -3 }).emergencyMonths, mergePrefs({ emergencyMonths: 999 }).emergencyMonths, mergePrefs({ emergencyMonths: "six" }).emergencyMonths], [null, null, null]);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
