/**
 * Deciding what to show as a system notification. Pure: findings in, a plan
 * out. The plan never invents anything; every notification is a finding the
 * person can already see in the bell and the Action Center, in a category
 * they left on, shown once.
 */
import type { ActionItem } from "./intel";

/** More than this many at once and they're rolled into one, so a new month can't bury the screen in toasts. */
export const MAX_INDIVIDUAL = 3;

export interface OsMessage {
  title: string;
  body: string;
}

export interface OsPlan {
  show: OsMessage[];
  /** Every finding this plan covers, to be marked as shown. */
  markIds: string[];
}

/** `notifications` are the findings already filtered to enabled categories (see `notificationsFor`). */
export function planOsNotifications(notifications: ActionItem[]): OsPlan {
  const fresh = notifications.filter((n) => n.state.status === "open" && !n.state.osNotified);
  if (fresh.length === 0) return { show: [], markIds: [] };
  const markIds = fresh.map((n) => n.state.id);
  if (fresh.length <= MAX_INDIVIDUAL) {
    return { show: fresh.map((n) => ({ title: n.insight.title, body: n.insight.summary })), markIds };
  }
  return {
    show: [{ title: `${fresh.length} new things to look at`, body: "Open ZeraphDesk and see the Action Center for the details." }],
    markIds,
  };
}
