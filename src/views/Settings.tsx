import { useEffect, useState } from "react";
import { emailConnector, type MailConnectConfig } from "../connectors/email";
import { db } from "../lib/db";

const EMPTY_MAIL_FORM = {
  address: "",
  imapHost: "",
  imapPort: "993",
  smtpHost: "",
  smtpPort: "587",
  appPassword: "",
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-ink">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-paper-edge bg-white px-3 py-2 text-sm"
      />
    </div>
  );
}

export function Settings() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [mailForm, setMailForm] = useState(EMPTY_MAIL_FORM);
  const [mailError, setMailError] = useState<string | null>(null);

  const [seatToken, setSeatToken] = useState("");
  const [seatSaved, setSeatSaved] = useState(false);

  useEffect(() => {
    void emailConnector.isConnected().then(setConnected);
    void db.seatToken().then((t) => setSeatToken(t ?? ""));
  }, []);

  const setMail = <K extends keyof typeof EMPTY_MAIL_FORM>(key: K, value: string) =>
    setMailForm((f) => ({ ...f, [key]: value }));

  async function handleConnect() {
    setMailError(null);
    setConnecting(true);
    try {
      const config: MailConnectConfig = {
        id: "primary",
        address: mailForm.address,
        imapHost: mailForm.imapHost,
        imapPort: Number(mailForm.imapPort),
        smtpHost: mailForm.smtpHost,
        smtpPort: Number(mailForm.smtpPort),
        appPassword: mailForm.appPassword,
      };
      await emailConnector.connect(config);
      setConnected(true);
      setMailOpen(false);
      setMailForm(EMPTY_MAIL_FORM);
    } catch (err) {
      // Tauri rejects with the raw string an Err(String) command returns, not an Error instance.
      setMailError(
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message
            : "Couldn't connect. Check the details and try again.",
      );
    } finally {
      setConnecting(false);
    }
  }

  async function handleSaveSeatToken() {
    await db.saveSeatToken(seatToken.trim());
    setSeatSaved(true);
    setTimeout(() => setSeatSaved(false), 2000);
  }

  return (
    <div className="max-w-[68ch]">
      <h1 className="font-display text-4xl text-ink">Settings</h1>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-ink">Email</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          Desk reads new messages and writes replies for you to approve. It can't send anything on
          its own.
        </p>

        {connected && (
          <p className="mt-3 text-sm text-ink-soft">Connected. Desk checks for new mail every minute.</p>
        )}

        {!mailOpen && (
          <button
            onClick={() => setMailOpen(true)}
            className="mt-3 rounded-md border border-paper-edge bg-white px-4 py-2 text-sm text-ink hover:border-ink-soft"
          >
            {connected ? "Reconnect email" : "Connect email"}
          </button>
        )}

        {mailOpen && (
          <div className="mt-4 max-w-[52ch] space-y-3">
            <Field
              label="Email address"
              value={mailForm.address}
              onChange={(v) => setMail("address", v)}
              placeholder="you@yourbusiness.com"
            />
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="IMAP host"
                value={mailForm.imapHost}
                onChange={(v) => setMail("imapHost", v)}
                placeholder="imap.gmail.com"
              />
              <Field label="IMAP port" value={mailForm.imapPort} onChange={(v) => setMail("imapPort", v)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="SMTP host"
                value={mailForm.smtpHost}
                onChange={(v) => setMail("smtpHost", v)}
                placeholder="smtp.gmail.com"
              />
              <Field label="SMTP port" value={mailForm.smtpPort} onChange={(v) => setMail("smtpPort", v)} />
            </div>
            <Field
              label="App password"
              type="password"
              value={mailForm.appPassword}
              onChange={(v) => setMail("appPassword", v)}
              placeholder="Not your regular password — see your provider's app password setting"
            />

            {mailError && <p className="text-sm text-red-700">{mailError}</p>}

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={() => void handleConnect()}
                disabled={connecting}
                className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy-900 hover:bg-gold-deep hover:text-paper disabled:opacity-60"
              >
                {connecting ? "Connecting…" : "Connect"}
              </button>
              <button
                onClick={() => {
                  setMailOpen(false);
                  setMailError(null);
                }}
                className="rounded-md px-3 py-2 text-sm text-ink-soft hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-ink">Seat token</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          Issued when your seat was set up. Desk needs this to write drafts.
        </p>
        <div className="mt-3 flex max-w-[52ch] items-center gap-2">
          <input
            type="password"
            value={seatToken}
            onChange={(e) => setSeatToken(e.target.value)}
            placeholder="Paste your seat token"
            className="flex-1 rounded-md border border-paper-edge bg-white px-3 py-2 text-sm"
          />
          <button
            onClick={() => void handleSaveSeatToken()}
            className="rounded-md border border-paper-edge bg-white px-4 py-2 text-sm text-ink hover:border-ink-soft"
          >
            {seatSaved ? "Saved" : "Save"}
          </button>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-ink">Your business</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          Name, service area, hours, and how you sign off. Every draft uses these.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-ink">What leaves this computer</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          Your documents stay on this machine. To write a reply, Desk sends the message it's
          answering and the few lines it pulled from your files. Nothing else is uploaded, and
          nothing is used to train a model.
        </p>
      </section>
    </div>
  );
}
