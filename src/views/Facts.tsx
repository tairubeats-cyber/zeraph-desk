import { useState } from "react";
import type { BusinessFacts } from "../lib/facts";

interface Props {
  facts: BusinessFacts;
  onSave: (facts: BusinessFacts) => void;
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
    <div className="mt-8">
      <label className="text-sm font-medium text-ink">{label}</label>
      <p className="mt-1 max-w-[62ch] text-sm text-ink-soft">{help}</p>
      <textarea
        value={value.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n"))}
        rows={5}
        className="mt-2 w-full max-w-[72ch] rounded-md border border-paper-edge bg-white px-4 py-3 text-sm leading-relaxed"
      />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-ink">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-paper-edge bg-white px-3 py-2 text-sm"
      />
    </div>
  );
}

export function Facts({ facts, onSave }: Props) {
  const [draft, setDraft] = useState<BusinessFacts>(facts);
  const set = <K extends keyof BusinessFacts>(key: K, value: BusinessFacts[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="max-w-[72ch] pb-24">
      <h1 className="font-display text-4xl text-ink">Your business</h1>
      <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-ink-soft">
        Everything Desk knows when it writes for you. The more exact the pricing, the less you'll
        edit. It stays on this computer; only the lines needed for a reply are sent when a draft is
        written.
      </p>

      <div className="mt-10 grid grid-cols-2 gap-4">
        <Field label="Business name" value={draft.name} onChange={(v) => set("name", v)} />
        <Field label="Your name" value={draft.ownerName} onChange={(v) => set("ownerName", v)} />
        <Field label="Phone" value={draft.phone} onChange={(v) => set("phone", v)} />
        <Field
          label="Sign off as"
          value={draft.signOff}
          onChange={(v) => set("signOff", v)}
          placeholder="— Sam"
        />
        <Field
          label="Service area"
          value={draft.serviceArea}
          onChange={(v) => set("serviceArea", v)}
          placeholder="Union and Essex County"
        />
        <Field
          label="Hours"
          value={draft.hours}
          onChange={(v) => set("hours", v)}
          placeholder="Mon–Fri 7–5, Sat mornings"
        />
      </div>

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

      <div className="mt-8">
        <label className="text-sm font-medium text-ink">Anything else</label>
        <textarea
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={6}
          className="mt-2 w-full rounded-md border border-paper-edge bg-white px-4 py-3 text-sm leading-relaxed"
        />
      </div>

      <button
        onClick={() => onSave(draft)}
        className="mt-8 rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy-900 hover:bg-gold-deep hover:text-paper"
      >
        Save
      </button>
    </div>
  );
}
