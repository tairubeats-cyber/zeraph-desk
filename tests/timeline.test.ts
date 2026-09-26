import { generateSample } from "../src/lib/finance/sample";
import { resolveTransactions } from "../src/lib/finance/analysis";
import { DEFAULT_CATEGORIES } from "../src/lib/finance/categories";
import { goalProgress } from "../src/lib/finance/goals";
import { recurringKey, buildRecurring } from "../src/lib/finance/recurring";
import {
  ALL_GROUPS,
  GROUP_LABELS,
  GROUP_OF,
  PURCHASES_PER_MONTH,
  PURCHASE_FLOOR_CENTS,
  aheadTotals,
  buildTimeline,
  byDay,
  filterTimeline,
  relativeDay,
  sections,
  type TimelineInput,
  type TimelineKind,
} from "../src/lib/finance/timeline";
import type { Category, Goal, GoalContribution, PlannedItem, RecurringPayment, ResolvedTransaction } from "../src/lib/finance/types";
import { findItem } from "../src/nav";

let fails = 0;
const eq = (n: string, g: unknown, w: unknown) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  if (!ok) fails++;
  console.log((ok ? "ok   " : "FAIL ") + n + (ok ? "" : `  got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
};
const yes = (n: string, c: boolean) => eq(n, c, true);

const cats: Category[] = DEFAULT_CATEGORIES.map((c, i) => ({ ...c, position: i, hidden: false }));
const catMap = new Map(cats.map((c) => [c.id, c]));
const today = "2026-09-25";

let n = 0;
const tx = (date: string, categoryId: string, dollars: number, merchant: string): ResolvedTransaction => ({
  id: "t" + ++n, accountId: "chk", date, merchant, description: merchant.toUpperCase(), amountCents: Math.round(dollars * 100),
  categoryHint: null, pending: false, categoryId, note: "", flagged: false, recategorized: false,
});

// ---- a small life with dates that can be checked by hand -------------------------------------------------------
const rent0 = tx("2026-09-03", "housing", -1500, "Oakwood Rent");
const card0 = tx("2026-09-20", "transfers", -630, "Card Payment");
const txs: ResolvedTransaction[] = [
  tx("2026-09-01", "income", 4000, "Payroll"),
  tx("2026-09-01", "income", 500, "Bonus"),
  tx("2026-08-01", "income", 4000, "Payroll"),
  rent0,
  tx("2026-08-03", "housing", -1500, "Oakwood Rent"),
  card0,
  // August purchases: the three largest at or above $50 get a line; the rest don't.
  tx("2026-08-10", "shopping", -1200, "Laptop Store"),
  tx("2026-08-11", "shopping", -300, "Hardware Barn"),
  tx("2026-08-12", "food", -80, "Green Grocer"),
  tx("2026-08-13", "healthcare", -60, "Pharmacy"),
  tx("2026-08-14", "transportation", -55, "Gas Stop"),
  tx("2026-08-15", "dining", -4, "Coffee Cart"),
  // September purchases
  tx("2026-09-12", "dining", -70, "Steak House"),
  tx("2026-09-14", "shopping", -150, "Gadget Shop"),
  tx("2026-09-16", "dining", -20, "Snack Bar"), // September's third-largest, but under the $50 floor
];
// Five small shopping purchases long before the window, so a $150 one stands out (3.75x the usual $40).
for (const d of ["2026-03-05", "2026-03-19", "2026-04-02", "2026-04-16", "2026-05-01"]) txs.push(tx(d, "shopping", -40, "Small Things"));

const recurring: RecurringPayment[] = [
  { key: recurringKey(rent0), source: "manual", merchant: "Oakwood Rent", categoryId: "housing", direction: "out", kind: "expense", frequency: "monthly", amountCents: 150_000, typicalCents: 150_000, variable: false, annualCents: 1_800_000, lastDate: "2026-09-03", nextDate: "2026-10-03", occurrences: 6, possiblyStopped: false, monthDays: [], txIds: [], status: "active", necessity: "unset", autopay: "unset", isBill: true },
  { key: recurringKey(tx("2026-09-01", "income", 4000, "Payroll")), source: "manual", merchant: "Payroll", categoryId: "income", direction: "in", kind: "income", frequency: "monthly", amountCents: 400_000, typicalCents: 400_000, variable: false, annualCents: 4_800_000, lastDate: "2026-09-01", nextDate: "2026-10-01", occurrences: 6, possiblyStopped: false, monthDays: [], txIds: [], status: "active", necessity: "unset", autopay: "unset", isBill: false },
  { key: recurringKey(card0), source: "manual", merchant: "Card Payment", categoryId: "transfers", direction: "out", kind: "transfer", frequency: "monthly", amountCents: 63_000, typicalCents: 63_000, variable: false, annualCents: 756_000, lastDate: "2026-09-20", nextDate: "2026-10-20", occurrences: 6, possiblyStopped: false, monthDays: [], txIds: [], status: "active", necessity: "unset", autopay: "unset", isBill: false },
];
const goals: Goal[] = [
  { id: "g1", name: "Emergency fund", kind: "emergency_fund", targetCents: 1_000_000, startCents: 200_000, deadline: "2026-10-15", monthlyPlanCents: 50_000, createdAt: "2026-01-01" },
  { id: "g2", name: "Trip", kind: "vacation", targetCents: 300_000, startCents: 50_000, deadline: "2026-08-01", monthlyPlanCents: 0, createdAt: "2026-01-01" },
  { id: "g3", name: "Done", kind: "custom", targetCents: 100_000, startCents: 100_000, deadline: "2026-10-01", monthlyPlanCents: 0, createdAt: "2026-01-01" },
];
const contributions: GoalContribution[] = [{ id: "c1", goalId: "g1", date: "2026-09-10", amountCents: 50_000 }, { id: "c2", goalId: "g1", date: "2026-02-10", amountCents: 50_000 }];
const planned: PlannedItem[] = [
  { id: "p1", name: "Dentist", date: "2026-10-05", amountCents: 80_000, direction: "out" },
  { id: "p2", name: "Old plan", date: "2026-09-01", amountCents: 10_000, direction: "out" },
  { id: "p3", name: "Far away", date: "2027-01-01", amountCents: 10_000, direction: "out" },
];
const findings = [
  { id: "f1", title: "Large shopping purchase at Gadget Shop", summary: "$150.00 on Sep 14.", on: "2026-09-22", view: "transactions" as const },
  { id: "f2", title: "A bill is due soon", summary: "Rent falls due Oct 1.", on: "2026-10-01", view: "bills" as const },
  { id: "f3", title: "Too old", summary: "x", on: "2026-01-01", view: "activity" as const },
];

const input: TimelineInput = { today, transactions: txs, categories: catMap, recurring, planned, goals, contributions, findings, pastDays: 90, aheadDays: 30 };
const all = buildTimeline(input);
const sec = sections(all);
const brief = (list: typeof all) => list.map((e) => `${e.date} ${e.kind} ${e.title}${e.amountCents === null ? "" : " " + e.amountCents}`);

// ---- what's ahead ---------------------------------------------------------------------------------------------------------
eq("ahead: only what a pattern, a plan or a deadline puts there, soonest first", brief(sec.ahead), [
  "2026-10-01 income Payroll 400000",
  "2026-10-03 bill Oakwood Rent -150000",
  "2026-10-05 planned Dentist -80000",
  "2026-10-15 deadline Deadline for Emergency fund",
  "2026-10-20 transfer Card Payment -63000",
]);
eq("nothing is scheduled for today", sec.today, []);
yes("everything ahead is labelled a projection, never a fact", sec.ahead.every((e) => e.basis === "projection"));
yes("a plan outside the window isn't there", !all.some((e) => e.title === "Far away"));
yes("a plan that was for a past date isn't there", !all.some((e) => e.title === "Old plan"));
yes("a goal that's already reached has no deadline entry", !all.some((e) => e.id === "gd-g3"));
eq("the deadline says what's still to set aside, and whether the rate covers it", sec.ahead.find((e) => e.kind === "deadline")!.detail, `$${((1_000_000 - (200_000 + 100_000)) / 100).toLocaleString("en-US")} still to set aside${goalProgress(goals[0], contributions, today).finishesByDeadline === false ? ", more than the current rate covers" : ""}`);
eq("a repeating payment says how often", sec.ahead[1].detail, "Monthly");
eq("a payment to your own account says so", sec.ahead[4].detail, "Monthly · to your own account");

// ---- what happened ---------------------------------------------------------------------------------------------------------
eq("earlier: income, payments that repeat, each month's largest purchases, deposits, findings and a missed deadline, newest first", brief(sec.earlier), [
  "2026-09-22 finding Large shopping purchase at Gadget Shop",
  "2026-09-20 transfer Card Payment -63000",
  "2026-09-14 purchase Gadget Shop -15000",
  "2026-09-12 purchase Steak House -7000",
  "2026-09-10 goal Set aside for Emergency fund 50000",
  "2026-09-03 bill Oakwood Rent -150000",
  "2026-09-01 income Bonus 50000",
  "2026-09-01 income Payroll 400000",
  "2026-08-12 purchase Green Grocer -8000",
  "2026-08-11 purchase Hardware Barn -30000",
  "2026-08-10 purchase Laptop Store -120000",
  "2026-08-03 bill Oakwood Rent -150000",
  "2026-08-01 deadline Deadline for Trip",
  "2026-08-01 income Payroll 400000",
]);
yes("everything earlier is a fact or a calculation, never a projection", sec.earlier.every((e) => e.basis === "fact" || e.basis === "calculation"));
yes("a purchase under the floor isn't there, even when it would be the month's third-largest", !all.some((e) => ["Coffee Cart", "Snack Bar"].includes(e.title)));
yes("nor is one that missed the month's top three", !all.some((e) => ["Pharmacy", "Gas Stop"].includes(e.title)));
eq("the floor and the count are what the screen says", [PURCHASES_PER_MONTH, PURCHASE_FLOOR_CENTS], [3, 5000]);
eq("a purchase that stands out says how far above usual", sec.earlier.find((e) => e.title === "Gadget Shop")!.detail, "Shopping · about 3.8× the usual purchase there");
eq("...and marks it as a calculation", sec.earlier.find((e) => e.title === "Gadget Shop")!.basis, "calculation");
eq("an ordinary large purchase says so", sec.earlier.find((e) => e.title === "Steak House")!.detail, "Dining · one of the month's largest");
eq("a deposit you recorded", sec.earlier.find((e) => e.kind === "goal")!.detail, "A deposit you recorded");
eq("a missed deadline says what had been set aside", sec.earlier.find((e) => e.kind === "deadline")!.detail, "$500 of $3,000 was set aside by then");
eq("a finding carries its own summary", sec.earlier.find((e) => e.kind === "finding")!.detail, "$150.00 on Sep 14.");
yes("a finding dated in the future isn't repeated (the schedule already has it)", !all.some((e) => e.id === "fd-f2"));
yes("a finding from long ago isn't there", !all.some((e) => e.id === "fd-f3"));
yes("a goal deposit from before the window isn't there", !all.some((e) => e.id === "gc-c2"));
eq("a repeating payment says how often", sec.earlier.find((e) => e.id === "tx-" + rent0.id)!.detail, "Monthly");
yes("every entry is dated inside the window", all.every((e) => e.date >= "2026-06-27" && e.date <= "2026-10-25"));

// ---- the window ------------------------------------------------------------------------------------------------------------
{
  const short = buildTimeline({ ...input, pastDays: 30, aheadDays: 10 });
  eq("a shorter look back drops August", short.filter((e) => e.when === "earlier").every((e) => e.date >= "2026-08-26"), true);
  yes("...and keeps September", short.some((e) => e.title === "Steak House"));
  eq("a shorter look ahead drops what's further out", sections(short).ahead.map((e) => e.title), ["Payroll", "Oakwood Rent", "Dentist"]);
  eq("no window at all is empty and doesn't crash", buildTimeline({ ...input, pastDays: 0, aheadDays: 0 }).length, 0);
  eq("nothing loaded", buildTimeline({ ...input, transactions: [], recurring: [], planned: [], goals: [], contributions: [], findings: [] }), []);
}
{
  const todayTx = [...txs, tx("2026-09-25", "income", 100, "Refund Today")];
  const t = sections(buildTimeline({ ...input, transactions: todayTx }));
  eq("something that happened today is its own section", t.today.map((e) => e.title), ["Refund Today"]);
}
{
  const dueToday = recurring.map((r) => (r.merchant === "Payroll" ? { ...r, nextDate: today } : r));
  const s2 = sections(buildTimeline({ ...input, recurring: dueToday }));
  eq("a payment due today that hasn't posted shows as today's, a projection", s2.today.map((e) => [e.title, e.basis]), [["Payroll", "projection"]]);
  const posted = sections(buildTimeline({ ...input, recurring: dueToday, transactions: [...txs, tx(today, "income", 4000, "Payroll")] }));
  eq("...and once it has posted it isn't listed twice", posted.today.map((e) => [e.title, e.basis]), [["Payroll", "fact"]]);
}

// ---- filters, days, totals ----------------------------------------------------------------------------------------------
eq("every kind belongs to one filter", (Object.keys(GROUP_OF) as TimelineKind[]).every((k) => ALL_GROUPS.includes(GROUP_OF[k])), true);
eq("every filter has a name", ALL_GROUPS.map((g) => GROUP_LABELS[g].length > 0), [true, true, true, true, true]);
eq("only money in", [...new Set(filterTimeline(all, new Set(["in"])).map((e) => e.kind))], ["income"]);
eq("bills and payments include the transfers", [...new Set(filterTimeline(all, new Set(["bills"])).map((e) => e.kind))].sort(), ["bill", "transfer"]);
eq("plans and goals", [...new Set(filterTimeline(all, new Set(["plans"])).map((e) => e.kind))].sort(), ["deadline", "goal", "planned"]);
eq("nothing switched on shows nothing", filterTimeline(all, new Set()), []);
eq("everything switched on shows everything", filterTimeline(all, new Set(ALL_GROUPS)).length, all.length);
eq("filters keep the order", filterTimeline(all, new Set(["in"])).map((e) => e.date), filterTimeline(all, new Set(["in"])).map((e) => e.date).slice().sort());

{
  const days = byDay(sec.earlier);
  eq("days are grouped, newest first", days.slice(0, 3).map((d) => [d.date, d.entries.length]), [["2026-09-22", 1], ["2026-09-20", 1], ["2026-09-14", 1]]);
  eq("two things on one day share it", days.find((d) => d.date === "2026-09-01")!.entries.map((e) => e.title), ["Bonus", "Payroll"]);
  eq("nothing is lost in grouping", days.reduce((s2, d) => s2 + d.entries.length, 0), sec.earlier.length);
  eq("no entries, no days", byDay([]), []);
}
eq("what's expected in and out ahead: 4,000 in; 1,500 + 800 + 630 out; five items", aheadTotals(all), { count: 5, inCents: 400_000, outCents: 293_000 });
eq("a filtered view totals only what's showing", aheadTotals(filterTimeline(all, new Set(["bills"]))), { count: 2, inCents: 0, outCents: 213_000 });
eq("nothing ahead", aheadTotals([]), { count: 0, inCents: 0, outCents: 0 });
eq("relative days", [relativeDay(today, today), relativeDay("2026-09-26", today), relativeDay("2026-09-24", today), relativeDay("2026-09-30", today), relativeDay("2026-09-22", today)], ["Today", "Tomorrow", "Yesterday", "In 5 days", "3 days ago"]);

// ---- integrity ---------------------------------------------------------------------------------------------------------------
yes("every id is unique", new Set(all.map((e) => e.id)).size === all.length);
yes("every entry opens a real screen", all.every((e) => findItem(e.view).item.key === e.view));
yes("amounts are whole cents", all.every((e) => e.amountCents === null || Number.isInteger(e.amountCents)));
yes("an entry with no amount is a deadline or a finding, and says so in words", all.filter((e) => e.amountCents === null).every((e) => (e.kind === "deadline" || e.kind === "finding") && e.detail.length > 0));
yes("money out is negative and money in is positive", all.every((e) => (e.kind === "income" ? (e.amountCents ?? 0) > 0 : e.kind === "bill" || e.kind === "transfer" || e.kind === "purchase" ? (e.amountCents ?? 0) < 0 : true)));
{
  const words = all.flatMap((e) => [e.title, e.detail]).join(" | ");
  eq("no verdict or advice wording", words.match(/\b(should|must|overspent|overspending|too much|bad|poor|risky|wasteful|irresponsible|shame)\b/gi), null);
  eq("no raw ISO dates in the text", words.match(/\b\d{4}-\d{2}-\d{2}\b/g), null);
}

// ---- the sample -----------------------------------------------------------------------------------------------------------------
{
  const snap = generateSample(today);
  const rs = resolveTransactions(snap.transactions, cats, new Map());
  const rec = buildRecurring(rs, catMap, [], new Map(), today);
  const sample = buildTimeline({ ...input, transactions: rs, recurring: rec, planned: [], goals: [], contributions: [], findings: [], pastDays: 90, aheadDays: 60 });
  const ss = sections(sample);
  const incomeTxs = rs.filter((t) => t.date >= "2026-06-27" && t.date <= today && (catMap.get(t.categoryId)?.kind ?? "") === "income").length;
  eq("sample: one line for every income deposit in the window", sample.filter((e) => e.kind === "income" && e.when !== "ahead").length, incomeTxs);
  yes("sample: it has both sides", ss.earlier.length > 10 && ss.ahead.length > 5);
  yes("sample: nothing ahead is dated before tomorrow or after the window", ss.ahead.every((e) => e.date > today && e.date <= "2026-11-24"));
  yes("sample: nothing earlier is dated today or later", ss.earlier.every((e) => e.date < today));
  yes("sample: earlier is newest first and ahead is soonest first", ss.earlier.every((e, i) => i === 0 || ss.earlier[i - 1].date >= e.date) && ss.ahead.every((e, i) => i === 0 || ss.ahead[i - 1].date <= e.date));
  const perMonth = new Map<string, number>();
  for (const e of sample.filter((x) => x.kind === "purchase" && x.basis === "fact")) perMonth.set(e.date.slice(0, 7), (perMonth.get(e.date.slice(0, 7)) ?? 0) + 1);
  yes("sample: never more than three ordinary large purchases in a month", [...perMonth.values()].every((c) => c <= PURCHASES_PER_MONTH));
  yes("sample: every projection is ahead and every fact is behind", sample.every((e) => (e.basis === "projection") === (e.when === "ahead" || e.id.startsWith("rc-") || e.id.startsWith("pl-"))));
  yes("sample: ids unique", new Set(sample.map((e) => e.id)).size === sample.length);
}

console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
