import { useState } from "react";
import type { BusinessFacts } from "../lib/facts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TextAreaField, TextField } from "@/components/ui/field";
import { PageHeader } from "../components/PageHeader";

interface Props {
  facts: BusinessFacts;
  onSave: (facts: BusinessFacts) => void | Promise<void>;
}

function Lines({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <Card className="p-5 md:p-6">
      <TextAreaField
        label={label}
        help={help}
        value={value.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n"))}
        rows={5}
      />
    </Card>
  );
}

export function Facts({ facts, onSave }: Props) {
  const [draft, setDraft] = useState<BusinessFacts>(facts);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof BusinessFacts>(key: K, value: BusinessFacts[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const dirty = JSON.stringify(draft) !== JSON.stringify(facts);

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Your business"
        description="Everything Desk knows when it writes for you. The more exact the pricing, the less you'll edit. It stays on this computer; only the lines needed for a reply are sent when a draft is written."
      />

      <div className="space-y-4">
        <Card className="p-5 md:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Business name" value={draft.name} onChange={(e) => set("name", e.target.value)} />
            <TextField
              label="Your name"
              value={draft.ownerName}
              onChange={(e) => set("ownerName", e.target.value)}
            />
            <TextField label="Phone" type="tel" value={draft.phone} onChange={(e) => set("phone", e.target.value)} />
            <TextField
              label="Sign off as"
              value={draft.signOff}
              onChange={(e) => set("signOff", e.target.value)}
              placeholder="— Sam"
            />
            <TextField
              label="Service area"
              value={draft.serviceArea}
              onChange={(e) => set("serviceArea", e.target.value)}
              placeholder="Union and Essex County"
            />
            <TextField
              label="Hours"
              value={draft.hours}
              onChange={(e) => set("hours", e.target.value)}
              placeholder="Mon–Fri 7–5, Sat mornings"
            />
          </div>
        </Card>

        <Lines
          label="What you do"
          help="One service per line, in the words you'd use with a customer."
          value={draft.services}
          onChange={(v) => set("services", v)}
        />
        <Lines
          label="What it costs"
          help="Ranges are fine and better than nothing. One per line: the job, then the range, then what changes it."
          value={draft.pricing}
          onChange={(v) => set("pricing", v)}
        />
        <Lines
          label="What you turn down"
          help="Work you don't take. Desk will decline it politely instead of booking you into it."
          value={draft.wontDo}
          onChange={(v) => set("wontDo", v)}
        />
        <Lines
          label="Policies"
          help="Deposits, warranty, lead time, financing — anything a reply might need to say."
          value={draft.policies}
          onChange={(v) => set("policies", v)}
        />

        <Card className="p-5 md:p-6">
          <TextAreaField
            label="Anything else"
            value={draft.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={6}
          />
        </Card>
      </div>

      <div className="sticky bottom-0 -mx-4 mt-6 flex items-center justify-end gap-4 border-t border-line bg-glass px-4 py-3 backdrop-blur-md md:-mx-8 md:px-8">
        <p aria-live="polite" className="text-label font-normal text-ink-tertiary">
          {dirty ? "Unsaved changes" : ""}
        </p>
        <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}
