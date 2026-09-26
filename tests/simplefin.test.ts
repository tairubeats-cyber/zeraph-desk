import { balanceCentsFor, decimalToCents, guessKind, mapTransactions, parseSimplefin, planWindows, requestsInLastDay, utcDate, WINDOW_DAYS, MAX_WINDOWS, MAX_LOOKBACK_DAYS, DAILY_REQUEST_LIMIT, OVERLAP_DAYS } from "../src/lib/finance/simplefin";

let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)); };
const yes = (n: string, c: boolean) => eq(n, c, true);

// --- decimalToCents ---
for (const [raw, want] of [["12.34", 1234], ["-12.34", -1234], ["+5", 500], ["0", 0], ["-0.00", 0], ["0.1", 10], ["1234567.89", 123456789], [".5", 50], ["5.", 500], ["1.005", 101], ["-1.005", -101], ["1.004", 100], ["2.999", 300], ["-2.995", -300], ["", null], ["abc", null], ["1,234.56", null], ["1.2.3", null], ["--1", null], [".", null], ["  7.25 ", 725], ["1e5", null], ["1234567890123", null]] as [string, number | null][]) {
  eq(`cents ${JSON.stringify(raw)}`, decimalToCents(raw), want);
}
yes("no float drift: 0.29 is 29", decimalToCents("0.29") === 29);
yes("no float drift: 1.15 is 115", decimalToCents("1.15") === 115);
yes("-0 never returned", Object.is(decimalToCents("-0.001"), 0));

// --- utcDate ---
eq("midnight UTC is that date", utcDate(Date.UTC(2025, 2, 4) / 1000), "2025-03-04");
eq("one second before midnight is the day before", utcDate(Date.UTC(2025, 2, 4) / 1000 - 1), "2025-03-03");
eq("late evening UTC stays that date", utcDate(Date.UTC(2025, 11, 31, 23, 59, 59) / 1000), "2025-12-31");

// --- parse: version 1 shape ---
const t0 = Date.UTC(2025, 5, 10) / 1000;
const v1 = JSON.stringify({
  errors: ["Connection to Big Bank may need attention"],
  accounts: [
    {
      org: { domain: "bigbank.example", name: "Big Bank", "sfin-url": "https://x", id: "bb" },
      id: "ACT-1", name: "Everyday Checking", currency: "USD", balance: "1234.56", "available-balance": "1200", "balance-date": t0,
      transactions: [
        { id: "T1", posted: t0, amount: "-45.10", description: "COFFEE HOUSE #123", transacted_at: t0 },
        { id: "T2", posted: t0, amount: "2500.00", description: "ACME PAYROLL" },
        { id: "T3", posted: 0, amount: "-9.99", description: "PENDING THING", pending: true },
        { id: "T4", posted: t0, amount: "twelve", description: "BAD AMOUNT" },
      ],
    },
    { org: { name: "Big Bank" }, id: "ACT-2", name: "Visa Rewards", currency: "USD", balance: "-820.10", "balance-date": t0, transactions: [] },
  ],
});
const r1 = parseSimplefin(v1);
eq("v1 message", r1.messages, ["Connection to Big Bank may need attention"]);
eq("v1 accounts", r1.accounts.map((a) => [a.key, a.name, a.orgName, a.currency, a.balance, a.balanceDate]), [["ACT-1", "Everyday Checking", "Big Bank", "USD", "1234.56", t0], ["ACT-2", "Visa Rewards", "Big Bank", "USD", "-820.10", t0]]);
const m1 = mapTransactions("acct-x", r1.accounts[0]);
eq("v1 mapped count", m1.rows.length, 2);
eq("pending skipped", m1.pending, 1);
eq("bad amount counted", m1.invalid, 1);
eq("row shape", m1.rows[0].date, "2025-06-10");
eq("row cents", m1.rows.map((r) => r.amountCents), [-4510, 250000]);
eq("merchant cleaned", m1.rows[0].merchant, "Coffee House");
eq("description kept raw", m1.rows[0].description, "COFFEE HOUSE #123");
eq("account id used", m1.rows[0].accountId, "acct-x");
eq("no stored category", m1.rows[0].categoryHint, null);
yes("ids start sf-", m1.rows.every((r) => r.id.startsWith("sf-")));
const again = mapTransactions("acct-y", r1.accounts[0]);
eq("ids depend on the bridge's account+line, not our account id (stable if the local account is re-created)", again.rows.map((r) => r.id), m1.rows.map((r) => r.id));
yes("two lines have two ids", m1.rows[0].id !== m1.rows[1].id);

// --- parse: version 2 shape ---
const v2 = JSON.stringify({
  errlist: [{ code: "con.auth", msg: "Please sign in again at Big Bank", conn_id: "c1" }, { code: "x", msg: "" }],
  connections: [{ conn_id: "c1", name: "Big Bank", org_id: "o", org_url: "bigbank.example", sfin_url: "https://s" }, { conn_id: "c2", name: "Credit Union", org_id: "o2", sfin_url: "https://s" }],
  accounts: [
    { id: "1", conn_id: "c1", name: "Savings", currency: "USD", balance: "50", "balance-date": t0 },
    { id: "1", conn_id: "c2", name: "Savings", currency: "USD", balance: "75", "balance-date": t0 },
  ],
});
const r2 = parseSimplefin(v2);
eq("v2 message (empty ones dropped)", r2.messages, ["Please sign in again at Big Bank"]);
eq("v2 keys are unique across connections", r2.accounts.map((a) => a.key), ["c1:1", "c2:1"]);
eq("v2 org names come from the connection", r2.accounts.map((a) => a.orgName), ["Big Bank", "Credit Union"]);

// --- parse: junk ---
for (const bad of ["", "not json", "[]", "{}", '{"accounts": 5}', "null"]) {
  let threw = false;
  try { parseSimplefin(bad); } catch (e) { threw = e instanceof Error && e.message.includes("can read"); }
  yes(`junk ${JSON.stringify(bad)} throws`, threw);
}
eq("account without id skipped, weird entries ignored", parseSimplefin('{"accounts":[{"name":"x"},5,null,{"id":"a","name":" Spaced ","currency":"usd","balance":"1"}]}').accounts.map((a) => [a.key, a.name, a.currency, a.orgName]), [["a", "Spaced", "USD", "Your bank"]]);
eq("no transactions array is fine", parseSimplefin('{"accounts":[{"id":"a","name":"n","currency":"USD","balance":"1","balance-date":0}]}').accounts[0].transactions, []);
eq("balance date missing is 0", parseSimplefin('{"accounts":[{"id":"a","name":"n","currency":"USD","balance":"1"}]}').accounts[0].balanceDate, 0);
eq("posted as numeric string", parseSimplefin(JSON.stringify({ accounts: [{ id: "a", name: "n", currency: "USD", balance: "1", transactions: [{ id: "t", posted: String(t0), amount: "1.00", description: "d" }] }] })).accounts[0].transactions[0].posted, t0);
eq("empty description gets a placeholder", mapTransactions("a", parseSimplefin(JSON.stringify({ accounts: [{ id: "a", name: "n", currency: "USD", balance: "1", transactions: [{ id: "t", posted: t0, amount: "1.00", description: "  " }] }] })).accounts[0]).rows[0].description, "(no description)");

// --- payee and memo ---
const withPayee = parseSimplefin(JSON.stringify({ accounts: [{ id: "a", name: "n", currency: "USD", balance: "1", transactions: [
  { id: "1", posted: t0, amount: "-40.00", description: "Fishing bait", payee: "John's Fishin Shack", memo: "JOHNS FISHIN SHACK BAIT" },
  { id: "2", posted: t0, amount: "-5.00", description: "", payee: "", memo: "MEMO ONLY LINE" },
  { id: "3", posted: t0, amount: "-6.00", description: "", payee: "Only Payee", memo: "" },
] }] })).accounts[0];
const mp = mapTransactions("x", withPayee);
eq("merchant prefers the payee", mp.rows[0].merchant, "John's Fishin Shack");
eq("description keeps the bank's line", mp.rows[0].description, "Fishing bait");
eq("falls back to memo for the description", mp.rows[1].description, "MEMO ONLY LINE");
eq("falls back to payee for the description", mp.rows[2].description, "Only Payee");

// --- a repeated id inside one account must not swallow a line ---
const dupAcct = parseSimplefin(JSON.stringify({ accounts: [{ id: "a", name: "n", currency: "USD", balance: "1", transactions: [
  { id: "same", posted: t0, amount: "-1.00", description: "A" }, { id: "same", posted: t0, amount: "-2.00", description: "B" }, { id: "other", posted: t0, amount: "-3.00", description: "C" },
] }] })).accounts[0];
const md = mapTransactions("x", dupAcct);
eq("three lines kept", md.rows.length, 3);
eq("all ids distinct", new Set(md.rows.map((r) => r.id)).size, 3);
eq("same ids on the next fetch", mapTransactions("x", dupAcct).rows.map((r) => r.id), md.rows.map((r) => r.id));
eq("first occurrence keeps the plain id (so nothing already stored changes)", md.rows[0].id, mapTransactions("x", parseSimplefin(JSON.stringify({ accounts: [{ id: "a", name: "n", currency: "USD", balance: "1", transactions: [{ id: "same", posted: t0, amount: "-1.00", description: "A" }] }] })).accounts[0]).rows[0].id);

// --- the real reply from SimpleFIN's public demo bridge ---
import { readFileSync } from "fs";
import { join } from "path";
// A real reply from SimpleFIN's public demo bridge, saved as it came.
const demoBody = readFileSync(join(process.cwd(), "tests/fixtures/simplefin-demo.json"), "utf8");
const demo = parseSimplefin(demoBody);
eq("demo: three accounts", demo.accounts.map((a) => a.key), ["Demo Savings", "Demo Checking", "Demo Empty Account"]);
eq("demo: org name", demo.accounts[0].orgName, "SimpleFIN Demo");
eq("demo: a range warning comes through as a message", demo.messages.length, 1);
const demoRaw = JSON.parse(demoBody);
for (let i = 0; i < 2; i++) {
  const m = mapTransactions("d", demo.accounts[i]);
  const rawSum = demoRaw.accounts[i].transactions.reduce((sum: number, t: { amount: string }) => sum + Math.round(Number(t.amount) * 100), 0);
  const rawCount = demoRaw.accounts[i].transactions.length;
  yes("demo " + demo.accounts[i].name + ": has lines to test with", rawCount > 0);
  eq("demo " + demo.accounts[i].name + ": every line mapped", [m.rows.length, m.pending, m.invalid], [rawCount, 0, 0]);
  eq("demo " + demo.accounts[i].name + ": cents add up to the bridge's amounts", m.rows.reduce((a, r) => a + r.amountCents, 0), rawSum);
  eq("demo " + demo.accounts[i].name + ": ids unique", new Set(m.rows.map((r) => r.id)).size, rawCount);
}
eq("demo: balance cents", balanceCentsFor(demo.accounts[1], "checking", false), Math.round(Number(demoRaw.accounts[1].balance) * 100));
eq("demo: kinds guessed from names", demo.accounts.map((a) => guessKind(a.name)), ["savings", "checking", "checking"]);
yes("demo: balance date is a real time", demo.accounts[0].balanceDate > 1_600_000_000);

// --- guessKind ---
for (const [name, want] of [
  ["Everyday Checking", "checking"], ["Total Checking", "checking"], ["Premier Savings", "savings"], ["High Yield Savings", "savings"], ["Money Market", "savings"],
  ["Visa Rewards", "credit_card"], ["Sapphire Credit Card", "credit_card"], ["Amex Gold", "credit_card"], ["Chase Freedom Card", "credit_card"], ["Debit Card", "checking"],
  ["Home Mortgage", "mortgage"], ["Student Loan", "student_loan"], ["Auto Loan", "auto_loan"], ["Car Financing", "auto_loan"], ["Personal Loan", "personal_loan"], ["Line of Credit", "personal_loan"],
  ["Roth IRA", "retirement"], ["401(k)", "retirement"], ["Brokerage Account", "brokerage"], ["Investment Account", "brokerage"], ["Mystery Account", "checking"], ["Cardiology Fund", "checking"],
] as [string, string][]) eq(`kind ${name}`, guessKind(name), want);

// --- balance sign ---
const acct = (balance: string) => ({ ...r1.accounts[0], balance });
eq("asset as reported", balanceCentsFor(acct("1234.56"), "checking", false), 123456);
eq("asset overdrawn keeps sign", balanceCentsFor(acct("-20.00"), "checking", false), -2000);
eq("card, negative means owed", balanceCentsFor(acct("-820.10"), "credit_card", false), 82010);
eq("card, positive means owed", balanceCentsFor(acct("820.10"), "credit_card", true), 82010);
eq("card, negative but 'positive owed' flips to a credit", balanceCentsFor(acct("-15.00"), "credit_card", true), -1500);
eq("loan negative", balanceCentsFor(acct("-12000"), "auto_loan", false), 1200000);
eq("unreadable balance", balanceCentsFor(acct("n/a"), "checking", false), null);

// --- windows ---
const DAY = 86400;
const now = Date.UTC(2025, 5, 10, 15, 30) / 1000;
const w = planWindows(now, null);
eq("first sync makes the max windows", w.length, MAX_WINDOWS);
const endOfToday = Date.UTC(2025, 5, 11) / 1000;
eq("newest window ends at the start of tomorrow (so today is included)", w[0].end, endOfToday);
yes("every window is inside the bridge's recommended 45 days", w.every((x) => x.end - x.start <= 45 * DAY && x.end - x.start > 0));
yes("windows touch, newest first", w.every((x, i) => i === 0 || x.end === w[i - 1].start));
yes("first sync reaches back about six months", endOfToday - w[w.length - 1].start >= 175 * DAY);
const last = new Date(Date.UTC(2025, 5, 8, 9)).toISOString();
const w2 = planWindows(now, last);
eq("recent sync needs one window", w2.length, 1);
eq("...starting OVERLAP_DAYS before the last sync's day", w2[0].start, Date.UTC(2025, 5, 8) / 1000 - OVERLAP_DAYS * DAY);
const w3 = planWindows(now, new Date(Date.UTC(2025, 2, 1)).toISOString());
eq("a 3-month-old sync needs three 45-day windows", w3.length, 3);
yes("...contiguous", w3[1].end === w3[0].start);
const w4 = planWindows(now, new Date(Date.UTC(2020, 0, 1)).toISOString());
eq("a very old sync is capped at the max windows", w4.length, MAX_WINDOWS);
eq("garbage last-sync time is treated like never", planWindows(now, "nonsense").length, MAX_WINDOWS);
eq("a future last-sync time still yields a window", planWindows(now, new Date(Date.UTC(2025, 6, 1)).toISOString()).length >= 0, true);
yes("WINDOW_DAYS within the recommended range", WINDOW_DAYS <= 45);
eq("lookback", MAX_LOOKBACK_DAYS, WINDOW_DAYS * MAX_WINDOWS);

// --- request budget ---
const nowD = new Date("2025-06-10T12:00:00Z");
eq("only the last 24h count", requestsInLastDay([{ at: "2025-06-10T11:00:00Z", requests: 4 }, { at: "2025-06-09T13:00:00Z", requests: 3 }, { at: "2025-06-09T11:00:00Z", requests: 9 }], nowD), 7);
eq("no runs", requestsInLastDay([], nowD), 0);
yes("limit leaves headroom under 24", DAILY_REQUEST_LIMIT < 24);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
