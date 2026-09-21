import { invoke } from "@tauri-apps/api/core";
import type { Connector, PullResult } from "./types";
import type { Action } from "../lib/actions";

/**
 * v1: IMAP in, SMTP out, authenticated with an app password.
 *
 * Why not OAuth: verification for a send scope takes weeks, and an app password
 * works the same way on Gmail, Outlook, and whatever host the business's
 * domain email actually sits on. Requires 2-Step Verification on the account,
 * and a Workspace admin can switch app passwords off — check that during setup.
 * OAuth is a v2 job; start the Google verification paperwork in parallel.
 *
 * The password never touches JS state or SQLite. Rust holds it in the OS
 * keychain and every call below is by account id.
 */

export interface MailAccount {
  id: string;
  address: string;
  imapHost: string;
  imapPort: number; // 993
  smtpHost: string;
  smtpPort: number; // 587
}

export interface MailConnectConfig extends MailAccount {
  appPassword: string;
}

export const emailConnector: Connector & { connect: (config: MailConnectConfig) => Promise<void> } = {
  id: "email",
  label: "Email",

  /**
   * Verifies the credentials before storing them, so Rust can reject early.
   * The password never comes back to JS after this call.
   */
  async connect(config: MailConnectConfig) {
    await invoke("mail_connect", {
      accountId: config.id,
      address: config.address,
      imapHost: config.imapHost,
      imapPort: config.imapPort,
      smtpHost: config.smtpHost,
      smtpPort: config.smtpPort,
      appPassword: config.appPassword,
    });
  },

  async isConnected() {
    return invoke<boolean>("mail_is_connected");
  },

  async pull(since: string | null): Promise<PullResult> {
    // Rust returns already-normalized rows; parsing MIME in JS is a trap.
    return invoke<PullResult>("mail_pull", { since });
  },

  canSend(action: Action) {
    return action.kind === "draft_reply" || action.kind === "follow_up";
  },

  async send(action: Action) {
    const p = action.payload;
    if (p.kind !== "draft_reply" && p.kind !== "follow_up") {
      throw new Error("Email can't send that kind of action.");
    }
    // inReplyTo is the inbound message's RFC822 Message-ID, captured when the
    // draft was proposed. Without it as In-Reply-To/References this lands as
    // a new thread in the customer's inbox and looks like a cold email.
    await invoke("mail_send", {
      to: p.to,
      subject: "subject" in p ? p.subject : "",
      body: p.body,
      inReplyTo: p.inReplyTo,
    });
  },
};
