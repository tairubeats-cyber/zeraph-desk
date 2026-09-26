import { planOsNotifications, MAX_INDIVIDUAL } from "../src/lib/finance/notify";
import { planSync, type ActionItem, type InsightState } from "../src/lib/finance/intel";
import { mergePrefs, DEFAULT_PREFS } from "../src/lib/finance/prefs";
let fails = 0;
const eq = (n: string, g: unknown, w: unknown) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fails++; console.log((ok ? "ok   " : "FAIL ") + n + (ok ? "" : `  got ${JSON.stringify(g)} want ${JSON.stringify(w)}`)); };
const item = (id: string, over: Partial<InsightState> = {}): ActionItem => ({
  insight: { id, detector: "budget-over", severity: "notice", category: "money", title: `Title ${id}`, summary: `Summary ${id}`, facts: [], why: "", options: [], basis: "calculation", on: "2026-09-25" },
  state: { id, detector: "budget-over", severity: "notice", category: "money", title: "", summary: "", firstSeenAt: "2026-09-25T00:00:00Z", status: "open", read: false, notifHidden: false, osNotified: false, updatedAt: "", ...over },
} as ActionItem);
eq("nothing new: nothing shown", planOsNotifications([]), { show: [], markIds: [] });
eq("one new: shown with its own words", planOsNotifications([item("a")]), { show: [{ title: "Title a", body: "Summary a" }], markIds: ["a"] });
eq("already shown ones are skipped", planOsNotifications([item("a", { osNotified: true }), item("b")]).markIds, ["b"]);
eq("dismissed or resolved are never shown", planOsNotifications([item("a", { status: "dismissed" }), item("b", { status: "resolved" })]), { show: [], markIds: [] });
eq(`exactly ${MAX_INDIVIDUAL}: each shown`, planOsNotifications([item("a"), item("b"), item("c")]).show.length, 3);
const many = planOsNotifications([item("a"), item("b"), item("c"), item("d"), item("e")]);
eq("more than 3: one roll-up", [many.show.length, many.show[0].title], [1, "5 new things to look at"]);
eq("roll-up still marks every finding as shown", many.markIds, ["a", "b", "c", "d", "e"]);
eq("roll-up doesn't leak amounts or names", /Title|Summary/.test(many.show[0].body), false);
// a finding that clears and comes back is new again
const cur = [{ ...item("a").insight }];
const states: InsightState[] = [{ ...item("a").state, status: "resolved", osNotified: true }];
const plan = planSync(cur, states, "2026-10-01T00:00:00Z");
eq("a reopened finding can be notified again", [plan.reopened.length, plan.next[0].osNotified], [1, false]);
const fresh = planSync(cur, [], "2026-10-01T00:00:00Z");
eq("a brand new finding starts un-notified", fresh.next[0].osNotified, false);
const stays = planSync(cur, [{ ...item("a").state, osNotified: true }], "2026-10-01T00:00:00Z");
eq("an already-shown, still-open finding stays shown (no re-notify)", stays.next[0].osNotified, true);
eq("prefs: off by default", [DEFAULT_PREFS.systemNotifications, mergePrefs(null).systemNotifications, mergePrefs({ systemNotifications: "yes" }).systemNotifications], [false, false, false]);
eq("prefs: saved true survives", mergePrefs({ systemNotifications: true }).systemNotifications, true);
console.log(fails ? `\n${fails} FAILED` : "\nall passed"); process.exit(fails ? 1 : 0);