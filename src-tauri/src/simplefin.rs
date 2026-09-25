//! SimpleFIN Bridge: read-only bank data the person has chosen to connect.
//!
//! The person links their bank at the bridge (SimpleFIN's own site, never here)
//! and gets a one-time *setup token*. `simplefin_claim` trades it for an *access
//! URL* — a URL with a username and password inside it — and keeps that in one
//! OS keychain entry. Like the mail password it is never returned to the
//! frontend, never written to SQLite and never logged. Every request is made
//! from here with the credentials in a header, so the address that appears in
//! any error message has none in it. The webview's CSP therefore stays closed to
//! the bridge: only this file talks to it.
//!
//! Nothing here runs on its own. Each call is the result of a click.

use std::io::Read;
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use percent_encoding::percent_decode_str;

const SERVICE: &str = "dev.zeraph.desk";
const ACCOUNT_KEY: &str = "simplefin-access";
/// A year of transactions for a few accounts is well under this; anything bigger isn't a bank's reply.
const MAX_BODY: u64 = 24 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(45);

fn keychain_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT_KEY).map_err(|e| e.to_string())
}

fn stored_access_url() -> Option<String> {
    keychain_entry().ok()?.get_password().ok()
}

/// Loopback is allowed over plain http so the flow can be tried against a local stand-in; everything else needs https.
fn is_loopback(host: &str) -> bool {
    host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1"
}

fn checked_url(raw: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(raw.trim()).map_err(|_| "That doesn't look like a SimpleFIN setup token.".to_string())?;
    let host = parsed.host_str().unwrap_or("");
    match parsed.scheme() {
        "https" => Ok(parsed),
        "http" if is_loopback(host) => Ok(parsed),
        _ => Err("That setup token points somewhere that isn't secure, so it wasn't used.".to_string()),
    }
}

/// A setup token is a base64-encoded claim URL. Tokens are pasted, so stray whitespace and either base64 alphabet are tolerated.
fn decode_setup_token(token: &str) -> Result<url::Url, String> {
    let cleaned: String = token.chars().filter(|c| !c.is_whitespace()).collect();
    let standard = cleaned.replace('-', "+").replace('_', "/");
    let unpadded = standard.trim_end_matches('=');
    let bytes = base64::engine::general_purpose::STANDARD_NO_PAD
        .decode(unpadded)
        .map_err(|_| "That doesn't look like a SimpleFIN setup token. Copy the whole token from the bridge.".to_string())?;
    let text = String::from_utf8(bytes).map_err(|_| "That doesn't look like a SimpleFIN setup token.".to_string())?;
    checked_url(&text)
}

/// The access URL split into the address to call and the Basic header to send it with.
struct Access {
    base: url::Url,
    authorization: String,
}

fn split_access(raw: &str) -> Result<Access, String> {
    let mut base = checked_url(raw)?;
    let user = percent_decode_str(base.username()).decode_utf8_lossy().into_owned();
    let pass = percent_decode_str(base.password().unwrap_or("")).decode_utf8_lossy().into_owned();
    if user.is_empty() {
        return Err("The saved connection is incomplete. Connect SimpleFIN again.".to_string());
    }
    let _ = base.set_username("");
    let _ = base.set_password(None);
    let authorization = format!("Basic {}", STANDARD.encode(format!("{user}:{pass}")));
    Ok(Access { base, authorization })
}

fn agent() -> Result<ureq::Agent, String> {
    let tls = native_tls::TlsConnector::new().map_err(|e| format!("Couldn't set up a secure connection: {e}"))?;
    Ok(ureq::AgentBuilder::new().tls_connector(Arc::new(tls)).timeout(TIMEOUT).redirects(0).build())
}

fn read_body(resp: ureq::Response) -> Result<String, String> {
    let mut out = String::new();
    resp.into_reader()
        .take(MAX_BODY)
        .read_to_string(&mut out)
        .map_err(|e| format!("The reply from SimpleFIN couldn't be read: {e}"))?;
    Ok(out)
}

fn explain(err: ureq::Error) -> String {
    match err {
        ureq::Error::Status(402, _) => "SimpleFIN says the subscription needs attention. Check your account at the bridge.".to_string(),
        ureq::Error::Status(403, _) => {
            "SimpleFIN didn't accept the connection. The token may have been used already or turned off at the bridge. Make a new one and connect again.".to_string()
        }
        ureq::Error::Status(429, _) => "SimpleFIN says too many requests were made today. Try again tomorrow.".to_string(),
        ureq::Error::Status(code, _) => format!("SimpleFIN answered with an error ({code}). Try again in a little while."),
        // The transport error's text names the address; the address has no credentials in it (see the module note).
        ureq::Error::Transport(t) => format!("Couldn't reach SimpleFIN ({}). Check your internet connection.", t.kind()),
    }
}

/// Trade the setup token for an access URL and keep it. Returns only the bridge's host name.
#[tauri::command]
pub async fn simplefin_claim(setup_token: String) -> Result<String, String> {
    let claim = decode_setup_token(&setup_token)?;
    let host = claim.host_str().unwrap_or("SimpleFIN").to_string();
    let access = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let resp = agent()?.post(claim.as_str()).call().map_err(explain)?;
        let body = read_body(resp)?;
        let access = body.trim().to_string();
        // Refuse to keep anything that isn't a usable access URL.
        split_access(&access)?;
        Ok(access)
    })
    .await
    .map_err(|e| e.to_string())??;
    keychain_entry()?.set_password(&access).map_err(|e| e.to_string())?;
    Ok(host)
}

#[tauri::command]
pub fn simplefin_connected() -> bool {
    stored_access_url().is_some()
}

/// Forget the access URL on this computer. The bridge still lists the token until the person turns it off there.
#[tauri::command]
pub fn simplefin_disconnect() -> Result<(), String> {
    match keychain_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// One call to the bridge's /accounts. `start` and `end` are Unix seconds (end is exclusive); the bridge limits a window to 90 days.
/// Returns the reply body untouched, for the frontend to read. It contains no credentials.
#[tauri::command]
pub async fn simplefin_accounts(start: Option<i64>, end: Option<i64>, balances_only: bool) -> Result<String, String> {
    let raw = stored_access_url().ok_or_else(|| "SimpleFIN isn't connected.".to_string())?;
    let access = split_access(&raw)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let mut url = access.base.clone();
        let path = format!("{}/accounts", url.path().trim_end_matches('/'));
        url.set_path(&path);
        {
            let mut q = url.query_pairs_mut();
            if let Some(s) = start {
                q.append_pair("start-date", &s.to_string());
            }
            if let Some(e) = end {
                q.append_pair("end-date", &e.to_string());
            }
            if balances_only {
                q.append_pair("balances-only", "1");
            }
        }
        let resp = agent()?.get(url.as_str()).set("Authorization", &access.authorization).call().map_err(explain)?;
        read_body(resp)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token(url: &str) -> String {
        STANDARD.encode(url)
    }

    #[test]
    fn decodes_a_setup_token() {
        let t = token("https://bridge.simplefin.org/simplefin/claim/abc123");
        assert_eq!(decode_setup_token(&t).unwrap().as_str(), "https://bridge.simplefin.org/simplefin/claim/abc123");
    }

    #[test]
    fn tolerates_pasted_whitespace_and_missing_padding() {
        let t = token("https://bridge.simplefin.org/simplefin/claim/abcd");
        let messy = format!("  {}\n", t.trim_end_matches('='));
        assert!(decode_setup_token(&messy).is_ok());
    }

    #[test]
    fn rejects_garbage_and_insecure_tokens() {
        assert!(decode_setup_token("not a token!!").is_err());
        assert!(decode_setup_token(&token("http://bridge.example.com/claim/x")).is_err());
        assert!(decode_setup_token(&token("ftp://bridge.example.com/claim/x")).is_err());
        assert!(decode_setup_token(&token("just words")).is_err());
    }

    #[test]
    fn allows_plain_http_only_on_this_computer() {
        assert!(decode_setup_token(&token("http://127.0.0.1:8123/claim/x")).is_ok());
        assert!(decode_setup_token(&token("http://localhost:8123/claim/x")).is_ok());
    }

    #[test]
    fn splits_the_access_url_so_the_address_carries_no_credentials() {
        let a = split_access("https://user1:p%40ss@bridge.simplefin.org/simplefin").unwrap();
        assert_eq!(a.base.as_str(), "https://bridge.simplefin.org/simplefin");
        assert!(!a.base.as_str().contains("user1"));
        assert_eq!(a.authorization, format!("Basic {}", STANDARD.encode("user1:p@ss")));
    }

    #[test]
    fn a_plus_in_a_password_stays_a_plus() {
        let a = split_access("https://u:a+b@bridge.simplefin.org/simplefin").unwrap();
        assert_eq!(a.authorization, format!("Basic {}", STANDARD.encode("u:a+b")));
    }

    #[test]
    fn an_access_url_without_a_user_is_refused() {
        assert!(split_access("https://bridge.simplefin.org/simplefin").is_err());
    }
}
