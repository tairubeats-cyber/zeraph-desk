import { assignIds, cleanMerchant, detectColumns, detectDateOrder, guessCategory, hashText, interpretRows, looksLikeHeader, parseAmount, parseCsv, parseDate, EMPTY_MAP } from "../src/lib/finance/csv";

let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)); };
const yes = (n: string, c: boolean) => eq(n, c, true);

// --- parseCsv ---
eq("simple", parseCsv("a,b,c\n1,2,3\n"), [["a", "b", "c"], ["1", "2", "3"]]);
eq("CRLF and no trailing newline", parseCsv("a,b\r\n1,2"), [["a", "b"], ["1", "2"]]);
eq("quoted comma and doubled quote", parseCsv('d,desc\n1,"ACME, INC ""HQ"""\n'), [["d", "desc"], ["1", 'ACME, INC "HQ"']]);
eq("newline inside quotes stays in the cell", parseCsv('a,b\n1,"line1\nline2"\n'), [["a", "b"], ["1", "line1\nline2"]]);
eq("BOM removed", parseCsv("\uFEFFDate,Amount\n2025-01-01,5\n")[0], ["Date", "Amount"]);
eq("semicolon delimiter", parseCsv("Date;Amount\n01.02.2025;5,50\n"), [["Date", "Amount"], ["01.02.2025", "5,50"]]);
eq("tab delimiter", parseCsv("Date\tAmount\n2025-01-01\t5\n"), [["Date", "Amount"], ["2025-01-01", "5"]]);
eq("blank lines dropped", parseCsv("a,b\n\n1,2\n\n"), [["a", "b"], ["1", "2"]]);
eq("empty cells kept", parseCsv("a,b,c\n1,,3\n"), [["a", "b", "c"], ["1", "", "3"]]);
eq("empty file", parseCsv(""), []);
eq("comma inside quotes on the header line doesn't fool delimiter detection", parseCsv('"Name, full";Amount\nx;1\n')[0], ["Name, full", "Amount"]);

// --- parseAmount ---
for (const [raw, want] of [["12.34", 1234], ["-12.34", -1234], ["$1,234.56", 123456], ["(12.34)", -1234], ["12.34-", -1234], ["-$5", -500], ["+5.5", 550], ["1.234,56", 123456], ["5,50", 550], ["0", 0], ["12.34DR", -1234], ["12.34CR", 1234], ["−7.00", -700], ["1,000", 100000], [".5", 50], ["", null], ["abc", null], ["12.3.4", null], ["--5", null], ["N/A", null]] as [string, number | null][]) {
  eq(`amount ${JSON.stringify(raw)}`, parseAmount(raw), want);
}
eq("floating point: 0.1 + 0.2 style values round to cents", parseAmount("1.005"), 101 === 101 ? Math.round(1.005 * 100) : 0);

// --- dates ---
eq("iso", parseDate("2025-03-04", "ymd"), "2025-03-04");
eq("iso with slashes and no zero pad", parseDate("2025/3/4", "mdy"), "2025-03-04");
eq("mdy", parseDate("03/04/2025", "mdy"), "2025-03-04");
eq("dmy", parseDate("03/04/2025", "dmy"), "2025-04-03");
eq("two-digit year", parseDate("3/4/25", "mdy"), "2025-03-04");
eq("impossible day rejected", parseDate("02/30/2025", "mdy"), null);
eq("month 13 rejected in mdy", parseDate("13/01/2025", "mdy"), null);
eq("same value fine in dmy", parseDate("13/01/2025", "dmy"), "2025-01-13");
eq("leap day ok in 2024", parseDate("2024-02-29", "ymd"), "2024-02-29");
eq("leap day rejected in 2025", parseDate("2025-02-29", "ymd"), null);
eq("time of day ignored", parseDate("2025-03-04 14:22:01", "ymd"), "2025-03-04");
eq("garbage", parseDate("yesterday", "mdy"), null);
eq("detect: iso", detectDateOrder(["2025-03-04", "2025-03-05"]), "ymd");
eq("detect: month first proven by 25", detectDateOrder(["03/04/2025", "03/25/2025"]), "mdy");
eq("detect: day first proven by 25", detectDateOrder(["03/04/2025", "25/03/2025"]), "dmy");
eq("detect: ambiguous when every date fits both", detectDateOrder(["03/04/2025", "05/06/2025"]), "ambiguous");
eq("detect: unreadable", detectDateOrder(["hello", "world"]), "unreadable");
eq("detect: conflicting evidence stays ambiguous", detectDateOrder(["13/01/2025", "01/13/2025"]), "ambiguous");

// --- columns ---
eq("bank A headings", detectColumns(["Date", "Description", "Amount", "Balance"]), { ...EMPTY_MAP, date: 0, description: 1, amount: 2, balance: 3 });
eq("bank B headings (debit/credit)", detectColumns(["Posting Date", "Details", "Debit", "Credit", "Running Balance"]), { ...EMPTY_MAP, date: 0, description: 1, debit: 2, credit: 3, balance: 4 });
eq("Transaction Date isn't a description", detectColumns(["Transaction Date", "Post Date", "Description", "Category", "Type", "Amount"]).date, 0);
eq("category column found", detectColumns(["Transaction Date", "Post Date", "Description", "Category", "Type", "Amount"]).category, 3);
eq("amount wins over debit/credit", detectColumns(["Date", "Memo", "Amount", "Debit"]).debit, null);
eq("unknown headings stay empty", detectColumns(["Foo", "Bar"]), EMPTY_MAP);
eq("header row detected", looksLikeHeader(["Date", "Description", "Amount"]), true);
eq("data row is not a header", looksLikeHeader(["2025-01-02", "COFFEE", "-4.50"]), false);

// --- interpretRows ---
const bankA = parseCsv("Date,Description,Amount,Balance\n2025-03-01,PAYROLL DIRECT DEP,2400.00,3000.00\n2025-03-02,COFFEE SHOP #1234,-4.50,2995.50\n2025-03-02,COFFEE SHOP #1234,-4.50,2991.00\n2025-03-05,\"RENT, MAPLE COURT\",-1850.00,1141.00\nbad,ROW,1,1\n2025-03-06,NOTHING,abc,1\n");
const mapA = detectColumns(bankA[0]);
const a = interpretRows(bankA, true, mapA, { order: "ymd", outIsNegative: true });
eq("4 good rows", a.rows.length, 4);
eq("2 bad rows reported with line numbers", a.invalid.map((x) => x.line), [6, 7]);
yes("bad date message names the value", a.invalid[0].reason.includes("bad"));
eq("amounts keep sign", a.rows.map((r) => r.amountCents), [240000, -450, -450, -185000]);
eq("balance column: last balance per day (oldest-first file)", [...a.balancesByDate.entries()], [["2025-03-01", 300000], ["2025-03-02", 299100], ["2025-03-05", 114100]]);
eq("latest balance", a.latestBalance, { date: "2025-03-05", cents: 114100 });
eq("merchant cleaned", a.rows[1].merchant, "Coffee Shop");
eq("categories guessed", a.rows.map((r) => r.categoryHint), ["income", "dining", "dining", "housing"]);
eq("line numbers count the header", a.rows[0].line, 2);

// newest-first file: the FIRST row of a day is its last transaction
const newest = parseCsv("Date,Description,Amount,Balance\n2025-03-02,B,-4.50,2991.00\n2025-03-02,A,-4.50,2995.50\n2025-03-01,PAY,2400,3000\n");
const n = interpretRows(newest, true, detectColumns(newest[0]), { order: "ymd", outIsNegative: true });
eq("newest-first: day's balance is the first row's", n.balancesByDate.get("2025-03-02"), 299100);
eq("newest-first: latest", n.latestBalance, { date: "2025-03-02", cents: 299100 });

// card exports: purchases positive
const card = parseCsv("Trans. Date,Description,Amount\n03/04/2025,AMAZON MKTPLACE,25.00\n03/10/2025,PAYMENT THANK YOU,-100.00\n");
const c = interpretRows(card, true, detectColumns(card[0]), { order: "mdy", outIsNegative: false });
eq("outIsNegative=false flips signs: purchase is money out", c.rows.map((r) => r.amountCents), [-2500, 10000]);
eq("card categories", c.rows.map((r) => r.categoryHint), ["shopping", "transfers"]);

// debit / credit columns
const dc = parseCsv("Date,Details,Debit,Credit\n2025-03-01,ATM,40.00,\n2025-03-02,REFUND,,12.50\n2025-03-03,ODD,,\n");
const d = interpretRows(dc, true, detectColumns(dc[0]), { order: "ymd", outIsNegative: true });
eq("debit is out, credit is in", d.rows.map((r) => r.amountCents), [-4000, 1250]);
eq("row with neither column is reported", d.invalid.map((x) => x.line), [4]);
const negDebit = parseCsv("Date,Details,Debit,Credit\n2025-03-01,ATM,-40.00,\n");
eq("a debit written negative still means money out", interpretRows(negDebit, true, detectColumns(negDebit[0]), { order: "ymd", outIsNegative: true }).rows[0].amountCents, -4000);

// no header row
const nh = parseCsv("2025-03-01,COFFEE,-3.00\n");
eq("no header: first row is data", interpretRows(nh, false, { ...EMPTY_MAP, date: 0, description: 1, amount: 2 }, { order: "ymd", outIsNegative: true }).rows.length, 1);
eq("no date column chosen: every row reported", interpretRows(nh, false, { ...EMPTY_MAP, description: 1, amount: 2 }, { order: "ymd", outIsNegative: true }).invalid.length, 1);
// file's own categories map to ours, others ignored
const cat = parseCsv("Date,Description,Category,Amount\n2025-03-01,X,Groceries,-5\n2025-03-01,Y,Weird Thing,-5\n");
const known = new Map([["groceries", "food"]]);
eq("category column: known maps, unknown falls back to guess", interpretRows(cat, true, detectColumns(cat[0]), { order: "ymd", outIsNegative: true, knownCategories: known }).rows.map((r) => r.categoryHint), ["food", null]);

// --- categories and merchants ---
for (const [desc, amt, want] of [["NETFLIX.COM", -1599, "subscriptions"], ["SHELL OIL 57444", -4000, "transportation"], ["UBER EATS ORDER", -2500, "dining"], ["UBER TRIP", -1500, "transportation"], ["WHOLE FOODS MKT", -6000, "food"], ["STATE FARM INSURANCE", -12000, "insurance"], ["ONLINE TRANSFER TO SAVINGS", -50000, "transfers"], ["VANGUARD BUY", -50000, "investments"], ["ACME CORP PAYROLL", 300000, "income"], ["CVS PHARMACY", -1200, "healthcare"], ["HARBOR ELECTRIC", -9000, "utilities"], ["RANDOM SHOP", -500, null], ["MYSTERY DEPOSIT", 500, "income"], ["AMAZON REFUND", 2500, "shopping"], ["MAPLE COURT APARTMENTS RENT", -185000, "housing"]] as [string, number, string | null][]) {
  eq(`category: ${desc}`, guessCategory(desc, amt), want);
}
for (const [raw, want] of [["POS PURCHASE STARBUCKS #12345 SEATTLE WA", "Starbucks"], ["SHELL OIL 57444", "Shell Oil"], ["Blue Door Coffee", "Blue Door Coffee"], ["AMZN Mktp US*2K4 09/25", "AMZN Mktp US*2K4"], ["   ", ""], ["CHECKCARD 0925 TARGET", "0925 Target"]] as [string, string][]) {
  eq(`merchant: ${JSON.stringify(raw)}`, cleanMerchant(raw), want);
}

// --- ids ---
const rows2 = interpretRows(parseCsv("Date,Description,Amount\n2025-03-02,COFFEE,-4.50\n2025-03-02,COFFEE,-4.50\n2025-03-03,COFFEE,-4.50\n"), true, { ...EMPTY_MAP, date: 0, description: 1, amount: 2 }, { order: "ymd", outIsNegative: true }).rows;
const ids = assignIds("acct-1", rows2).map((x) => x.id);
eq("identical purchases on one day get different ids", new Set(ids).size, 3);
eq("same file again: same ids", assignIds("acct-1", rows2).map((x) => x.id), ids);
eq("different account: different ids", assignIds("acct-2", rows2).map((x) => x.id).some((id, i) => id === ids[i]), false);
eq("a row present in a later, overlapping file keeps its id", assignIds("acct-1", rows2.slice(0, 1))[0].id, ids[0]);
eq("hash is stable and 14 hex chars", [hashText("abc") === hashText("abc"), hashText("abc").length, /^[0-9a-f]+$/.test(hashText("abc"))], [true, 14, true]);
eq("hash differs on a one-character change", hashText("abc") === hashText("abd"), false);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
