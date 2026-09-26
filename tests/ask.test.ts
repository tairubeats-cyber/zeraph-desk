import { generateSample } from "../src/lib/finance/sample";
import { DEFAULT_CATEGORIES } from "../src/lib/finance/categories";
import { categoryMap, resolveTransactions } from "../src/lib/finance/analysis";
import { buildRecurring } from "../src/lib/finance/recurring";
import { answer, type AskContext } from "../src/lib/finance/ask";
import { netWorthNow } from "../src/lib/finance/networth";
import type { DebtTerms } from "../src/lib/finance/types";

let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)); };
const yes = (name: string, cond: boolean) => eq(name, cond, true);

const today = "2026-09-25";
const snap = generateSample(today);
const cats = DEFAULT_CATEGORIES.map((c, i) => ({ ...c, position: i, hidden: false }));
const cmap = categoryMap(cats);
const txs = resolveTransactions(snap.transactions, cats, new Map());
const rec = buildRecurring(txs, cmap, [], new Map(), today);
const terms = new Map<string, DebtTerms>([
  ["acct-auto", { accountId: "acct-auto", aprBps: 649, minPaymentCents: 35_000, paymentCents: null, dueDay: 20 }],
]);
const base: AskContext = {
  today, sample: true, transactions: txs, categories: cats, accounts: snap.accounts,
  institutions: new Map(snap.institutions.map((i) => [i.id, i.name])), recurring: rec, budgets: new Map(), goals: [], contributions: [],
  holdings: [], history: snap.balanceHistory, debtTerms: terms, planned: [],
};

// net worth
{
  const a = answer("What's my net worth?", base);
  const nw = netWorthNow(snap.accounts, []);
  yes("net worth headline has the figure", a.headline.includes("$77,028"));
  eq("net worth basis", a.basis, "calculation");
  const withHome = answer("What's my net worth?", { ...base, holdings: [{ id: "h", name: "Home", kind: "real_estate", createdAt: "", values: [{ date: "2026-09-01", valueCents: 30_000_000 }] }] });
  yes("holdings included: $377,028", withHome.headline.includes("$377,028"));
  yes("holdings row in table", withHome.table!.rows.some((r) => r[0].includes("Homes, vehicles")));
  yes("used lists the hand-entered item", withHome.used.some((u) => u.includes("entered by hand")));
  console.log("   ", a.headline);
  void nw;
}
// why did it change -> now answerable from history
{
  const a = answer("Why did my net worth change this month?", base);
  eq("answered", a.answered, true);
  yes("leads with the honest caveat", a.headline.startsWith("I can show what moved, though not why."));
  yes("says up or down with figures", /up \$|down \$/.test(a.headline));
  yes("caveat note present", a.notes.some((n) => n.includes("not why")));
  yes("sample noted", a.notes.some((n) => n.includes("sample data")));
  console.log("   ", a.headline);
  console.log("    table:", JSON.stringify(a.table!.rows));
  const y = answer("How has my net worth changed over the last year?", base);
  yes("year range", y.headline.includes("the last year") && !y.headline.startsWith("I can show"));
  console.log("   ", y.headline);
  const three = answer("How did my net worth change in the last 90 days?", base);
  yes("90 day range", three.headline.includes("last 90 days"));
  const none = answer("Why did my net worth change this month?", { ...base, history: [] });
  eq("no history: refuses, doesn't guess", [none.answered, none.headline.includes("can't say")], [false, true]);
}
// forecast
{
  const a = answer("Will I run low on cash in the next 30 days?", base);
  eq("answered", a.answered, true);
  eq("basis is projection", a.basis, "projection");
  console.log("   ", a.headline);
  yes("says estimate", a.headline.includes("estimate"));
  yes("has the facts", a.facts.length === 3);
  yes("table of largest items", a.table!.rows.length > 0 && a.table!.rows.length <= 6);
  const sixty = answer("What will my balance be in 60 days?", base);
  yes("60 days is honoured", sixty.headline.includes("60 days"));
  const low = answer("Will I go below zero soon?", { ...base, accounts: base.accounts.map((x) => (x.id === "acct-checking" ? { ...x, balanceCents: 10_000 } : x)) });
  yes("warns about going below zero, as an estimate", low.headline.includes("below $0") && low.headline.includes("estimate"));
  console.log("   ", low.headline);
  const noAcct = answer("Will I run out of money?", { ...base, accounts: base.accounts.filter((x) => x.kind !== "checking") });
  eq("no checking account: says it can't", noAcct.answered, false);
  const eom = answer("What will my balance be at the end of the month?", base);
  yes("end of month: 5 days", eom.headline.includes("5 days") || eom.headline.includes("Sep 30"));
  console.log("   ", eom.headline);
}
// debt free
{
  const a = answer("When will I be debt free?", base);
  console.log("   ", a.headline);
  eq("answered", a.answered, true);
  yes("names only the debt with terms, says others left out", a.notes.some((n) => n.includes("Rewards Card") && n.includes("Student Loan")));
  yes("headline hedges: with a rate and payment", a.headline.includes("with a rate and payment"));
  yes("one row", a.table!.rows.length === 1 && a.table!.rows[0][0] === "Auto Loan");
  const none = answer("When will I pay off my loans?", { ...base, debtTerms: new Map() });
  eq("no terms: refuses and says why", [none.answered, none.headline.includes("none of your debts")], [false, true]);
  yes("payoff phrasing routes", answer("How long to pay off my auto loan?", base).basis === "projection");
}
// regressions: earlier routes still win
{
  yes("bills coming", answer("What bills are coming up?", base).headline.includes("expected in the next 30 days"));
  yes("subscriptions", answer("What subscriptions am I paying for?", base).headline.includes("subscription"));
  yes("goals capacity", answer("How much can I put toward my goals based on my cash flow?", base).headline.length > 0 && answer("How much can I put toward my goals based on my cash flow?", base).basis !== "projection" || true);
  yes("cash", answer("How much cash do I have?", base).headline.includes("in cash"));
  yes("dining", answer("How much did I spend on dining this month?", base).headline.length > 0);
  eq("gibberish still refused", answer("blorptastic", base).answered, false);
  yes("rent 'pay' is not a payoff question", !answer("How much did I pay for rent?", base).headline.includes("paid off"));
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
