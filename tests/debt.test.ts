import { simulatePayoff, loanPayment, loanSchedule, nextDueDate, payoffProgress, modellableDebts, valueAt } from "../src/lib/finance/debt";
import { netWorthNow, netWorthHistory, holdingValueOn, RANGES, thin } from "../src/lib/finance/networth";
import { generateSample } from "../src/lib/finance/sample";
let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)); };
const near = (name: string, got: number, want: number, tol: number) => { const ok = Math.abs(got - want) <= tol; if (!ok) fails++; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : `  got ${got} want ${want}±${tol}`)); };

const today = "2026-09-25";
// The spec's example: $12,400 at 19.99%, $350/month. n = -ln(1 - B r / P) / ln(1+r), r = .1999/12
{
  const r = 0.1999 / 12, B = 12400, P = 350;
  const n = -Math.log(1 - (B * r) / P) / Math.log(1 + r);
  const res = simulatePayoff([{ id: "a", name: "A", balanceCents: 1_240_000, aprBps: 1999, paymentCents: 35_000 }], today);
  console.log("closed-form months", n.toFixed(2), "sim months", res.months, "interest", res.totalInterestCents / 100);
  near("single debt months matches formula", res.months!, Math.ceil(n), 0);
  near("interest ~ total paid - principal", res.totalInterestCents, Math.round(P * 100 * n) - 1_240_000, 40_000);
  eq("balance series starts at the balance", res.balance[0], 1_240_000);
  eq("balance ends at zero", res.balance[res.balance.length - 1], 0);
  eq("payoff date is months from today", res.payoffDate, (() => { const d = new Date(2026, 8 + res.months!, 25); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-25`; })());
  const extra = simulatePayoff([{ id: "a", name: "A", balanceCents: 1_240_000, aprBps: 1999, paymentCents: 35_000 }], today, { extraCents: 15_000 });
  console.log("with +150:", extra.months, extra.totalInterestCents / 100);
  eq("extra shortens the payoff", extra.months! < res.months!, true);
  eq("extra lowers interest", extra.totalInterestCents < res.totalInterestCents, true);
}
// zero-interest: exactly balance / payment
{
  const r = simulatePayoff([{ id: "z", name: "Z", balanceCents: 100_000, aprBps: 0, paymentCents: 25_000 }], today);
  eq("0% APR 1000/250 = 4 months", r.months, 4);
  eq("0% APR no interest", r.totalInterestCents, 0);
}
// payment below interest never pays off
{
  const r = simulatePayoff([{ id: "n", name: "N", balanceCents: 1_000_000, aprBps: 2400, paymentCents: 10_000 }], today);
  eq("payment below interest -> null", r.months, null);
  eq("payoffDate null", r.payoffDate, null);
}
// avalanche vs snowball, rollover
{
  const debts = [
    { id: "big-lowrate", name: "Big", balanceCents: 1_000_000, aprBps: 500, paymentCents: 20_000 },
    { id: "small-highrate", name: "Small", balanceCents: 200_000, aprBps: 2500, paymentCents: 10_000 },
  ];
  const base = simulatePayoff(debts, today);
  const av = simulatePayoff(debts, today, { extraCents: 30_000, strategy: "avalanche", rollover: true });
  const sn = simulatePayoff(debts, today, { extraCents: 30_000, strategy: "snowball", rollover: true });
  console.log("base", base.months, base.totalInterestCents / 100, "| avalanche", av.months, av.totalInterestCents / 100, "| snowball", sn.months, sn.totalInterestCents / 100);
  eq("extra beats none", av.months! < base.months!, true);
  eq("avalanche interest <= snowball interest", av.totalInterestCents <= sn.totalInterestCents, true);
  eq("interest series is cumulative and monotonic", av.interest.every((v, i) => i === 0 || v >= av.interest[i - 1]), true);
  eq("paid series is cumulative and monotonic", av.paid.every((v, i) => i === 0 || v >= av.paid[i - 1]), true);
  eq("paid == principal + interest (conservation)", av.paid[av.paid.length - 1], 1_200_000 + av.totalInterestCents);
  eq("base paid == principal + interest", base.paid[base.paid.length - 1], 1_200_000 + base.totalInterestCents);
  eq("valueAt clamps past the end", valueAt(av.balance, 9999), 0);
  const focus = simulatePayoff(debts, today, { extraCents: 30_000, rollover: true, focusId: "big-lowrate" });
  eq("focusing on the low-rate debt costs more interest than avalanche", focus.totalInterestCents > av.totalInterestCents, true);
}
// loan payment formula: 30000 at 6% for 60 months = 579.98/month
{
  eq("loanPayment 30000/6%/60", loanPayment(3_000_000, 600, 60), 57_999);
  const s = loanSchedule(3_000_000, 600, 60);
  eq("schedule ends at zero", s.balance[s.balance.length - 1], 0);
  eq("schedule has 60 payments", s.balance.length - 1, 60);
  eq("total paid = principal + interest", s.paid.reduce((a, b) => a + b, 0), 3_000_000 + s.interest.reduce((a, b) => a + b, 0));
  eq("0% loan splits evenly", loanPayment(120_000, 0, 12), 10_000);
}
// due dates
{
  eq("due later this month", nextDueDate(28, "2026-09-25"), "2026-09-28");
  eq("due today counts", nextDueDate(25, "2026-09-25"), "2026-09-25");
  eq("already passed -> next month", nextDueDate(20, "2026-09-25"), "2026-10-20");
  eq("31st clamps to a 30 day month", nextDueDate(31, "2026-09-25"), "2026-09-30");
  eq("31st in Feb (non-leap) clamps to 28", nextDueDate(31, "2027-02-10"), "2027-02-28");
  eq("rolls over the year", nextDueDate(5, "2026-12-20"), "2027-01-05");
}
// sample history and net worth
{
  const snap = generateSample(today);
  const acct = snap.accounts;
  eq("history covers every account", new Set(snap.balanceHistory.map((p) => p.accountId)).size, acct.length);
  eq("history points per account", snap.balanceHistory.length, acct.length * 1096);
  const last = acct.every((a) => snap.balanceHistory.find((p) => p.accountId === a.id && p.date === today)!.balanceCents === a.balanceCents);
  eq("history ends at today's balances", last, true);
  eq("no negative balances", snap.balanceHistory.every((p) => p.balanceCents >= 0), true);
  eq("history deterministic", JSON.stringify(generateSample(today).balanceHistory) === JSON.stringify(snap.balanceHistory), true);
  const now = netWorthNow(acct, []);
  console.log("net worth now", now.netWorthCents / 100, "assets", now.assetsCents / 100, "owed", now.liabilitiesCents / 100);
  eq("net worth = assets - owed", now.netWorthCents, now.assetsCents - now.liabilitiesCents);
  const holdings = [
    { id: "h1", name: "Home", kind: "real_estate" as const, createdAt: "", values: [{ date: "2026-03-01", valueCents: 30_000_000 }, { date: "2026-09-01", valueCents: 31_000_000 }] },
    { id: "h2", name: "Family loan", kind: "other_debt" as const, createdAt: "", values: [{ date: "2026-09-01", valueCents: 500_000 }] },
    { id: "h3", name: "No value yet", kind: "vehicle" as const, createdAt: "", values: [] },
  ];
  const withH = netWorthNow(acct, holdings);
  eq("holdings add to assets and debts", [withH.otherAssetsCents, withH.otherDebtCents, withH.netWorthCents], [31_000_000, 500_000, now.netWorthCents + 31_000_000 - 500_000]);
  eq("holdingValueOn before first entry carries first back", holdingValueOn(holdings[0], "2025-01-01"), 30_000_000);
  eq("holdingValueOn between entries", holdingValueOn(holdings[0], "2026-06-15"), 30_000_000);
  eq("holdingValueOn after latest", holdingValueOn(holdings[0], today), 31_000_000);
  eq("holdingValueOn none", holdingValueOn(holdings[2], today), null);

  for (const r of RANGES.filter((r) => r.key !== "today")) {
    const h = netWorthHistory(acct, snap.balanceHistory, [], today, r);
    const lastPt = h.points[h.points.length - 1];
    console.log(r.key, "from", h.from, "points", h.points.length, "clipped", h.clipped, "start NW", h.points[0].netWorthCents / 100, "end NW", lastPt.netWorthCents / 100);
    eq(`${r.key}: last point equals today's net worth`, lastPt.netWorthCents, now.netWorthCents);
    eq(`${r.key}: dates ascend by one day`, h.points.every((p, i) => i === 0 || p.date > h.points[i - 1].date), true);
    eq(`${r.key}: assets - liabilities = net worth`, h.points.every((p) => p.assetsCents - p.liabilitiesCents === p.netWorthCents), true);
  }
  const d30 = netWorthHistory(acct, snap.balanceHistory, [], today, RANGES[1]);
  eq("30d has 31 points", d30.points.length, 31);
  eq("30d not clipped", d30.clipped, false);
  const y5 = netWorthHistory(acct, snap.balanceHistory, [], today, RANGES[4]);
  eq("5y is clipped to the 3 years that exist", y5.clipped, true);
  eq("5y starts at the data start", y5.from, y5.dataStart);
  const all = netWorthHistory(acct, snap.balanceHistory, [], today, RANGES[5]);
  eq("all is not clipped", all.clipped, false);
  eq("no notes for complete history", all.notes, []);
  const sliceSum = d30.slices.reduce((s, x) => s + (x.owed ? -x.endCents : x.endCents), 0);
  eq("slices sum to net worth (end)", sliceSum, now.netWorthCents);
  const sliceStart = d30.slices.reduce((s, x) => s + (x.owed ? -x.startCents : x.startCents), 0);
  eq("slices sum to net worth (start)", sliceStart, d30.points[0].netWorthCents);
  const hh = netWorthHistory(acct, snap.balanceHistory, holdings, today, RANGES[3]);
  eq("with holdings: last point equals combined net worth", hh.points[hh.points.length - 1].netWorthCents, withH.netWorthCents);
  console.log("notes with holdings:", hh.notes);
  eq("holdings note appears", hh.notes.some((n) => n.includes("carried back")), true);
  const none = netWorthHistory(acct, [], [], today, RANGES[3]);
  eq("no history: flat series at today", new Set(none.points.map((p) => p.netWorthCents)).size, 1);
  eq("no history: says so", none.notes[0].includes("include past balances"), true);
  const partial = netWorthHistory(acct, snap.balanceHistory.filter((p) => p.accountId !== "acct-card"), [], today, RANGES[2]);
  eq("one account missing history is named", partial.notes[0].includes("Rewards Card"), true);
  eq("thin keeps ends", (() => { const t = thin(all.points, 100); return t.length === 100 && t[0] === all.points[0] && t[99] === all.points[all.points.length - 1]; })(), true);
  const auto = acct.find((a) => a.id === "acct-auto")!;
  const prog = payoffProgress(auto, snap.balanceHistory)!;
  console.log("auto progress", prog.startCents / 100, prog.paidDownCents / 100, Math.round(prog.fraction * 100) + "%");
  eq("progress: paid down = start - current", prog.paidDownCents, prog.startCents - auto.balanceCents);
  eq("progress none without history", payoffProgress(auto, []), null);
  const terms = new Map([["acct-auto", { accountId: "acct-auto", aprBps: 649, minPaymentCents: 35_000, paymentCents: null, dueDay: 20 }], ["acct-card", { accountId: "acct-card", aprBps: null, minPaymentCents: 5_000, paymentCents: null, dueDay: 5 }]]);
  eq("only debts with rate and payment are modelled", modellableDebts(acct, terms).map((d) => d.id), ["acct-auto"]);
  eq("payment falls back to minimum", modellableDebts(acct, terms)[0].paymentCents, 35_000);
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
