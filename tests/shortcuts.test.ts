import { CHORD_MS, GO_KEYS, createMatcher, shortcutGroups, type KeyInput } from "../src/lib/shortcuts";
import { findItem } from "../src/nav";

let fails = 0;
const eq = (n: string, g: unknown, w: unknown) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  if (!ok) fails++;
  console.log((ok ? "ok   " : "FAIL ") + n + (ok ? "" : `  got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
};
const yes = (n: string, c: boolean) => eq(n, c, true);

const press = (key: string, o: Partial<KeyInput> = {}): KeyInput => ({ key, ctrl: false, meta: false, alt: false, shift: false, editable: false, dialogOpen: false, ...o });
let clock = 1000;
const fresh = () => {
  clock = 1000;
  return createMatcher(() => clock);
};
const go = (view: string) => ({ type: "go", view });

// ---- the destinations are real -----------------------------------------------------------------------------------
const letters = Object.keys(GO_KEYS);
yes("every destination is a single lowercase letter", letters.every((l) => /^[a-z]$/.test(l)));
yes("every destination is a real, built screen", letters.every((l) => { const f = findItem(GO_KEYS[l].view); return f.item.key === GO_KEYS[l].view && f.item.built; }));
eq("no two letters go to the same screen", new Set(letters.map((l) => GO_KEYS[l].view)).size, letters.length);
yes("every screen has a name for the help list", letters.every((l) => GO_KEYS[l].label.length > 0));
yes("the new screens are reachable", ["timeline", "health", "spending"].every((v) => letters.some((l) => GO_KEYS[l].view === v)));

// ---- "g" then a letter ---------------------------------------------------------------------------------------------------
{
  const m = fresh();
  const a = m.press(press("g"));
  eq("g starts a chord, says so, and takes the key", [a.action, a.waiting, a.handled], [null, true, true]);
  clock += 400;
  const b = m.press(press("a"));
  eq("then a goes to Accounts", [b.action, b.handled, b.waiting], [go("accounts"), true, false]);
  eq("and a alone afterwards does nothing", m.press(press("a")), { action: null, handled: false, waiting: false });
}
for (const l of letters) {
  const m = fresh();
  m.press(press("g"));
  eq(`g ${l} goes to ${GO_KEYS[l].label}`, m.press(press(l)).action, go(GO_KEYS[l].view));
}
{
  const m = fresh();
  m.press(press("g"));
  eq("g g is the Goals screen, since g is a destination too", m.press(press("g")).action, go("goals"));
}

// ---- timing -----------------------------------------------------------------------------------------------------------
{
  const m = fresh();
  m.press(press("g"));
  clock += CHORD_MS;
  eq("right at the limit still counts", m.press(press("o")).action, go("overview"));
  m.press(press("g"));
  clock += CHORD_MS + 1;
  eq("a moment later the g is forgotten", m.press(press("o")), { action: null, handled: false, waiting: false });
  m.press(press("g"));
  clock += CHORD_MS + 500;
  const again = m.press(press("g"));
  eq("after it lapses a new g starts a fresh chord", [again.waiting, again.action], [true, null]);
}

// ---- cancelling ---------------------------------------------------------------------------------------------------------
{
  const m = fresh();
  m.press(press("g"));
  eq("a key that isn't a destination cancels quietly", m.press(press("z")), { action: null, handled: false, waiting: false });
  eq("and the next letter is then just a letter", m.press(press("a")).action, null);
  m.press(press("g"));
  m.press(press("Escape"));
  eq("Escape cancels", m.press(press("a")).action, null);
  m.press(press("g"));
  eq("Enter isn't a destination", m.press(press("Enter")).action, null);
  m.press(press("g"));
  eq("a long key name is never mistaken for a letter", m.press(press("Tab")).action, null);
}

// ---- it never gets in the way -------------------------------------------------------------------------------------------
{
  const m = fresh();
  eq("typing in a field: g does nothing", m.press(press("g", { editable: true })), { action: null, handled: false, waiting: false });
  eq("typing in a field: ? does nothing", m.press(press("?", { editable: true })).action, null);
  m.press(press("g"));
  eq("clicking into a field between g and a cancels the chord", m.press(press("a", { editable: true })).action, null);
  m.press(press("g"));
  m.press(press("x", { editable: true }));
  eq("...and it stays cancelled when focus comes out", m.press(press("a")).action, null);
  eq("a dialog open: g does nothing", m.press(press("g", { dialogOpen: true })).waiting, false);
  eq("a dialog open: ? does nothing", m.press(press("?", { dialogOpen: true })).action, null);
  eq("Ctrl+G is left alone", m.press(press("g", { ctrl: true })), { action: null, handled: false, waiting: false });
  eq("⌘+G is left alone", m.press(press("g", { meta: true })).waiting, false);
  eq("Alt+G is left alone", m.press(press("g", { alt: true })).waiting, false);
  m.press(press("g"));
  eq("Ctrl+A after g is select-all, not Accounts", m.press(press("a", { ctrl: true })).action, null);
  m.press(press("g"));
  eq("a capital A after g isn't Accounts", m.press(press("A", { shift: true })).action, null);
  eq("a capital G doesn't start a chord", m.press(press("G", { shift: true })).waiting, false);
  eq("copy, paste and find are never handled", ["c", "v", "f", "a"].map((k) => m.press(press(k, { ctrl: true })).handled), [false, false, false, false]);
}

// ---- the keys that work anywhere ---------------------------------------------------------------------------------------
{
  const m = fresh();
  eq("? shows the list", [m.press(press("?", { shift: true })).action, m.press(press("?")).handled], [{ type: "help" }, true]);
  eq("Ctrl+K asks", m.press(press("k", { ctrl: true })).action, { type: "ask" });
  eq("⌘+K asks", m.press(press("k", { meta: true })).action, { type: "ask" });
  eq("Ctrl+K works while typing", m.press(press("k", { ctrl: true, editable: true })).action, { type: "ask" });
  eq("Ctrl+K works with a dialog open (it toggles Ask)", m.press(press("k", { ctrl: true, dialogOpen: true })).action, { type: "ask" });
  eq("Ctrl+, opens Preferences", m.press(press(",", { ctrl: true })).action, { type: "preferences" });
  eq("⌘+, opens Preferences, even while typing", m.press(press(",", { meta: true, editable: true })).action, { type: "preferences" });
  eq("Ctrl+Alt+K is not Ask", m.press(press("k", { ctrl: true, alt: true })).action, null);
  m.press(press("g"));
  eq("Ctrl+K in the middle of a chord asks and clears it", [m.press(press("k", { ctrl: true })).action, m.press(press("a")).action], [{ type: "ask" }, null]);
  eq("ordinary keys are not handled", ["a", "b", "Enter", "ArrowDown", " "].map((k) => m.press(press(k)).handled), [false, false, false, false, false]);
}

// ---- the list on screen ---------------------------------------------------------------------------------------------------
{
  const groups = shortcutGroups("Ctrl");
  eq("groups", groups.map((g) => g.title), ["Anywhere", "Go to (press g, then a letter)", "On a page"]);
  eq("every destination is listed, as g plus its letter", groups[1].rows.map((r) => r.keys.join("+")), letters.map((l) => `g+${l}`));
  eq("the modifier is named for the computer", [shortcutGroups("Ctrl")[0].rows[0].keys, shortcutGroups("⌘")[0].rows[0].keys], [["Ctrl", "K"], ["⌘", "K"]]);
  yes("the help lists the search shortcut that already exists on Transactions", groups[2].rows.some((r) => r.keys[0] === "/"));
  yes("Ask and Preferences are in the list", groups[0].rows.some((r) => r.label === "Ask ZeraphDesk") && groups[0].rows.some((r) => r.label === "Open Preferences"));
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
