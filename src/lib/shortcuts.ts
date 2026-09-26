/**
 * Keyboard shortcuts, as data plus a small state machine. No DOM in here: a caller feeds it what was pressed and it
 * says what to do, so the rules can be tested without a browser.
 *
 * The rules that keep it from getting in the way:
 *  - Nothing fires while you're typing in a field, or while a dialog is open. The two exceptions are the ones that
 *    are safe anywhere: Ctrl/⌘+K (Ask) and Ctrl/⌘+, (Preferences).
 *  - Plain letters only; anything with Ctrl, ⌘ or Alt held is left to the system, so ZeraphDesk never steals copy,
 *    paste, find or the browser's own keys.
 *  - Go-to shortcuts are two keys, "g" then a letter (like Gmail and GitHub). The second key has to come soon, or
 *    the "g" is forgotten. A wrong second key cancels and does nothing.
 */
import type { ViewKey } from "../nav";

/** Where "g" then a letter goes. Every target must be a real, built screen (a test checks). */
export const GO_KEYS: Record<string, { view: ViewKey; label: string }> = {
  o: { view: "overview", label: "Overview" },
  a: { view: "accounts", label: "Accounts" },
  h: { view: "health", label: "Financial Health" },
  t: { view: "transactions", label: "Transactions" },
  s: { view: "spending", label: "Spending" },
  l: { view: "timeline", label: "Timeline" },
  c: { view: "cash-flow", label: "Cash Flow" },
  b: { view: "bills", label: "Bills" },
  r: { view: "recurring", label: "Recurring" },
  u: { view: "budgets", label: "Budgets" },
  g: { view: "goals", label: "Goals" },
  f: { view: "forecast", label: "Forecast" },
  w: { view: "scenarios", label: "What-if scenarios" },
  n: { view: "net-worth", label: "Net Worth" },
  i: { view: "investments", label: "Investments" },
  d: { view: "debt", label: "Debt" },
  e: { view: "action-center", label: "Action Center" },
  y: { view: "activity", label: "Activity" },
  q: { view: "queue", label: "Replies waiting" },
  p: { view: "preferences", label: "Preferences" },
};

export type ShortcutAction = { type: "go"; view: ViewKey } | { type: "ask" } | { type: "help" } | { type: "preferences" };

export interface KeyInput {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** Focus is in a text field, a select, or anything you type into. */
  editable: boolean;
  /** A dialog is open and has the keyboard. */
  dialogOpen: boolean;
}

export interface PressResult {
  action: ShortcutAction | null;
  /** Whether the browser's own handling of this key should be suppressed. */
  handled: boolean;
  /** "g" was pressed and a second key is awaited: a screen can show a hint. */
  waiting: boolean;
}

/** How long after "g" the second key still counts. */
export const CHORD_MS = 1500;

export function createMatcher(now: () => number = Date.now) {
  let pendingSince: number | null = null;

  return {
    press(k: KeyInput): PressResult {
      const idle: PressResult = { action: null, handled: false, waiting: false };
      const commandKey = k.ctrl || k.meta;

      // Safe from anywhere, even while typing or with a dialog open.
      if (commandKey && !k.alt && k.key.toLowerCase() === "k") {
        pendingSince = null;
        return { action: { type: "ask" }, handled: true, waiting: false };
      }
      if (commandKey && !k.alt && k.key === ",") {
        pendingSince = null;
        return { action: { type: "preferences" }, handled: true, waiting: false };
      }

      if (k.editable || k.dialogOpen || commandKey || k.alt) {
        pendingSince = null;
        return idle;
      }

      if (k.key === "Escape") {
        pendingSince = null;
        return idle;
      }

      if (k.key === "?") {
        pendingSince = null;
        return { action: { type: "help" }, handled: true, waiting: false };
      }

      const expired = pendingSince !== null && now() - pendingSince > CHORD_MS;
      if (pendingSince !== null && !expired) {
        pendingSince = null;
        if (!k.shift) {
          const target = GO_KEYS[k.key.toLowerCase()];
          if (target && k.key.length === 1) return { action: { type: "go", view: target.view }, handled: true, waiting: false };
        }
        // Not a destination: the "g" is dropped and nothing happens.
        return idle;
      }

      if (k.key === "g" && !k.shift) {
        pendingSince = now();
        return { action: null, handled: true, waiting: true };
      }

      pendingSince = null;
      return idle;
    },

    /** Forget a half-typed "g", e.g. when the hint has timed out on screen. */
    reset() {
      pendingSince = null;
    },
  };
}

export interface ShortcutRow {
  keys: string[];
  label: string;
}

export interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

/** The list the help dialog shows. `mod` is Ctrl on Windows and ⌘ on a Mac. */
export function shortcutGroups(mod: string): ShortcutGroup[] {
  return [
    {
      title: "Anywhere",
      rows: [
        { keys: [mod, "K"], label: "Ask ZeraphDesk" },
        { keys: [mod, ","], label: "Open Preferences" },
        { keys: ["?"], label: "Show this list" },
        { keys: ["Esc"], label: "Close a dialog or panel" },
      ],
    },
    {
      title: "Go to (press g, then a letter)",
      rows: Object.entries(GO_KEYS).map(([letter, t]) => ({ keys: ["g", letter], label: t.label })),
    },
    {
      title: "On a page",
      rows: [{ keys: ["/"], label: "Search, on Transactions" }],
    },
  ];
}
