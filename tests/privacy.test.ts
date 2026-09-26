import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { parseCsv } from "../src/lib/finance/csv";
import {
  GROUPS,
  SECRET_SETTING_KEYS,
  TABLES,
  buildExport,
  centsToDecimal,
  csvCell,
  exportFileName,
  exportableRows,
  formatBytes,
  inventory,
  transactionsCsv,
  undescribedTables,
  type TransactionLine,
} from "../src/lib/privacy";

let fails = 0;
const eq = (n: string, g: unknown, w: unknown) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  if (!ok) fails++;
  console.log((ok ? "ok   " : "FAIL ") + n + (ok ? "" : `  got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
};
const yes = (n: string, c: boolean) => eq(n, c, true);

// ---- every table the app creates is described (or the export would quietly miss it) --------------------------------
const dir = join(process.cwd(), "src-tauri/migrations");
const created = new Set<string>();
for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql"))) {
  for (const m of readFileSync(join(dir, f), "utf8").matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) created.add(m[1]);
}
yes("found the migration tables", created.size >= 24);
eq("every table a migration creates is described in TABLES", undescribedTables([...created]), []);
eq("and TABLES describes nothing that doesn't exist", Object.keys(TABLES).filter((t) => !created.has(t)), []);
yes("every table belongs to a known group", Object.values(TABLES).every((t) => GROUPS.some((g) => g.key === t.group)));
yes("every group has at least one table", GROUPS.every((g) => Object.values(TABLES).some((t) => t.group === g.key)));
eq("a new table nobody described is flagged", undescribedTables(["actions", "fin_new_thing"]), ["fin_new_thing"]);

// ---- inventory ---------------------------------------------------------------------------------------------------
const inv = inventory({ fin_src_accounts: 2, fin_src_transactions: 186, fin_goals: 1, contacts: 3, threads: 3, events: 40, settings: 4, stray_table: 999 });
eq("groups come in a fixed order", inv.map((g) => g.key), ["accounts", "choices", "desk", "activity", "settings"]);
eq("counts add up inside a group", inv.find((g) => g.key === "accounts")!.total, 188);
eq("a table with no rows counts as zero, not missing", inv.find((g) => g.key === "accounts")!.items.find((i) => i.table === "fin_src_balances")!.count, 0);
eq("the desk total", inv.find((g) => g.key === "desk")!.total, 6);
yes("a table the app doesn't describe is left out, not guessed at", !JSON.stringify(inv).includes("stray_table") && !JSON.stringify(inv).includes("999"));
eq("nothing stored yet", inventory({}).map((g) => g.total), [0, 0, 0, 0, 0]);

// ---- what an export contains -------------------------------------------------------------------------------------------
const settingsRows = [
  { key: "seat_token", value: "sk-live-abc123" },
  { key: "business_facts", value: '{"name":"Acme"}' },
  { key: "fin_preferences", value: "{}" },
];
eq("the seat token is filtered out of the settings", exportableRows("settings", settingsRows).map((r) => r.key), ["business_facts", "fin_preferences"]);
eq("other tables are untouched", exportableRows("fin_goals", [{ id: "g1" }]), [{ id: "g1" }]);
eq("only credentials are in the secret list", [...SECRET_SETTING_KEYS], ["seat_token"]);
const doc = buildExport({ settings: settingsRows, fin_goals: [{ id: "g1", target_cents: 100000 }], actions: [] }, { appVersion: "0.1.5", exportedAt: "2026-09-26T12:00:00.000Z" });
eq("it says what it is", [doc.app, doc.format, doc.appVersion, doc.exportedAt], ["ZeraphDesk", 1, "0.1.5", "2026-09-26T12:00:00.000Z"]);
eq("tables in a fixed order", Object.keys(doc.tables), ["actions", "fin_goals", "settings"]);
eq("amounts stay in cents, as stored", doc.tables.fin_goals[0].target_cents, 100000);
const text = JSON.stringify(doc);
yes("no seat token anywhere in the file", !text.includes("sk-live-abc123") && !text.includes("seat_token"));
yes("it tells the person it isn't encrypted", doc.notes.some((n) => /not encrypted/.test(n)));
yes("it tells the person where the passwords are", doc.notes.some((n) => /keychain/.test(n)));
yes("it's valid JSON that reads back the same", JSON.stringify(JSON.parse(text)) === text);
yes("an empty database still exports", Object.keys(buildExport({}, { appVersion: "x", exportedAt: "y" }).tables).length === 0);

// ---- money and cells ------------------------------------------------------------------------------------------------
for (const [c, want] of [[4510, "45.10"], [-4510, "-45.10"], [5, "0.05"], [-5, "-0.05"], [0, "0.00"], [100, "1.00"], [123456789, "1234567.89"], [-1, "-0.01"]] as [number, string][]) eq(`cents ${c}`, centsToDecimal(c), want);
eq("plain cell", csvCell("Coffee House"), "Coffee House");
eq("comma is quoted", csvCell("Smith, John"), '"Smith, John"');
eq("quotes are doubled", csvCell('The "Big" Store'), '"The ""Big"" Store"');
eq("newline is quoted", csvCell("a\nb"), '"a\nb"');
eq("a formula-looking merchant is defused", csvCell("=HYPERLINK(\"x\")"), '"\'=HYPERLINK(""x"")"');
eq("plus, minus and at are too", [csvCell("+1"), csvCell("-REFUND"), csvCell("@home")], ["'+1", "'-REFUND", "'@home"]);
eq("a number isn't touched", csvCell("-45.10", { text: false }), "-45.10");
eq("empty", csvCell(""), "");

// ---- the transactions file ---------------------------------------------------------------------------------------------
const lines: TransactionLine[] = [
  { date: "2026-09-03", account: "Everyday Checking", merchant: "Oakwood Rent", description: "OAKWOOD RENT", amountCents: -150000, category: "Housing", note: "", flagged: false },
  { date: "2026-09-04", account: "Everyday Checking", merchant: "Smith, Jones & Co", description: 'ACH "PAYMENT"', amountCents: 250000, category: "Income", note: "March invoice", flagged: true },
  { date: "2026-09-05", account: "Rewards Card", merchant: "=Evil()", description: "line1\nline2", amountCents: -1, category: "Other", note: "", flagged: false },
];
const csv = transactionsCsv(lines);
yes("starts with the header", csv.startsWith("Date,Account,Merchant,Description,Amount,Category,Note,Flagged\r\n"));
yes("ends with a line break, one row each", csv.endsWith("\r\n") && csv.split("\r\n").length === 5);
const back = parseCsv(csv);
eq("it reads back as a table: header plus three rows", [back.length, back[0].length], [4, 8]);
eq("a comma and quotes inside a cell survive the round trip", [back[2][2], back[2][3]], ["Smith, Jones & Co", 'ACH "PAYMENT"']);
eq("a newline inside a cell survives", back[3][3], "line1\nline2");
eq("amounts are plain decimals, money out negative", back.slice(1).map((r) => r[4]), ["-1500.00", "2500.00", "-0.01"]);
eq("the flag and note survive", [back[2][6], back[2][7], back[1][7]], ["March invoice", "yes", ""]);
eq("a formula-looking merchant is defused, not lost", back[3][2], "'=Evil()");
eq("no transactions still gives a header", transactionsCsv([]), "Date,Account,Merchant,Description,Amount,Category,Note,Flagged\r\n");

// ---- file names and sizes -------------------------------------------------------------------------------------------------
eq("file names", [exportFileName("everything", "2026-09-26"), exportFileName("transactions", "2026-09-26")], ["zeraphdesk-export-2026-09-26", "zeraphdesk-transactions-2026-09-26"]);
eq("sizes", [formatBytes(500), formatBytes(2048), formatBytes(3.2 * 1024 * 1024)], ["500 bytes", "2 KB", "3.2 MB"]);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
