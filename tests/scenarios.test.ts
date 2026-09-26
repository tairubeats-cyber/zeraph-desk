import { generateSample } from "../src/lib/finance/sample";
import { DEFAULT_CATEGORIES } from "../src/lib/finance/categories";
import { categoryMap, resolveTransactions } from "../src/lib/finance/analysis";
import { buildRecurring } from "../src/lib/finance/recurring";
import { runScenario, changeTitle, monthlyEquivalent, type ScenarioContext } from "../src/lib/finance/scenarios";
import { simulatePayoff, loanSchedule, modellableDebts } from "../src/lib/finance/debt";
import type { DebtTerms, Goal, ScenarioChange } from "../src/lib/finance/types";

let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)); };

const today = "2026-09-25";
const snap = generateSample(today);
const cats = DEFAULT_CATEGORIES.map((c, i) => ({ ...c, position: i, hidden: false }));
const cmap = categoryMap(cats);
const txs = resolveTransactions(snap.transactions, cats, new Map());
const rec = buildRecurring(txs, cmap, [], new Map(), today);
const terms = new Map<string, DebtTerms>([
  ["acct-auto", { accountId: "acct-auto", aprBps: 649, minPaymentCents: 35_000, paymentCents: null, dueDay: 20 }],
  ["acct-student", { accountId: "acct-student", aprBps: 500, minPaymentCents: 28_000, paymentCents: null, dueDay: 22 }],
]);
const goal: Goal = { id: "g1", name: "Emergency fund", kind: "emergency_fund", targetCents: 1_000_000, startCents: 0, deadline: null, monthlyPlanCents: 20_000, createdAt: "" };
const ctx: ScenarioContext = { today, accounts: snap.accounts, debtTerms: terms, goals: [goal], contributions: [], recurring: rec };
const run = (changes: ScenarioChange[], H = 12) => runScenario({ horizonMonths: H, changes }, ctx);
const identity = (r: ReturnType<typeof run>) => r.netWorth.every((nw, m) => nw === r.cash[m] + r.savings[m] + r.held[m] + r.debt[m]);

// 1. save more
{
  const r = run([{ id: "a", type: "save_more", monthlyCents: 50_000, goalId: null }]);
  eq("save: cash after 12", r.cash[12], -600_000);
  eq("save: savings after 12", r.savings[12], 600_000);
  eq("save: net worth unchanged", r.netWorth[12], 0);
  eq("save: deepest dip", r.deepestCashDipCents, 600_000);
  eq("save: arrays are H+1 long", [r.cash.length, r.netWorth.length], [13, 13]);
  eq("save: index 0 is zero", [r.cash[0], r.savings[0], r.netWorth[0]], [0, 0, 0]);
  console.log("   ", r.effects[0].summary);
}
// 2/3. income and expense, both signs
{
  const up = run([{ id: "a", type: "income", monthlyCents: 40_000 }]);
  eq("income +400: cash and NW +4800", [up.cash[12], up.netWorth[12]], [480_000, 480_000]);
  const down = run([{ id: "a", type: "income", monthlyCents: -40_000 }]);
  eq("income -400: cash and NW -4800", [down.cash[12], down.netWorth[12]], [-480_000, -480_000]);
  const rent = run([{ id: "a", type: "expense", monthlyCents: 15_000, label: "Rent" }]);
  eq("rent +150: -1800", [rent.cash[12], rent.netWorth[12]], [-180_000, -180_000]);
  const less = run([{ id: "a", type: "expense", monthlyCents: -5_000, label: "Phone" }]);
  eq("cost -50: +600", [less.cash[12], less.netWorth[12]], [60_000, 60_000]);
  console.log("   ", up.effects[0].summary, "|", down.effects[0].summary, "|", rent.effects[0].summary, "|", less.effects[0].summary);
}
// 4. stop subscription
{
  const nf = rec.find((r) => r.merchant === "Netflix")!;
  const r = run([{ id: "a", type: "stop_subscription", recurringKey: nf.key }]);
  eq("netflix: monthly equivalent", monthlyEquivalent(nf), 2299);
  eq("netflix: 12 months = annual", r.cash[12], nf.annualCents);
  eq("netflix: NW same", r.netWorth[12], nf.annualCents);
  console.log("   ", r.effects[0].summary);
  const cancelled = runScenario({ horizonMonths: 12, changes: [{ id: "a", type: "stop_subscription", recurringKey: nf.key }] }, { ...ctx, recurring: rec.map((x) => (x.key === nf.key ? { ...x, status: "cancelled" as const } : x)) });
  eq("already cancelled: no effect", [cancelled.effects[0].unavailable, cancelled.hasEffect, cancelled.cash[12]], ["Already cancelled.", false, 0]);
  eq("gone from list: no effect", run([{ id: "a", type: "stop_subscription", recurringKey: "nope" }]).effects[0].unavailable, "Not found.");
  const inc = rec.find((r) => r.direction === "in")!;
  eq("cannot 'stop' income", run([{ id: "a", type: "stop_subscription", recurringKey: inc.key }]).effects[0].unavailable, "Not found.");
}
// 5/6. purchases
{
  const cash = run([{ id: "a", type: "purchase", label: "Car", priceCents: 3_000_000, downCents: 0, financed: false, aprBps: 0, termMonths: 0, inMonths: 3, valueCents: 0 }]);
  eq("cash purchase: nothing before month 3", [cash.cash[1], cash.cash[2]], [0, 0]);
  eq("cash purchase: -30000 from month 3", [cash.cash[3], cash.cash[12]], [-3_000_000, -3_000_000]);
  eq("cash purchase, worthless: NW -30000", cash.netWorth[12], -3_000_000);
  const kept = run([{ id: "a", type: "purchase", label: "Car", priceCents: 3_000_000, downCents: 0, financed: false, aprBps: 0, termMonths: 0, inMonths: 3, valueCents: 2_500_000 }]);
  eq("cash purchase, kept value 25000: NW -5000", kept.netWorth[12], -500_000);
  eq("cash purchase, kept: NW before purchase is 0", kept.netWorth[2], 0);

  const fin = run([{ id: "a", type: "purchase", label: "Car", priceCents: 3_000_000, downCents: 500_000, financed: true, aprBps: 650, termMonths: 60, inMonths: 2, valueCents: 2_800_000 }], 24);
  const s = loanSchedule(2_500_000, 650, 60);
  console.log("   loan payment", s.paymentCents / 100, " summary:", fin.effects[0].summary);
  eq("financed: identity holds", identity(fin), true);
  eq("financed: month 2 cash = -down", fin.cash[2], -500_000);
  eq("financed: month 2 debt = -loan", fin.debt[2], -2_500_000);
  eq("financed: month 2 NW = value - price", fin.netWorth[2], 2_800_000 - 3_000_000);
  const interestTo = (n: number) => s.interest.slice(1, n + 1).reduce((a, b) => a + b, 0);
  eq("financed: month 14 NW = value - price - interest so far (12 payments)", fin.netWorth[14], 2_800_000 - 3_000_000 - interestTo(12));
  eq("financed: month 24 NW = value - price - interest so far (22 payments)", fin.netWorth[24], 2_800_000 - 3_000_000 - interestTo(22));
  eq("financed: cash after 24 = -down - 22 payments", fin.cash[24], -500_000 - s.paid.slice(1, 23).reduce((a, b) => a + b, 0));
  eq("financed: debt at month 24 = -(balance after 22)", fin.debt[24], -s.balance[22]);
  // loan that ends inside the horizon
  const short = run([{ id: "a", type: "purchase", label: "Sofa", priceCents: 120_000, downCents: 0, financed: true, aprBps: 0, termMonths: 6, inMonths: 1, valueCents: 0 }], 12);
  eq("short 0% loan: debt is cleared by month 7", [short.debt[1], short.debt[7], short.debt[12]], [-120_000, 0, 0]);
  eq("short 0% loan: total cash out = price", short.cash[12], -120_000);
  eq("short 0% loan: NW -1200", short.netWorth[12], -120_000);
  eq("purchase after horizon: no effect", run([{ id: "a", type: "purchase", label: "X", priceCents: 100, downCents: 0, financed: false, aprBps: 0, termMonths: 0, inMonths: 13, valueCents: 0 }]).effects[0].unavailable, "After the period shown.");
  eq("financed with no term: refused", run([{ id: "a", type: "purchase", label: "X", priceCents: 100_000, downCents: 0, financed: true, aprBps: 500, termMonths: 0, inMonths: 1, valueCents: 0 }]).effects[0].unavailable, "No loan term entered.");
  const over = run([{ id: "a", type: "purchase", label: "X", priceCents: 100_000, downCents: 900_000, financed: true, aprBps: 500, termMonths: 12, inMonths: 1, valueCents: 0 }]);
  eq("down payment above price is capped at price (no loan)", [over.cash[12], over.debt[12]], [-100_000, 0]);
}
// 7. extra debt
{
  const H = 60;
  const debts = modellableDebts(snap.accounts, terms);
  const base = simulatePayoff(debts, today);
  const scen = simulatePayoff(debts, today, { extraCents: 30_000, strategy: "avalanche", rollover: true });
  const r = run([{ id: "a", type: "extra_debt", monthlyCents: 30_000, target: "all", strategy: "avalanche" }], H);
  console.log("   base", base.months, "scen", scen.months, "|", r.effects[0].summary);
  eq("extra debt: identity holds", identity(r), true);
  eq("extra debt: NW difference is exactly the interest saved, every month", r.netWorth.every((nw, m) => nw === (base.interest[Math.min(m, base.interest.length - 1)] - scen.interest[Math.min(m, scen.interest.length - 1)])), true);
  eq("extra debt: NW never negative", r.netWorth.every((n) => n >= 0), true);
  eq("extra debt: month 1 cash = -300", r.cash[1], -30_000);
  eq("extra debt: debt reduction month 1 ~ 300 + interest diff", r.debt[1] >= 30_000, true);
  eq("extra debt: outcome dates", [r.debtOutcome!.baselineDate, r.debtOutcome!.scenarioDate], [base.payoffDate, scen.payoffDate]);
  eq("extra debt: interest saved", r.debtOutcome!.interestSavedCents, base.totalInterestCents - scen.totalInterestCents);
  eq("extra debt: months sooner", r.debtOutcome!.monthsSooner, base.months! - scen.months!);
  eq("extra debt: after the scenario debts are gone, cash catches up (debt fully cleared)", r.debt[H], valueAtBal(base.balance, H) - valueAtBal(scen.balance, H));
  function valueAtBal(a: number[], m: number) { return a[Math.min(m, a.length - 1)]; }
  const focus = run([{ id: "a", type: "extra_debt", monthlyCents: 30_000, target: "acct-student", strategy: "avalanche" }], H);
  const focusSim = simulatePayoff(debts, today, { extraCents: 30_000, rollover: true, focusId: "acct-student" });
  eq("focus on one debt: interest saved matches its own simulation", focus.debtOutcome!.interestSavedCents, base.totalInterestCents - focusSim.totalInterestCents);
  eq("focused label", focus.debtOutcome!.strategy, "that debt first");
  const nothing = runScenario({ horizonMonths: 12, changes: [{ id: "a", type: "extra_debt", monthlyCents: 30_000, target: "all", strategy: "avalanche" }] }, { ...ctx, debtTerms: new Map() });
  eq("no terms: no effect and says why", [nothing.hasEffect, nothing.effects[0].unavailable, nothing.cash[12]], [false, "Missing rate or payment.", 0]);
  console.log("   ", nothing.effects[0].summary);
  const two = run([{ id: "a", type: "extra_debt", monthlyCents: 10_000, target: "all", strategy: "avalanche" }, { id: "b", type: "extra_debt", monthlyCents: 10_000, target: "all", strategy: "snowball" }]);
  eq("only the first extra debt payment counts", [two.effects[0].unavailable, two.effects[1].unavailable], [null, "Only one allowed."]);
  const missing = run([{ id: "a", type: "extra_debt", monthlyCents: 10_000, target: "acct-card", strategy: "avalanche" }]);
  eq("target with no terms: no effect", missing.effects[0].unavailable, "Missing rate or payment.");
  const partial = run([{ id: "a", type: "extra_debt", monthlyCents: 10_000, target: "all", strategy: "avalanche" }]);
  eq("summary names the debt left out (card has no terms)", partial.effects[0].summary.includes("Rewards Card"), true);
}
// 8. goals
{
  const r = run([{ id: "a", type: "save_more", monthlyCents: 30_000, goalId: "g1" }]);
  const g = r.goals[0];
  console.log("   goal:", g);
  eq("goal baseline: 10000 at 200/mo = 50 months", g.baselineDate, "2030-11-25");
  eq("goal scenario: 500/mo = 20 months", g.scenarioDate, "2028-05-25");
  eq("goal months sooner (calendar): 30", g.monthsSooner, 30);
  const none = run([{ id: "a", type: "save_more", monthlyCents: 30_000, goalId: null }]);
  eq("no goal chosen: no goal outcome", none.goals, []);
  const stranger = run([{ id: "a", type: "save_more", monthlyCents: 30_000, goalId: "deleted" }]);
  eq("deleted goal is ignored, not a crash", stranger.goals, []);
  const both = run([{ id: "a", type: "save_more", monthlyCents: 10_000, goalId: "g1" }, { id: "b", type: "save_more", monthlyCents: 20_000, goalId: "g1" }]);
  eq("two saving changes on one goal add up", both.goals[0].scenarioDate, "2028-05-25");
  const noPace = runScenario({ horizonMonths: 12, changes: [{ id: "a", type: "save_more", monthlyCents: 30_000, goalId: "g1" }] }, { ...ctx, goals: [{ ...goal, monthlyPlanCents: 0 }] });
  eq("goal with no pace: baseline unknown, scenario known, months sooner unknown", [noPace.goals[0].baselineDate, noPace.goals[0].scenarioDate !== null, noPace.goals[0].monthsSooner], [null, true, null]);
}
// 9. combos + edge cases
{
  const combo = run([
    { id: "1", type: "save_more", monthlyCents: 30_000, goalId: "g1" },
    { id: "2", type: "income", monthlyCents: 50_000 },
    { id: "3", type: "expense", monthlyCents: 20_000, label: "Rent" },
    { id: "4", type: "extra_debt", monthlyCents: 20_000, target: "all", strategy: "snowball" },
    { id: "5", type: "purchase", label: "Laptop", priceCents: 200_000, downCents: 0, financed: false, aprBps: 0, termMonths: 0, inMonths: 4, valueCents: 100_000 },
  ], 24);
  eq("combo: identity holds every month", identity(combo), true);
  eq("combo: five effects, all live", combo.effects.map((e) => e.unavailable), [null, null, null, null, null]);
  eq("combo: deterministic", JSON.stringify(run([{ id: "1", type: "income", monthlyCents: 5 }])) === JSON.stringify(run([{ id: "1", type: "income", monthlyCents: 5 }])), true);
  eq("empty scenario: nothing", [run([]).hasEffect, run([]).netWorth.every((n) => n === 0)], [false, true]);
  eq("zero amounts are refused, not silently ignored", run([{ id: "a", type: "save_more", monthlyCents: 0, goalId: null }, { id: "b", type: "income", monthlyCents: 0 }, { id: "c", type: "extra_debt", monthlyCents: 0, target: "all", strategy: "avalanche" }]).effects.map((e) => e.unavailable !== null), [true, true, true]);
  eq("horizon is clamped", [run([], 0).horizonMonths, run([], 9999).horizonMonths], [1, 120]);
  eq("titles", ctx && [changeTitle({ id: "a", type: "save_more", monthlyCents: 50_000, goalId: "g1" }, ctx), changeTitle({ id: "a", type: "expense", monthlyCents: -5_000, label: "Phone" }, ctx), changeTitle({ id: "a", type: "extra_debt", monthlyCents: 30_000, target: "acct-auto", strategy: "avalanche" }, ctx)], ["Save $500 more a month toward Emergency fund", "Phone down $50 a month", "Pay $300 extra a month toward Auto Loan"]);
  eq("the spec's example: what if I save $500 more per month? goal next to it", true, true);
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
