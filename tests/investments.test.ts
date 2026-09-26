import { generateSample } from "../src/lib/finance/sample";
import { RANGES } from "../src/lib/finance/networth";
import {
  allocation, concentration, contributionSummary, holdingRows, investmentAccounts, performance, portfolioSummary, positionDayChange, positionValue,
} from "../src/lib/finance/investments";
import { DEFAULT_LONG_TERM, mergeLongTerm, monthsToTarget, project, projectRange } from "../src/lib/finance/longterm";
import { addDays } from "../src/lib/finance/money";
import type { BalancePoint, FinancialAccount, InvestmentActivity } from "../src/lib/finance/types";

let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)); };
const near = (name: string, got: number, want: number, tol: number) => { const ok = Math.abs(got - want) <= tol; if (!ok) fails++; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : `  got ${got} want ${want}±${tol}`)); };
const yes = (name: string, c: boolean) => eq(name, c, true);

const today = "2026-09-25";

// --- Modified Dietz on a hand-made case -------------------------------------------
{
  const acct: FinancialAccount = { id: "a", institutionId: "i", connectionId: "c", name: "Test IRA", kind: "brokerage", mask: null, balanceCents: 1_200_000 };
  const from = addDays(today, -30);
  const hist: BalancePoint[] = [{ accountId: "a", date: from, balanceCents: 1_000_000 }, { accountId: "a", date: today, balanceCents: 1_200_000 }];
  const act: InvestmentActivity[] = [{ id: "x", accountId: "a", date: addDays(today, -15), kind: "contribution", amountCents: 100_000 }];
  const p = performance([acct], hist, act, today, RANGES[1])!;
  eq("start / end", [p.startCents, p.endCents], [1_000_000, 1_200_000]);
  eq("net contributions", p.netContributionsCents, 100_000);
  eq("growth = end - start - put in", p.growthCents, 100_000);
  near("Dietz return 10000 + 1000 halfway, ends 12000 -> 9.5238%", (p.returnPct as number) * 100, 9.5238, 0.001);
  eq("under a year: no annualized figure", p.annualizedPct, null);
  eq("put-in line ends at start + contributions", p.points[p.points.length - 1].putInCents, 1_100_000);
  eq("put-in line before the deposit is the start", p.points.find((x) => x.date === addDays(today, -16))!.putInCents, 1_000_000);
  eq("put-in line on the deposit day", p.points.find((x) => x.date === addDays(today, -15))!.putInCents, 1_100_000);
  eq("31 daily points", p.points.length, 31);
  // withdrawal and dividend handling
  const act2: InvestmentActivity[] = [
    ...act,
    { id: "w", accountId: "a", date: addDays(today, -5), kind: "withdrawal", amountCents: 20_000 },
    { id: "d", accountId: "a", date: addDays(today, -10), kind: "dividend", amountCents: 5_000 },
  ];
  const p2 = performance([acct], hist, act2, today, RANGES[1])!;
  eq("withdrawals reduce net contributions", p2.netContributionsCents, 80_000);
  eq("dividends are not money put in", p2.dividendsCents, 5_000);
  eq("growth counts dividends as growth", p2.growthCents, 200_000 - 80_000);
  // a year-long window annualizes
  const yr = performance([{ ...acct, balanceCents: 1_100_000 }], [{ accountId: "a", date: addDays(today, -365), balanceCents: 1_000_000 }, { accountId: "a", date: today, balanceCents: 1_100_000 }], [], today, RANGES[3])!;
  near("10% over exactly a year annualizes to 10%", (yr.annualizedPct as number) * 100, 10, 0.001);
  // no history -> null; no investment accounts -> null
  eq("no history: null", performance([acct], [], [], today, RANGES[1]), null);
  eq("no investment accounts: null", performance([{ ...acct, kind: "checking" }], hist, [], today, RANGES[1]), null);
  // a loss is negative and not "annualized" wrongly
  const loss = performance([{ ...acct, balanceCents: 800_000 }], [{ accountId: "a", date: from, balanceCents: 1_000_000 }], [], today, RANGES[1])!;
  near("a fall from 10000 to 8000 is -20%", (loss.returnPct as number) * 100, -20, 0.001);
}

// --- projection ------------------------------------------------------------------
{
  const flat = project(1_000_000, 10_000, 0, 10, 0);
  eq("0% growth: 10,000 + 100 x 120 months = 22,000", flat.years[10].nominalCents, 2_200_000);
  eq("year 0 is the start", flat.years[0].nominalCents, 1_000_000);
  eq("contributed line", flat.years[10].contributedCents, 2_200_000);
  const r = 0.06 / 12, n = 120;
  const fv = 1_000_000 * Math.pow(1 + r, n) + 10_000 * ((Math.pow(1 + r, n) - 1) / r);
  near("6% monthly compounding matches the annuity formula", project(1_000_000, 10_000, 600, 10, 0).years[10].nominalCents, Math.round(fv), 1);
  const infl = project(1_000_000, 0, 0, 10, 300).years[10];
  near("inflation 3% for 10y shrinks 10,000 to about 7,441", infl.realCents, Math.round(1_000_000 / Math.pow(1.03, 10)), 1);
  eq("nominal unaffected by inflation", infl.nominalCents, 1_000_000);
  const range = projectRange(1_000_000, 10_000, { ...DEFAULT_LONG_TERM, returnBps: 500, years: 10 });
  yes("low < mid < high at the end", range.low.years[10].nominalCents < range.mid.years[10].nominalCents && range.mid.years[10].nominalCents < range.high.years[10].nominalCents);
  eq("range rates", [range.low.returnBps, range.mid.returnBps, range.high.returnBps], [300, 500, 700]);
  eq("range never goes below 0%", projectRange(0, 0, { ...DEFAULT_LONG_TERM, returnBps: 100 }).low.returnBps, 0);
  const m = monthsToTarget(1_000_000, 10_000, 500, 5_000_000)!;
  const pj = project(1_000_000, 10_000, 500, 40, 0);
  yes("months to target: reached at month m, not before", (() => { const y = Math.ceil(m / 12); return pj.years[y].nominalCents >= 5_000_000 && pj.years[Math.max(0, Math.ceil((m - 1) / 12) - 1)].nominalCents < 5_000_000; })());
  eq("already there: 0 months", monthsToTarget(6_000_000, 0, 500, 5_000_000), 0);
  eq("never (no growth, no deposits)", monthsToTarget(1_000_000, 0, 0, 5_000_000), null);
  eq("0% growth, 100/mo: 4000 short takes 40 months", monthsToTarget(1_000_000, 10_000, 0, 1_400_000), 40);
  eq("merge: garbage falls back", mergeLongTerm({ returnBps: -5, years: 0, monthlyCents: "x", inflationBps: 99999 }), DEFAULT_LONG_TERM);
  eq("merge: good values kept", mergeLongTerm({ monthlyCents: 50_000, returnBps: 650, years: 30, targetCents: 100_000_000, inflationBps: 250 }), { monthlyCents: 50_000, returnBps: 650, years: 30, targetCents: 100_000_000, inflationBps: 250 });
  eq("merge: null saved", mergeLongTerm(null), DEFAULT_LONG_TERM);
}

// --- the sample --------------------------------------------------------------------
{
  const snap = generateSample(today);
  const inv = investmentAccounts(snap.accounts);
  eq("two investment accounts", inv.map((a) => a.id), ["acct-brokerage", "acct-401k"]);
  for (const a of inv) eq(`${a.name}: holdings add up to the balance exactly`, snap.positions.filter((p) => p.accountId === a.id).reduce((s, p) => s + positionValue(p), 0), a.balanceCents);
  yes("no negative cash remainder", snap.positions.filter((p) => p.type === "cash").every((p) => p.quantity >= 0));
  yes("every position has a positive price", snap.positions.every((p) => p.priceCents > 0 && p.previousCloseCents > 0));
  eq("deterministic on the same day", JSON.stringify(generateSample(today).positions) === JSON.stringify(snap.positions), true);
  yes("different day, different wobble", JSON.stringify(generateSample("2026-09-24").positions.map((p) => p.previousCloseCents)) !== JSON.stringify(snap.positions.map((p) => p.previousCloseCents)));

  const s = portfolioSummary(snap.accounts, snap.positions);
  eq("portfolio value = account balances", s.valueCents, 2_845_000 + 6_430_000);
  eq("nothing mismatched or missing", [s.mismatched.length, s.withoutHoldings.length], [0, 0]);
  const dayChange = snap.positions.reduce((t, p) => t + positionDayChange(p), 0);
  eq("daily change = sum of position changes", s.dailyChangeCents, dayChange);
  console.log("   daily change", (dayChange / 100).toFixed(2), (s.dailyPct! * 100).toFixed(3) + "%");
  yes("daily move is small (under 2%)", Math.abs(s.dailyPct!) < 0.02);
  const none = portfolioSummary(snap.accounts, []);
  eq("no holdings: daily change unknown, accounts listed", [none.dailyChangeCents, none.withoutHoldings.length], [null, 2]);
  const off = portfolioSummary(snap.accounts, snap.positions.filter((p) => p.symbol !== "NTMX"));
  eq("a missing holding shows up as a mismatch", off.mismatched.map((a) => a.id), ["acct-brokerage"]);

  const al = allocation(snap.accounts, snap.positions);
  eq("allocation adds up to the portfolio", al.reduce((t, x) => t + x.cents, 0), s.valueCents);
  near("fractions sum to 1", al.reduce((t, x) => t + x.fraction, 0), 1, 1e-9);
  console.log("   allocation", al.map((x) => `${x.key} ${(x.fraction * 100).toFixed(1)}%`).join(", "));
  const alNone = allocation(snap.accounts, []);
  eq("without holdings everything is 'unclassified', not guessed", alNone.map((x) => x.key), ["unclassified"]);
  const alHalf = allocation(snap.accounts, snap.positions.filter((p) => p.accountId === "acct-401k"));
  yes("an account with no holdings is its own slice", alHalf.some((x) => x.key === "unclassified" && x.cents === 2_845_000));

  const rows = holdingRows(snap.accounts, snap.positions);
  eq("sorted by value", rows.every((r, i) => i === 0 || rows[i - 1].valueCents >= r.valueCents), true);
  near("shares sum to 1", rows.reduce((t, r) => t + r.share, 0), 1, 1e-9);
  eq("401k has no cost basis so no gain figure", rows.filter((r) => r.account.id === "acct-401k").every((r) => r.gainCents === null), true);
  yes("brokerage funds/stocks have a gain figure", rows.filter((r) => r.account.id === "acct-brokerage" && r.position.type !== "cash").every((r) => r.gainCents !== null));
  const c = concentration(rows);
  console.log("   largest", c.largest!.position.symbol, (c.largest!.share * 100).toFixed(1) + "%", "| largest stock", c.largestStock!.position.symbol, (c.largestStock!.share * 100).toFixed(1) + "%");
  eq("largest single stock is HLSY", c.largestStock!.position.symbol, "HLSY");
  yes("no single stock over 15% in the sample", c.largestStock!.share < 0.15);

  const cs = contributionSummary(snap.accounts, snap.investmentActivity, today);
  console.log("   contributions", cs);
  eq("last 12 months: 12 x ($500 + $650)", cs.last12Cents, 12 * 115_000);
  eq("monthly average", cs.monthlyCents, 115_000);
  yes("dividends are not in contributions", cs.dividends12Cents > 0 && cs.totalCents % 5_000 === 0);
  eq("per-account split adds up", cs.perAccount.reduce((t, x) => t + x.last12Cents, 0), cs.last12Cents);

  for (const r of RANGES.filter((r) => r.key !== "today")) {
    const p = performance(snap.accounts, snap.balanceHistory, snap.investmentActivity, today, r)!;
    console.log(`   ${r.key.padEnd(4)} from ${p.from} start ${(p.startCents / 100).toFixed(0)} put in ${(p.netContributionsCents / 100).toFixed(0)} growth ${(p.growthCents / 100).toFixed(0)} return ${(p.returnPct! * 100).toFixed(1)}%${p.annualizedPct !== null ? ` (${(p.annualizedPct * 100).toFixed(1)}%/yr)` : ""} clipped=${p.clipped}`);
    eq(`${r.key}: ends at today's portfolio value`, p.endCents, s.valueCents);
    eq(`${r.key}: growth identity`, p.growthCents, p.endCents - p.startCents - p.netContributionsCents);
    eq(`${r.key}: put-in ends at start + net contributions`, p.points[p.points.length - 1].putInCents, p.startCents + p.netContributionsCents);
  }
  const yr = performance(snap.accounts, snap.balanceHistory, snap.investmentActivity, today, RANGES[3])!;
  eq("1y contributions match the summary", yr.netContributionsCents, cs.last12Cents);
  yes("1y has an annualized figure", yr.annualizedPct !== null);
  const all = performance(snap.accounts, snap.balanceHistory, snap.investmentActivity, today, RANGES[5])!;
  const five = performance(snap.accounts, snap.balanceHistory, snap.investmentActivity, today, RANGES[4])!;
  eq("5y is clipped to the 3 years that exist; all is not", [five.clipped, all.clipped], [true, false]);
  yes("3 years of monthly deposits on record: 36 x 1150", all.netContributionsCents === 36 * 115_000 || all.netContributionsCents === 35 * 115_000);
  yes("sample returns are plausible (all-time between 0 and 100%)", all.returnPct! > 0 && all.returnPct! < 1);
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
