import { type Action, ACTION_LABELS } from "../lib/actions";

export function History({ actions }: { actions: Action[] }) {
  if (actions.length === 0) {
    return (
      <div className="mx-auto max-w-[60ch] pt-24 text-center">
        <h1 className="font-display text-4xl text-ink">Nothing sent yet</h1>
        <p className="mt-3 text-sm text-ink-soft">
          Everything you approve shows up here, with what it was answering.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-4xl text-ink">Sent</h1>
      <ul className="mt-8 divide-y divide-paper-edge">
        {actions.map((a) => (
          <li key={a.id} className="flex items-baseline gap-3 py-4">
            <span className="text-sm text-ink">{ACTION_LABELS[a.kind]}</span>
            <span className="max-w-[60ch] truncate text-sm text-ink-soft">{a.rationale}</span>
            <span className="ml-auto text-xs text-ink-soft">
              {a.status === "declined" ? "Skipped" : "Sent"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
