//! IMAP fetch and SMTP send, authenticated with an app password.
//!
//! The whole account — including the password — lives in one OS keychain
//! entry (`keyring`), keyed by a fixed account id: v1 supports exactly one
//! mailbox per install, so there's nothing to disambiguate. It is never
//! returned to the frontend after `mail_connect`, never written to SQLite,
//! and never logged — not even truncated.
//!
//! v1 threading model: every unread message becomes its own thread (see
//! src/lib/sync.ts for why). Contact de-duplication by email happens on the
//! JS side, where the store lives.

use chrono::Utc;
use lettre::message::header::ContentType;
use lettre::message::Message as LettreMessage;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{SmtpTransport, Transport};
use mail_parser::MessageParser;
use serde::{Deserialize, Serialize};
use serde_json::json;

const SERVICE: &str = "dev.zeraph.desk";
const ACCOUNT_KEY: &str = "mail-account";
/// Bounds the first pull (and every pull) so a mailbox with years of unread
/// mail doesn't flood the queue on day one.
const MAX_PULL: usize = 20;

#[derive(Serialize, Deserialize, Clone)]
struct MailAccount {
    account_id: String,
    address: String,
    imap_host: String,
    imap_port: u16,
    smtp_host: String,
    smtp_port: u16,
    app_password: String,
}

#[derive(Serialize, Deserialize)]
pub struct PullResult {
    pub contacts: Vec<serde_json::Value>,
    pub threads: Vec<serde_json::Value>,
    pub messages: Vec<serde_json::Value>,
    pub cursor: Option<String>,
}

fn keychain_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT_KEY).map_err(|e| e.to_string())
}

fn load_account() -> Option<MailAccount> {
    let entry = keychain_entry().ok()?;
    let raw = entry.get_password().ok()?;
    serde_json::from_str(&raw).ok()
}

fn imap_session(account: &MailAccount) -> Result<imap::Session<imap::Connection>, String> {
    let client = imap::ClientBuilder::new(account.imap_host.as_str(), account.imap_port)
        .connect()
        .map_err(|e| e.to_string())?;
    client
        .login(&account.address, &account.app_password)
        .map_err(|(e, _)| e.to_string())
}

/// Called once during setup. Verifies both IMAP and SMTP before storing
/// anything — a saved password that doesn't work is worse than no password.
#[tauri::command]
pub async fn mail_connect(
    account_id: String,
    address: String,
    imap_host: String,
    imap_port: u16,
    smtp_host: String,
    smtp_port: u16,
    app_password: String,
) -> Result<(), String> {
    let account = MailAccount {
        account_id,
        address,
        imap_host,
        imap_port,
        smtp_host,
        smtp_port,
        app_password,
    };

    tauri::async_runtime::spawn_blocking({
        let account = account.clone();
        move || -> Result<(), String> {
            let mut session = imap_session(&account)
                .map_err(|e| format!("Couldn't sign in to IMAP ({}): {}", account.imap_host, e))?;
            session
                .select("INBOX")
                .map_err(|e| format!("Signed in, but couldn't open the inbox: {}", e))?;
            session.logout().ok();

            let creds = Credentials::new(account.address.clone(), account.app_password.clone());
            let mailer = SmtpTransport::starttls_relay(&account.smtp_host)
                .map_err(|e| format!("Couldn't reach SMTP host {}: {}", account.smtp_host, e))?
                .port(account.smtp_port)
                .credentials(creds)
                .build();
            if !mailer
                .test_connection()
                .map_err(|e| format!("SMTP connection failed: {}", e))?
            {
                return Err("SMTP server didn't accept the connection.".into());
            }

            Ok(())
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    let entry = keychain_entry()?;
    let raw = serde_json::to_string(&account).map_err(|e| e.to_string())?;
    entry.set_password(&raw).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn mail_is_connected() -> Result<bool, String> {
    Ok(load_account().is_some())
}

/// Forget the saved mailbox login on this computer. Nothing is sent to the mail provider; the app password
/// simply stops being stored here. (To revoke it for good, delete the app password in the email account.)
#[tauri::command]
pub async fn mail_forget() -> Result<(), String> {
    match keychain_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Unread messages since the cursor (an IMAP UID watermark), normalized.
/// Never marks anything read — the owner's inbox is theirs.
#[tauri::command]
pub async fn mail_pull(since: Option<String>) -> Result<PullResult, String> {
    let account = load_account().ok_or("Email isn't connected yet. Connect it in Settings.")?;

    tauri::async_runtime::spawn_blocking(move || -> Result<PullResult, String> {
        let mut session = imap_session(&account).map_err(|e| e.to_string())?;
        session.select("INBOX").map_err(|e| e.to_string())?;

        let query = match &since {
            Some(cursor) => {
                let last_uid: u32 = cursor.parse().unwrap_or(0);
                format!("UID {}:*", last_uid + 1)
            }
            None => "UNSEEN".to_string(),
        };

        let mut uids: Vec<u32> = session
            .uid_search(&query)
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|uid| match &since {
                Some(cursor) => *uid > cursor.parse().unwrap_or(0),
                None => true,
            })
            .collect();
        uids.sort_unstable();
        uids.truncate(MAX_PULL);

        let mut contacts = Vec::new();
        let mut threads = Vec::new();
        let mut messages = Vec::new();
        let mut max_uid: u32 = since.as_deref().and_then(|c| c.parse().ok()).unwrap_or(0);

        if !uids.is_empty() {
            let uid_set = uids
                .iter()
                .map(|u| u.to_string())
                .collect::<Vec<_>>()
                .join(",");
            let fetched = session
                .uid_fetch(&uid_set, "(UID RFC822)")
                .map_err(|e| e.to_string())?;

            let now = Utc::now().to_rfc3339();
            let parser = MessageParser::default();

            for fetch in fetched.iter() {
                let uid = match fetch.uid {
                    Some(uid) => uid,
                    None => continue,
                };
                max_uid = max_uid.max(uid);

                let raw = match fetch.body() {
                    Some(b) => b,
                    None => continue,
                };
                let parsed = match parser.parse(raw) {
                    Some(m) => m,
                    None => continue,
                };

                let from = parsed.from().and_then(|a| a.first());
                let from_email = from
                    .and_then(|a| a.address())
                    .unwrap_or("unknown@unknown")
                    .to_string();
                let from_name = from.and_then(|a| a.name()).map(|n| n.to_string());
                let subject = parsed.subject().unwrap_or("(no subject)").to_string();
                let message_id = parsed.message_id().map(|s| s.to_string());
                let body = parsed
                    .body_text(0)
                    .map(|s| s.to_string())
                    .unwrap_or_default();

                let contact_id = format!("c-{}", uid);
                let thread_id = format!("t-{}", uid);
                let message_row_id = format!("m-{}", uid);

                contacts.push(json!({
                    "id": contact_id,
                    "name": from_name,
                    "email": from_email,
                    "phone": null,
                    "firstSeen": now,
                    "lastSeen": now,
                    "tags": [],
                }));

                threads.push(json!({
                    "id": thread_id,
                    "contactId": contact_id,
                    "channel": "email",
                    "subject": subject,
                    "intent": "unknown",
                    "status": "open",
                    "lastMessageAt": now,
                }));

                messages.push(json!({
                    "id": message_row_id,
                    "threadId": thread_id,
                    "direction": "in",
                    "body": body,
                    "sentAt": now,
                    "fromActionId": null,
                    "messageId": message_id,
                }));
            }
        }

        session.logout().ok();

        Ok(PullResult {
            contacts,
            threads,
            messages,
            cursor: Some(max_uid.to_string()),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Only ever called after a human approval.
/// Sets In-Reply-To and References from the original Message-ID, or the
/// reply starts a new thread in the customer's inbox.
#[tauri::command]
pub async fn mail_send(
    to: String,
    subject: String,
    body: String,
    in_reply_to: Option<String>,
) -> Result<(), String> {
    let account = load_account().ok_or("Email isn't connected yet. Connect it in Settings.")?;

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut builder = LettreMessage::builder()
            .from(
                account
                    .address
                    .parse()
                    .map_err(|e| format!("Bad from address: {}", e))?,
            )
            .to(to.parse().map_err(|e| format!("Bad recipient address: {}", e))?)
            .subject(subject)
            .header(ContentType::TEXT_PLAIN);

        if let Some(mid) = &in_reply_to {
            let normalized = if mid.starts_with('<') { mid.clone() } else { format!("<{}>", mid) };
            builder = builder.in_reply_to(normalized.clone()).references(normalized);
        }

        let email = builder.body(body).map_err(|e| e.to_string())?;

        let creds = Credentials::new(account.address.clone(), account.app_password.clone());
        let mailer = SmtpTransport::starttls_relay(&account.smtp_host)
            .map_err(|e| e.to_string())?
            .port(account.smtp_port)
            .credentials(creds)
            .build();

        mailer.send(&email).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
