import { generateSample } from "../src/lib/finance/sample";
import { DEFAULT_CATEGORIES } from "../src/lib/finance/categories";
import { categoryMap, resolveTransactions } from "../src/lib/finance/analysis";
import { buildRecurring } from "../src/lib/finance/recurring";
import { buildForecast, everydayDailyCents, spendingAccounts } from "../src/lib/finance/forecast";

let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)); };

const today = "2026-09-25";
const snap = generateSample(today);
const cats = DEFAULT_CATEGORIES.map((c, i) => ({ ...c, position: i, hidden: false }));
const cmap = categoryMap(cats);
const txs = resolveTransactions(snap.transactions, cats, new Map());
const rec = buildRecurring(txs, cmap, [], new Map(), today);
console.log("recurring:");
for (const r of rec) console.log("  ", r.merchant.padEnd(24), r.direction, r.frequency.padEnd(12), (r.amountCents / 100).toFixed(2).padStart(9), "next", r.nextDate, "acct", txs.find((t) => t.id === r.txIds[0])?.accountId, r.possiblyStopped ? "STOPPED" : "");

const scope = new Set(spendingAccounts(snap.accounts).map((a) => a.id));
eq("scope is checking only in the sample", [...scope], ["acct-checking"]);
const daily = everydayDailyCents(txs, cmap, rec, scope, today);
console.log("everyday", daily, "=> per month", (daily.dailyCents * 30.4) / 100);

// independent check of the everyday figure: expense-kind checking txs in Jun/Jul/Aug, minus recurring ones
{
  const months = ["2026-06", "2026-07", "2026-08"];
  const recOut = new Set(rec.filter((r) => r.direction === "out").map((r) => r.key));
  const key = (t: { merchant: string; description: string; amountCents: number }) => t.merchant + "|" + t.description.toUpperCase().replace(/[#\d]+/g, " ").replace(/[^A-Z& ]/g, " ").replace(/\s+/g, " ").trim() + "|" + (t.amountCents > 0 ? "in" : "out");
  let sum = 0;
  for (const t of txs) if (months.includes(t.date.slice(0, 7)) && t.accountId === "acct-checking" && cmap.get(t.categoryId)!.kind === "expense" && !recOut.has(key(t))) sum -= t.amountCents;
  const daysInThree = 30 + 31 + 31;
  eq("everyday matches an independent sum", daily.dailyCents, Math.round(sum / daysInThree));
}

for (const includeEveryday of [false, true]) {
  const f = buildForecast({ today, days: 60, accounts: snap.accounts, transactions: txs, categories: cmap, recurring: rec, planned: [], includeEveryday })!;
  console.log(`\n--- 60 days, everyday=${includeEveryday}: start ${f.startCents / 100} end ${f.endCents / 100} lowest ${f.lowest.balanceCents / 100} on ${f.lowest.date} below0 ${f.firstBelowZero}`);
  for (const e of f.events) console.log("   ", e.date, e.kind.padEnd(12), e.label.padEnd(26), (e.amountCents / 100).toFixed(2).padStart(10), e.variable ? "~" : "");
  console.log("   notes:", f.notes);
  console.log("   totals:", Object.fromEntries(Object.entries(f.totals).map(([k, v]) => [k, v / 100])), "everyday", f.everydayCents / 100);
  const sum = f.events.reduce((s, e) => s + e.amountCents, 0);
  eq(`end = start + events - everyday (${includeEveryday})`, f.endCents, f.startCents + sum - f.everydayCents);
  eq("points span the days", f.points.length, 61);
  eq("first point is today", f.points[0].date, today);
  eq("no card-charged item listed on its own", f.events.some((e) => ["Pulse Fitness", "Spotify", "Netflix"].includes(e.label)), false);
  eq("card payment IS listed", f.events.some((e) => e.label === "Harbor Bank Card"), true);
  eq("savings interest (in savings) is not in a checking forecast", f.events.some((e) => e.label === "Harbor Bank"), false);
  eq("events sorted", f.events.every((e, i) => i === 0 || e.date >= f.events[i - 1].date), true);
  eq("all events inside the window", f.events.every((e) => e.date >= today && e.date <= "2026-11-24"), true);
  const rentCount = f.events.filter((e) => e.label === "Maple Court Apartments").length;
  eq("rent: Oct 1 and Nov 1 in 60 days", rentCount, 2);
  const pay = f.events.filter((e) => e.label === "Brightline Payroll").map((e) => e.date);
  console.log("   paydays", pay);
  eq("paydays twice a month (Oct 1, 15, Nov 1, 15)", pay, ["2026-10-01", "2026-10-15", "2026-11-01", "2026-11-15"]);
}

// planned items and manual recurring
{
  const planned = [
    { id: "p1", name: "Dental work", date: "2026-10-05", amountCents: 80_000, direction: "out" as const },
    { id: "p2", name: "Past thing", date: "2026-09-01", amountCents: 10_000, direction: "out" as const },
    { id: "p3", name: "Too far", date: "2027-06-01", amountCents: 10_000, direction: "out" as const },
    { id: "p4", name: "Refund", date: "2026-10-10", amountCents: 20_000, direction: "in" as const },
  ];
  const base = buildForecast({ today, days: 30, accounts: snap.accounts, transactions: txs, categories: cmap, recurring: rec, planned: [], includeEveryday: false })!;
  const withP = buildForecast({ today, days: 30, accounts: snap.accounts, transactions: txs, categories: cmap, recurring: rec, planned, includeEveryday: false })!;
  eq("planned: only in-window items count", withP.events.filter((e) => e.kind === "planned").map((e) => e.label), ["Dental work", "Refund"]);
  eq("planned: end changes by -800 + 200", withP.endCents - base.endCents, -60_000);
  eq("planned totals", withP.totals.planned, -60_000);
  const before = withP.points.find((p) => p.date === "2026-10-04")!.balanceCents;
  const after = withP.points.find((p) => p.date === "2026-10-05")!.balanceCents;
  const b4 = base.points.find((p) => p.date === "2026-10-04")!.balanceCents;
  eq("planned hits on its own day", [before - b4, after - base.points.find((p) => p.date === "2026-10-05")!.balanceCents], [0, -80_000]);
}
{
  // a cancelled recurring payment is left out
  const cancelled = rec.map((r) => (r.merchant === "Maple Court Apartments" ? { ...r, status: "cancelled" as const } : r));
  const f = buildForecast({ today, days: 60, accounts: snap.accounts, transactions: txs, categories: cmap, recurring: cancelled, planned: [], includeEveryday: false })!;
  eq("cancelled recurring not forecast", f.events.some((e) => e.label === "Maple Court Apartments"), false);
  // no spending accounts -> null
  eq("no spending accounts -> null", buildForecast({ today, days: 60, accounts: snap.accounts.filter((a) => a.kind !== "checking"), transactions: txs, categories: cmap, recurring: rec, planned: [], includeEveryday: true }), null);
  // manual recurring (no txIds) counts
  const manual = { ...rec[0], key: "manual:x", source: "manual" as const, merchant: "Gym locker", direction: "out" as const, kind: "expense" as const, categoryId: "subscriptions", txIds: [], nextDate: "2026-10-03", frequency: "monthly" as const, monthDays: [3], amountCents: 2_500, isBill: false, possiblyStopped: false, status: "active" as const };
  const f2 = buildForecast({ today, days: 30, accounts: snap.accounts, transactions: txs, categories: cmap, recurring: [manual], planned: [], includeEveryday: false })!;
  eq("manual recurring is forecast from the spending accounts", f2.events.map((e) => [e.label, e.amountCents, e.kind]), [["Gym locker", -2_500, "subscription"]]);
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
