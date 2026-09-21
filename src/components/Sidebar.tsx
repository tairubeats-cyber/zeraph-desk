export type ViewKey = "queue" | "history" | "facts" | "settings";

interface Props {
  current: ViewKey;
  pendingCount: number;
  onSelect: (view: ViewKey) => void;
}

const ITEMS: { key: ViewKey; label: string }[] = [
  { key: "queue", label: "Waiting on you" },
  { key: "history", label: "Sent" },
  { key: "facts", label: "Your business" },
  { key: "settings", label: "Settings" },
];

export function Sidebar({ current, pendingCount, onSelect }: Props) {
  return (
    <nav className="flex h-full w-60 shrink-0 flex-col bg-navy-900 px-3 py-6 text-paper">
      <div className="px-3 pb-8">
        <div className="font-display text-2xl leading-none text-paper">Zeraph</div>
        <div className="mt-1 text-xs text-navy-600">Desk</div>
      </div>

      <ul className="space-y-1">
        {ITEMS.map((item) => {
          const active = item.key === current;
          return (
            <li key={item.key}>
              <button
                onClick={() => onSelect(item.key)}
                aria-current={active ? "page" : undefined}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${
                  active ? "bg-navy-700 text-paper" : "text-paper/70 hover:bg-navy-800 hover:text-paper"
                }`}
              >
                <span>{item.label}</span>
                {item.key === "queue" && pendingCount > 0 && (
                  <span className="rounded-full bg-gold px-2 py-0.5 text-xs font-medium text-navy-900">
                    {pendingCount}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto px-3 text-xs leading-relaxed text-navy-600">
        Nothing sends until you approve it.
      </div>
    </nav>
  );
}
