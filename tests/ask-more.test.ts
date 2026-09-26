import { generateSample } from "../src/lib/finance/sample";
import { DEFAULT_CATEGORIES } from "../src/lib/finance/categories";
import { categoryMap, resolveTransactions } from "../src/lib/finance/analysis";
import { buildRecurring } from "../src/lib/finance/recurring";
import { answer, type AskContext } from "../src/lib/finance/ask";
import { DEFAULT_LONG_TERM, project } from "../src/lib/finance/longterm";

let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)); };
const yes = (name: string, c: boolean) => eq(name, c, true);

const today = "2026-09-25";
const snap = generateSample(today);
const cats = DEFAULT_CATEGORIES.map((c, i) => ({ ...c, position: i, hidden: false }));
const txs = resolveTransactions(snap.transactions, cats, new Map());
const base: AskContext = {
  today, sample: true, transactions: txs, categories: cats, accounts: snap.accounts,
  institutions: new Map(snap.institutions.map((i) => [i.id, i.name])), recurring: buildRecurring(txs, categoryMap(cats), [], new Map(), today),
  budgets: new Map(), goals: [], contributions: [], holdings: [], history: snap.balanceHistory, debtTerms: new Map(), planned: [],
  positions: snap.positions, activity: snap.investmentActivity, longTerm: DEFAULT_LONG_TERM,
};

{
  const a = answer("How are my investments doing?", base);
  console.log("   ", a.headline);
  yes("portfolio value", a.headline.includes("$92,750"));
  yes("up, with growth, after the money put in", /up \$7,\d\d\d from growth, after \$13,800 you put in/.test(a.headline));
  eq("basis", a.basis, "calculation");
  yes("method note", a.notes.some((n) => n.includes("Modified Dietz")));
  yes("two accounts", a.table!.rows.length === 2);
  yes("90 days honoured", answer("How did my portfolio do over the last 90 days?", base).headline.includes("the last 90 days"));
  yes("all time honoured", answer("What is my overall investment return?", base).headline.includes("all the history there is"));
  const nohist = answer("How are my investments doing?", { ...base, history: [] });
  yes("no history: value yes, movement refused", nohist.headline.includes("$92,750") && nohist.headline.includes("can't say how they've moved"));
  eq("no investment accounts: refuses", answer("How are my investments doing?", { ...base, accounts: base.accounts.filter((x) => x.kind !== "brokerage" && x.kind !== "retirement") }).answered, false);

  const al = answer("How are my investments split?", base);
  console.log("   ", al.headline);
  yes("allocation headline", al.headline.startsWith("54% of your $92,750 in investments is in U.S. stocks"));
  eq("four kinds", al.table!.rows.length, 4);
  yes("not advice", al.notes.some((n) => n.includes("isn't advice")));
  yes("largest company named", al.facts.some((f) => f.label === "Largest single company" && f.value.includes("Harborline")));
  eq("stocks vs bonds routes to allocation", answer("How much do I have in stocks versus bonds?", base).table!.columns[0], "Kind");

  const lt = answer("What could my investments be worth in 20 years?", base);
  console.log("   ", lt.headline);
  const mid = project(9_275_000, 115_000, 500, 20, 0).years[20].nominalCents;
  yes("recent pace and 5% and the exact figure", lt.headline.includes("grew 5% a year") && lt.headline.includes("$1,150 a month") && lt.headline.includes("$" + Math.round(mid / 100).toLocaleString("en-US")));
  yes("a projection, not a prediction", lt.basis === "projection" && lt.headline.includes("not a prediction"));
  yes("says defaults are defaults", lt.notes.some((n) => n.includes("defaults")));
  yes("years in the question win", answer("What will my investments be worth in 10 years?", base).headline.includes("in 10 years"));
  const custom = answer("How much will my retirement accounts have in 30 years?", { ...base, longTerm: { monthlyCents: 100_000, returnBps: 650, years: 25, targetCents: 200_000_000, inflationBps: 0 } });
  console.log("   ", custom.headline);
  yes("custom: 6.5%, $1,000 a month, 30 years asked", custom.headline.includes("6.5% a year") && custom.headline.includes("$1,000 a month") && custom.headline.includes("in 30 years"));
  yes("target line, no defaults note", custom.facts.some((f) => f.label.startsWith("Time to reach")) && !custom.notes.some((n) => n.includes("defaults")));
  eq("when can I retire routes to the plan", answer("When can I retire?", base).basis, "projection");
  yes("net worth still routes to net worth", answer("What's my net worth?", base).headline.startsWith("Your net worth is"));
  yes("how much are my investments worth is a portfolio question", answer("How much are my investments worth?", base).headline.startsWith("Your investments are worth"));
  yes("cash question is not an investment answer", !answer("Will I run low on cash in the next 30 days?", base).headline.includes("investments"));
  yes("bills question unaffected", answer("What bills are coming up?", base).headline.includes("expected in the next 30 days"));
  eq("gibberish still refused", answer("blorptastic", base).answered, false);
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
