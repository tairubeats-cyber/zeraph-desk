import { formatMoney, monthLabel } from "@/lib/finance/money";
import type { Flow } from "@/lib/finance/analysis";
import { cn } from "@/lib/utils";

export interface FlowMonth extends Flow {
  month: string;
}

/**
 * Income against spending, month by month. Plain divs rather than SVG so it
 * scales with the layout and text stays crisp. The table is for screen
 * readers; the bars are for everyone else.
 */
export function CashFlowChart({ months, currentMonth }: { months: FlowMonth[]; currentMonth: string }) {
  const max = Math.max(1, ...months.flatMap((m) => [m.incomeCents, m.spendingCents]));
  const height = (cents: number) => (cents <= 0 ? "0%" : `${Math.max(2, (cents / max) * 100)}%`);

  return (
    <figure>
      <figcaption className="mb-3 flex items-center gap-4 text-meta text-ink-tertiary">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-accent" /> Income
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-chart-muted" /> Spending
        </span>
      </figcaption>

      <div aria-hidden="true" className="flex h-40 items-end gap-2 border-b border-line max-md:gap-1">
        {months.map((m) => (
          <div
            key={m.month}
            title={`${monthLabel(m.month)}: income ${formatMoney(m.incomeCents)}, spending ${formatMoney(m.spendingCents)}`}
            className="flex h-full flex-1 items-end justify-center gap-1"
          >
            <div className="w-full max-w-[22px] rounded-t-md bg-accent" style={{ height: height(m.incomeCents) }} />
            <div className="w-full max-w-[22px] rounded-t-md bg-chart-muted" style={{ height: height(m.spendingCents) }} />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="mt-2 flex gap-2 max-md:gap-1">
        {months.map((m) => (
          <div
            key={m.month}
            className={cn(
              "flex-1 text-center text-meta",
              m.month === currentMonth ? "font-medium text-ink" : "text-ink-tertiary",
            )}
          >
            {monthLabel(m.month, "short")}
          </div>
        ))}
      </div>

      <table className="sr-only">
        <caption>Income and spending by month</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Income</th>
            <th>Spending</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <td>{monthLabel(m.month)}</td>
              <td>{formatMoney(m.incomeCents)}</td>
              <td>{formatMoney(m.spendingCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
