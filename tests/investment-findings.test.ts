import { generateSample } from "../src/lib/finance/sample";
import { detectInsights, type DetectContext } from "../src/lib/finance/insights";
import { DEFAULT_PREFS, DETECTORS, mergePrefs, type DetectorId } from "../src/lib/finance/prefs";
import { addDays } from "../src/lib/finance/money";
import type { FinancialAccount } from "../src/lib/finance/types";
let fails = 0;
const eq = (n: string, g: unknown, w: unknown) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fails++; console.log((ok ? "ok   " : "FAIL ") + n + (ok ? "" : `  got ${JSON.stringify(g)} want ${JSON.stringify(w)}`)); };
const today = "2026-09-25";
const snap = generateSample(today);
const only: DetectorId[] = ["investments-drop", "concentration"];
const prefs = { ...DEFAULT_PREFS, watch: Object.fromEntries(DETECTORS.map((d) => [d.id, only.includes(d.id)])) as DetectContext["prefs"]["watch"] };
const base: DetectContext = { today, transactions: [], categories: [], accounts: snap.accounts, recurring: [], budgets: new Map(), goals: [], contributions: [], prefs, investments: { positions: snap.positions, history: snap.balanceHistory, activity: snap.investmentActivity } };

eq("sample: nothing fires", detectInsights(base).map((i) => i.id), []);
eq("no investment data at all: quiet, no crash", detectInsights({ ...base, investments: undefined }), []);
eq("the new detectors are in the list, in the investments category", DETECTORS.filter((d) => only.includes(d.id)).map((d) => d.category), ["investments", "investments"]);
eq("older saved prefs pick up the new detectors as on", [mergePrefs({ watch: { "cash-pressure": false } }).watch["investments-drop"], mergePrefs({ watch: { "cash-pressure": false } }).watch.concentration], [true, true]);

// A 30-day fall: both accounts 15% down with nothing put in.
const fall = (factor: number) => {
  const accts: FinancialAccount[] = snap.accounts.map((a) => (a.kind === "brokerage" || a.kind === "retirement" ? { ...a, balanceCents: Math.round(a.balanceCents * factor) } : a));
  const start = addDays(today, -30);
  const hist = snap.balanceHistory.filter((p) => p.date < start).concat(accts.filter((a) => a.kind === "brokerage" || a.kind === "retirement").flatMap((a) => [{ accountId: a.id, date: start, balanceCents: snap.accounts.find((x) => x.id === a.id)!.balanceCents }, { accountId: a.id, date: today, balanceCents: a.balanceCents }]));
  return { ...base, accounts: accts, investments: { positions: [], history: hist.filter((p, i, arr) => arr.findIndex((q) => q.accountId === p.accountId && q.date === p.date) === i), activity: [] } };
};
const d15 = detectInsights(fall(0.85));
eq("15% fall: one notice", d15.map((i) => [i.detector, i.severity]), [["investments-drop", "notice"]]);
console.log("   ", d15[0].title, "|", d15[0].summary);
eq("22% fall: attention", detectInsights(fall(0.78)).map((i) => i.severity), ["attention"]);
eq("8% fall: quiet", detectInsights(fall(0.92)), []);
eq("id is stable per month", d15[0].id, "investments-drop:2026-09");
eq("facts are figures, no advice in why", /should|buy|sell/i.test(d15[0].why), false);

// Concentration: a stock at ~30% of the portfolio, and a fund at 40% (must be ignored).
const big = snap.positions.map((p) => (p.symbol === "HLSY" ? { ...p, quantity: p.quantity * 8 } : p));
const total = big.filter((p) => p.accountId).reduce((s, p) => s + Math.round(p.quantity * p.priceCents), 0);
const c = detectInsights({ ...base, investments: { ...base.investments!, positions: big } });
eq("concentrated stock fires; the big index fund doesn't", c.map((i) => i.id), ["concentration:HLSY:2026-09"]);
console.log("   ", c[0].title, "|", c[0].summary, "| total", (total / 100).toFixed(0));
eq("switched off: quiet", detectInsights({ ...base, investments: { ...base.investments!, positions: big }, prefs: { ...prefs, watch: { ...prefs.watch, concentration: false } } }), []);
console.log(fails ? `\n${fails} FAILED` : "\nall passed"); process.exit(fails ? 1 : 0);