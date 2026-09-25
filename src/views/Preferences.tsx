import { useId } from "react";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/PageHeader";
import { MoneyInput } from "@/components/finance/inputs";
import type { Intel } from "@/lib/finance/useIntel";
import { DETECTORS, NOTIFICATION_CATEGORIES, type DetectorId, type NotificationCategory } from "@/lib/finance/prefs";

function Row({
  title,
  description,
  control,
}: {
  title: string;
  description: string;
  control: (labelId: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <li className="flex items-center gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p id={id} className="text-body font-medium text-ink">
          {title}
        </p>
        <p className="text-label font-normal text-ink-tertiary">{description}</p>
      </div>
      {control(id)}
    </li>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="px-1 text-label text-ink-tertiary">
        {title}
      </h2>
      {hint && <p className="mb-2 mt-0.5 max-w-[70ch] px-1 text-meta text-ink-tertiary">{hint}</p>}
      <Card className={hint ? "" : "mt-2"}>
        <ul className="divide-y divide-line">{children}</ul>
      </Card>
    </section>
  );
}

export function Preferences({ intel }: { intel: Intel }) {
  const { prefs } = intel;
  const setNotify = (key: NotificationCategory, on: boolean) => void intel.savePrefs({ ...prefs, notify: { ...prefs.notify, [key]: on } });
  const setWatch = (key: DetectorId, on: boolean) => void intel.savePrefs({ ...prefs, watch: { ...prefs.watch, [key]: on } });

  return (
    <div>
      <PageHeader title="Preferences" description="What ZeraphDesk watches, and which notifications you get." />

      <div className="space-y-8">
        <Section
          title="Notifications"
          hint="Turning a category off stops it from appearing in your notifications. ZeraphDesk still notices things and lists them in the Action Center."
        >
          {NOTIFICATION_CATEGORIES.map((c) => (
            <Row
              key={c.key}
              title={c.label}
              description={c.live ? c.description : `${c.description} Nothing produces these yet.`}
              control={(labelId) => (
                <Switch aria-labelledby={labelId} checked={prefs.notify[c.key]} disabled={!c.live} onChange={(on) => setNotify(c.key, on)} />
              )}
            />
          ))}
        </Section>

        <Section title="Thresholds" hint="Used by the checks below. Nothing here changes your accounts.">
          <Row
            title="Cash reserve"
            description="The checking balance you'd like to stay above. Leave it empty to only be told about going below zero."
            control={(labelId) => (
              <MoneyInput
                aria-labelledby={labelId}
                className="w-36"
                placeholder="None"
                value={prefs.reserveCents}
                onCommit={(cents) => void intel.savePrefs({ ...prefs, reserveCents: cents })}
              />
            )}
          />
          <Row
            title="Bill reminders"
            description="How far ahead to mention a bill that isn't on autopay."
            control={(labelId) => (
              <Select
                aria-labelledby={labelId}
                className="w-40"
                value={String(prefs.billLeadDays)}
                onChange={(e) => void intel.savePrefs({ ...prefs, billLeadDays: Number(e.target.value) })}
              >
                {[0, 1, 2, 3, 5, 7, 14].map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? "Only on the day" : d === 1 ? "1 day ahead" : `${d} days ahead`}
                  </option>
                ))}
              </Select>
            )}
          />
        </Section>

        <Section title="What ZeraphDesk watches" hint="Switch off anything you don't want checked at all. It won't appear in the Action Center or in notifications.">
          {DETECTORS.map((d) => (
            <Row
              key={d.id}
              title={d.label}
              description={d.description}
              control={(labelId) => <Switch aria-labelledby={labelId} checked={prefs.watch[d.id]} onChange={(on) => setWatch(d.id, on)} />}
            />
          ))}
        </Section>

        <p className="max-w-[70ch] px-1 text-meta text-ink-tertiary">
          Changes in balances, investments and debt can't be watched yet, because ZeraphDesk doesn't keep balance history.
          They'll appear here when it does.
        </p>
      </div>
    </div>
  );
}
