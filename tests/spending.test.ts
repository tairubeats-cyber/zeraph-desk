import { generateSample } from "../src/lib/finance/sample";
import { flowForMonth, resolveTransactions } from "../src/lib/finance/analysis";
import { DEFAULT_CATEGORIES } from "../src/lib/finance/categories";
import {
  yearUnavailableReason,
  change,
  changePhrase,
  coversMonth,
  monthsOfHistory,
  selectableMonths,
  signedChange,
  spendingReport,
  spendingTrend,
  stretchFor,
  topMerchants,
  unusualPurchases,
} from "../src/lib/finance/spending";
import type { Category, ResolvedTransaction } from "../src/lib/finance/types";

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
  id: "t" + ++n,
  accountId: "a",
  date,
  merchant,
  description: merchant.toUpperCase(),
  amountCents: Math.round(dollars * 100),
  categoryHint: null,
  pending: false,
  categoryId,
  note: "",
  flagged: false,
  recategorized: false,
});

// ---- hand-built history, 2025-07 through 2026-09 --------------------------------------------------------------
const txs: ResolvedTransaction[] = [];
for (let y = 2025, m = 7; y * 12 + m <= 2026 * 12 + 9; m === 12 ? (y++, (m = 1)) : m++) {
  const mm = String(m).padStart(2, "0");
  txs.push(tx(`${y}-${mm}-03`, "housing", -1000, "Oakwood Rent"));
}
txs.push(tx("2025-09-12", "food", -200, "Green Grocer")); // a year ago
txs.push(tx("2026-08-05", "food", -250, "Green Grocer"));
txs.push(tx("2026-08-24", "food", -50, "Corner Market"));
txs.push(tx("2026-08-27", "dining", -500, "Big Dinner")); // after day 25: must not count against a September that is only 25 days old
txs.push(tx("2026-09-04", "food", -100, "Green Grocer"));
txs.push(tx("2026-09-09", "food", -80, "Green Grocer"));
txs.push(tx("2026-09-10", "food", 20, "Green Grocer")); // a refund
txs.push(tx("2026-09-20", "food", -120, "Corner Market"));
txs.push(tx("2026-09-15", "transfers", -500, "Savings Move")); // a transfer isn't spending
txs.push(tx("2026-09-01", "income", 3000, "Payroll")); // income isn't spending
txs.push(tx("2026-09-11", "dining", -50, "Return Depot"));
txs.push(tx("2026-09-12", "dining", 50, "Return Depot")); // bought and returned: nets to nothing

// ---- stretch and coverage ---------------------------------------------------------------------------------------
eq("current month is cut off at today", stretchFor("2026-09", today), { throughDay: 25, partial: true });
eq("an earlier month is taken whole", stretchFor("2026-08", today), { throughDay: 31, partial: false });
yes("covers a month after the first one", coversMonth(txs, "2025-08"));
yes("does not cover the month the history starts in (it may be part-way through)", !coversMonth(txs, "2025-07"));
yes("does not cover a month before the history", !coversMonth(txs, "2025-05"));
yes("no transactions cover nothing", !coversMonth([], "2026-09"));
eq("months of history, both ends counted", monthsOfHistory(txs, today), 15);
eq("no history", monthsOfHistory([], today), 0);

// ---- change -----------------------------------------------------------------------------------------------------
eq("change up", change(120, 100), { cents: 20, fraction: 0.2 });
eq("change down", change(80, 100), { cents: -20, fraction: -0.2 });
eq("no percentage of nothing", change(50, 0), { cents: 50, fraction: null });
eq("both zero", change(0, 0), { cents: 0, fraction: null });

// ---- wording ---------------------------------------------------------------------------------------------------
eq("signed change up", signedChange({ cents: 12_000, fraction: 0.12 }), "+$120 (12%)");
eq("signed change down uses a real minus", signedChange({ cents: -12_000, fraction: -0.12 }), "−$120 (12%)");
eq("no percentage when there was nothing before", signedChange({ cents: 5_000, fraction: null }), "+$50");
eq("no change", signedChange({ cents: 0, fraction: null }), "no change");
eq("phrase: more", changePhrase({ cents: 12_000, fraction: 0.12 }), "$120 (12%) more than");
eq("phrase: less", changePhrase({ cents: -12_000, fraction: -0.12 }), "$120 (12%) less than");
eq("phrase: the same", changePhrase({ cents: 0, fraction: 0 }), "the same as");
eq("phrase without a percentage", changePhrase({ cents: 900, fraction: null }), "$9 more than");

// ---- the September report ---------------------------------------------------------------------------------------
const r = spendingReport(txs, catMap, "2026-09", today);
eq("total: rent 1000 + food 280 (refund netted) + nothing for the transfer, income or the returned item", r.totalCents, 128_000);
eq("still in progress", [r.partial, r.throughDay], [true, 25]);
eq("categories, largest first", r.lines.map((l) => [l.categoryId, l.cents]), [["housing", 100_000], ["food", 28_000]]);
near("shares add to 1", r.lines.reduce((s, l) => s + l.share, 0), 1, 1e-9);
eq("food share", Math.round(r.lines[1].share * 1000), 219);
eq("food purchase count includes the refund line", r.lines[1].count, 4);
eq("previous month is the same stretch: rent 1000 + food 300, and not the day-27 dinner", r.previousMonth && [r.previousMonth.month, r.previousMonth.totalCents], ["2026-08", 130_000]);
eq("total vs last month", r.previousMonth?.change, { cents: -2_000, fraction: -2_000 / 130_000 });
eq("a year ago: rent 1000 + food 200", r.previousYear && [r.previousYear.month, r.previousYear.totalCents], ["2025-09", 120_000]);
eq("total vs a year ago", r.previousYear?.change, { cents: 8_000, fraction: 8_000 / 120_000 });
eq("food vs last month (300 -> 280)", r.lines[1].vsPreviousMonth, { cents: -2_000, fraction: -2_000 / 30_000, previousCents: 30_000 });
eq("food vs a year ago (200 -> 280)", r.lines[1].vsPreviousYear, { cents: 8_000, fraction: 0.4, previousCents: 20_000 });
eq("rent is flat both ways", [r.lines[0].vsPreviousMonth?.cents, r.lines[0].vsPreviousYear?.cents], [0, 0]);
yes("year comparison is available", r.yearComparisonAvailable);
eq("months of data", r.monthsOfData, 15);
eq("the month a year ago and where the data starts", [r.yearAgoMonth, r.earliest], ["2025-09", "2025-07-03"]);

// a whole earlier month is compared whole
const aug = spendingReport(txs, catMap, "2026-08", today);
eq("August is whole: rent 1000 + food 300 + dinner 500", aug.totalCents, 180_000);
eq("...and not partial", aug.partial, false);
eq("August vs July: July is whole too (rent 1000)", aug.previousMonth && aug.previousMonth.totalCents, 100_000);

eq("the reason a year comparison is missing names the month and the first date", yearUnavailableReason({ yearAgoMonth: "2025-06", earliest: "2025-07-03" }), "Nothing is loaded from June 2025 to compare with; the earliest transaction is from Jul 3, 2025.");
eq("the reason with nothing loaded", yearUnavailableReason({ yearAgoMonth: "2025-06", earliest: null }), "No transactions are loaded to compare.");

// early in the history nothing can be compared, and it says so instead of showing zero
const early = spendingReport(txs, catMap, "2025-08", today);
eq("no comparison with a month the history starts in", early.previousMonth, null);
eq("no year comparison without a year of history", [early.previousYear, early.yearComparisonAvailable], [null, false]);
eq("category lines carry no comparison either", early.lines.map((l) => [l.vsPreviousMonth, l.vsPreviousYear]), [[null, null]]);

// ---- trend ------------------------------------------------------------------------------------------------------
const t = spendingTrend(txs, catMap, null, "2026-09", today, 16);
eq("sixteen points, oldest first", [t.length, t[0].month, t[15].month], [16, "2025-06", "2026-09"]);
eq("months before the history, and the one it starts in, are marked not covered, not shown as small numbers", [t[0].covered, t[1].covered, t[2].covered], [false, false, true]);
eq("the current month is cut at today so it doesn't look like a drop", t[15].cents, 128_000);
eq("a whole month", t[14].cents, 180_000);
const tf = spendingTrend(txs, catMap, "food", "2026-09", today, 3);
eq("one category", tf.map((p) => [p.month, p.cents]), [["2026-07", 0], ["2026-08", 30_000], ["2026-09", 28_000]]);

// ---- merchants --------------------------------------------------------------------------------------------------
eq("largest merchants in food; the refund nets off", topMerchants(txs, catMap, "2026-09", 25, "food"), [
  { merchant: "Green Grocer", cents: 16_000, count: 3 },
  { merchant: "Corner Market", cents: 12_000, count: 1 },
]);
eq("across everything, rent leads and a merchant that nets to zero is left out", topMerchants(txs, catMap, "2026-09", 25, null).map((m) => m.merchant), ["Oakwood Rent", "Green Grocer", "Corner Market"]);
eq("limit", topMerchants(txs, catMap, "2026-09", 25, null, 1).length, 1);
eq("nothing in an empty month", topMerchants(txs, catMap, "2024-01", 31, null), []);

// ---- unusual purchases --------------------------------------------------------------------------------------------
const u: ResolvedTransaction[] = [
  tx("2026-04-02", "shopping", -40, "Shop"), tx("2026-05-02", "shopping", -40, "Shop"), tx("2026-06-02", "shopping", -40, "Shop"),
  tx("2026-07-02", "shopping", -40, "Shop"), tx("2026-08-02", "shopping", -40, "Shop"),
  tx("2026-09-03", "shopping", -400, "Big Screen"), // 10x
  tx("2026-09-04", "shopping", -90, "Small One"), // 2.25x and under $100
  tx("2026-09-05", "shopping", -130, "Just Over"), // 3.25x and over $100
  tx("2026-09-06", "shopping", -119, "Just Under"), // 2.975x
  tx("2026-09-07", "travel", -900, "Airline"), // nothing earlier in travel: no "usual"
];
const un = unusualPurchases(u, catMap, "2026-09", 30, null);
eq("only what's both large and well above usual", un.map((x) => x.merchant), ["Big Screen", "Just Over"]);
eq("how many times the usual", un.map((x) => Math.round(x.times * 100) / 100), [10, 3.25]);
eq("the usual purchase", un[0].usualCents, 4_000);
eq("a category filter", unusualPurchases(u, catMap, "2026-09", 30, "travel"), []);
eq("a cut-off day leaves later purchases out", unusualPurchases(u, catMap, "2026-09", 4, null).map((x) => x.merchant), ["Big Screen"]);
eq("income and transfers are never unusual spending", unusualPurchases([...u, tx("2026-09-08", "transfers", -5000, "Move")], catMap, "2026-09", 30, null).map((x) => x.merchant), ["Big Screen", "Just Over"]);

// ---- which months to offer -------------------------------------------------------------------------------------
const months = selectableMonths(txs, today);
eq("fourteen months, newest first, none before the data", [months.length, months[0], months[13]], [14, "2026-09", "2025-08"]);
eq("all of a short history", selectableMonths([tx("2026-08-10", "food", -5, "x")], today), ["2026-09", "2026-08"]);
eq("no data still offers the current month", selectableMonths([], today), ["2026-09"]);

// ---- against the sample and against the existing month totals --------------------------------------------------
{
  const snap = generateSample(today);
  const rs = resolveTransactions(snap.transactions, cats, new Map());
  const rep = spendingReport(rs, catMap, "2026-09", today);
  const flow = flowForMonth(rs, catMap, "2026-09", 25);
  eq("sample: the total is the same figure Cash Flow reports", rep.totalCents, flow.spendingCents);
  eq("sample: last month's same stretch matches Cash Flow too", rep.previousMonth?.totalCents, flowForMonth(rs, catMap, "2026-08", 25).spendingCents);
  eq("sample: a year ago matches", rep.previousYear?.totalCents, flowForMonth(rs, catMap, "2025-09", 25).spendingCents);
  yes("sample has the year of history a comparison needs", rep.yearComparisonAvailable);
  yes("sample: lines run largest to smallest", rep.lines.every((l, i) => i === 0 || rep.lines[i - 1].cents >= l.cents));
  near("sample: shares add to 1", rep.lines.reduce((s, l) => s + l.share, 0), 1, 1e-9);
  eq("sample: lines add to the total", rep.lines.reduce((s, l) => s + l.cents, 0), rep.totalCents);
  const tr = spendingTrend(rs, catMap, null, "2026-09", today, 12);
  yes("sample: a twelve-month trend, every month covered", tr.length === 12 && tr.every((p) => p.covered));
  eq("sample: the trend's last point is this month's total", tr[11].cents, rep.totalCents);
  const empty = spendingReport([], catMap, "2026-09", today);
  eq("nothing loaded: no spending, no comparisons, no crash", [empty.totalCents, empty.lines.length, empty.previousMonth, empty.previousYear, empty.monthsOfData], [0, 0, null, null, 0]);
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
