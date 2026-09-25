import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Check, CircleAlert } from "lucide-react";
import { emailConnector, type MailConnectConfig } from "../connectors/email";
import { db } from "../lib/db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { PageHeader } from "../components/PageHeader";
import { FinancialData } from "@/components/finance/FinancialData";
import type { Finance } from "@/lib/finance/useFinance";

const EMPTY_MAIL_FORM = {
  address: "",
  imapHost: "",
  imapPort: "993",
  smtpHost: "",
  smtpPort: "587",
  appPassword: "",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-2 px-1 text-label text-ink-tertiary">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Connections({ finance, onNotify }: { finance: Finance; onNotify: (message: string) => void }) {
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

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
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

  async function handleSaveSeatToken(e: FormEvent) {
    e.preventDefault();
    await db.saveSeatToken(seatToken.trim());
    setSeatSaved(true);
    setTimeout(() => setSeatSaved(false), 2000);
  }

  return (
    <div>
      <PageHeader title="Connections" description="Your financial data, and the email account and service seat ZeraphDesk uses." />

      <div className="space-y-8">
        <Section title="Financial data">
          <FinancialData finance={finance} onNotify={onNotify} />
        </Section>

        <Section title="Email">
          <Card className="p-5 md:p-6">
            <div className="flex items-start justify-between gap-4 max-md:flex-col">
              <div className="min-w-0">
                <p className="max-w-[56ch] text-body text-ink-secondary">
                  Desk reads new messages and writes replies for you to approve. It can't send anything on its
                  own.
                </p>
                {connected && (
                  <p className="mt-2 flex items-center gap-1.5 text-label text-success">
                    <Check className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
                    Connected. Desk checks for new mail every minute.
                  </p>
                )}
              </div>
              {!mailOpen && (
                <Button variant={connected ? "secondary" : "primary"} onClick={() => setMailOpen(true)}>
                  {connected ? "Reconnect email" : "Connect email"}
                </Button>
              )}
            </div>

            {mailOpen && (
              <form onSubmit={(e) => void handleConnect(e)} className="mt-5 animate-fade-in space-y-4 border-t border-line pt-5">
                <TextField
                  label="Email address"
                  type="email"
                  autoComplete="off"
                  value={mailForm.address}
                  onChange={(e) => setMail("address", e.target.value)}
                  placeholder="you@yourbusiness.com"
                  required
                />
                <div className="grid grid-cols-[1fr_7rem] gap-3">
                  <TextField
                    label="IMAP host"
                    autoComplete="off"
                    value={mailForm.imapHost}
                    onChange={(e) => setMail("imapHost", e.target.value)}
                    placeholder="imap.gmail.com"
                    required
                  />
                  <TextField
                    label="IMAP port"
                    inputMode="numeric"
                    value={mailForm.imapPort}
                    onChange={(e) => setMail("imapPort", e.target.value)}
                    required
                  />
                </div>
                <div className="grid grid-cols-[1fr_7rem] gap-3">
                  <TextField
                    label="SMTP host"
                    autoComplete="off"
                    value={mailForm.smtpHost}
                    onChange={(e) => setMail("smtpHost", e.target.value)}
                    placeholder="smtp.gmail.com"
                    required
                  />
                  <TextField
                    label="SMTP port"
                    inputMode="numeric"
                    value={mailForm.smtpPort}
                    onChange={(e) => setMail("smtpPort", e.target.value)}
                    required
                  />
                </div>
                <TextField
                  label="App password"
                  type="password"
                  autoComplete="off"
                  help="Not your regular password. Create an app password in your email provider's security settings."
                  value={mailForm.appPassword}
                  onChange={(e) => setMail("appPassword", e.target.value)}
                  required
                />

                {mailError && (
                  <p role="alert" className="flex items-start gap-2 text-label font-normal text-danger">
                    <CircleAlert className="mt-px h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    {mailError}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2 pt-1 max-md:flex-col-reverse max-md:items-stretch">
                  <Button
                    variant="tertiary"
                    disabled={connecting}
                    onClick={() => {
                      setMailOpen(false);
                      setMailError(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" loading={connecting}>
                    {connecting ? "Connecting…" : "Connect"}
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </Section>

        <Section title="Seat token">
          <Card className="p-5 md:p-6">
            <form onSubmit={(e) => void handleSaveSeatToken(e)} className="flex items-end gap-2 max-md:flex-col max-md:items-stretch">
              <TextField
                className="min-w-0 flex-1"
                label="Seat token"
                type="password"
                autoComplete="off"
                help="Issued when your seat was set up. Desk needs this to write drafts."
                value={seatToken}
                onChange={(e) => setSeatToken(e.target.value)}
                placeholder="Paste your seat token"
              />
              <Button type="submit" variant="secondary" aria-live="polite">
                {seatSaved ? (
                  <>
                    <Check className="h-4 w-4 text-success" strokeWidth={2.25} aria-hidden="true" />
                    Saved
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </form>
          </Card>
        </Section>

      </div>
    </div>
  );
}

export function Security({ source }: { source: "sample" | "import" }) {
  return (
    <div>
      <PageHeader title="Security" description="What stays on this computer, and what leaves it." />

      <div className="space-y-8">
        <Section title="What leaves this computer">
          <Card className="space-y-3 p-5 md:p-6">
            <p className="max-w-[56ch] text-body text-ink-secondary">
              Email: your documents stay on this machine. To write a reply, Desk sends the message it's answering
              and the few lines it pulled from your files. Nothing else is uploaded, and nothing is used to
              train a model.
            </p>
            <p className="max-w-[56ch] text-body text-ink-secondary">
              Finance: nothing. The finance screens don't connect to a bank or to any service.{" "}
              {source === "import"
                ? "The figures you see come from files you imported, which are read on this computer and never uploaded."
                : "The figures you see are sample data. If you import your own files they're read on this computer and never uploaded."}
            </p>
          </Card>
        </Section>

        <Section title="Where things are kept">
          <Card className="p-5 md:p-6">
            <p className="max-w-[56ch] text-body text-ink-secondary">
              Your email app password is held in this computer's keychain. Everything else, including your
              categories, notes, drafts and any accounts and transactions you import, is stored in a database file on this computer.
              It isn't encrypted by ZeraphDesk, so anyone who can open your user account on this computer can read it.
            </p>
          </Card>
        </Section>
      </div>
    </div>
  );
}
