import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { OsMessage } from "./finance/notify";

/** Whether the operating system lets ZeraphDesk show notifications, asking once if it hasn't been decided. */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/**
 * Show the messages. "denied" means the person has since switched notifications
 * off in their system settings, so the caller should stop asking.
 */
export async function showOsNotifications(messages: OsMessage[]): Promise<"sent" | "denied" | "error"> {
  try {
    if (!(await isPermissionGranted())) return "denied";
    for (const m of messages) sendNotification({ title: m.title, body: m.body });
    return "sent";
  } catch {
    return "error";
  }
}
