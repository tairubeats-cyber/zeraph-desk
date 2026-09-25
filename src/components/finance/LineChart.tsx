import { useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

export interface ChartSeries {
  name: string;
  /** One value in cents per label. */
  values: number[];
  tone?: "accent" | "muted";
  dashed?: boolean;
}

const COMPACT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const compact = (cents: number) => (cents < 0 ? `−${COMPACT.format(Math.abs(cents) / 100)}` : COMPACT.format(cents / 100));

/** How many rows the screen-reader table gets: enough to follow the shape, not every day of five years. */
const TABLE_ROWS = 12;

/**
 * A line chart drawn as SVG lines inside a plain layout, with axis text in
 * HTML so it stays crisp and scales with the page. Hover (or touch) shows the
 * values for a day. The visible chart is decoration for people who can see it;
 * the table after it carries the same numbers for everyone else.
 */
export function LineChart({
  labels,
  series,
  xLabels,
  caption,
  format = (c) => formatMoney(c),
  zeroLine = false,
  height = 208,
}: {
  /** What each point is called, for the tooltip and the table ("Sep 25, 2026"). */
  labels: string[];
  series: ChartSeries[];
  /** Where to put labels along the bottom. */
  xLabels: { index: number; text: string }[];
  /** Describes the chart for people who can't see it. */
  caption: string;
  format?: (cents: number) => string;
  /** Mark zero with a dashed line when the values cross it. The axis always fits the data, not zero. */
  zeroLine?: boolean;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const n = labels.length;

  const geometry = useMemo(() => {
    const all = series.flatMap((s) => s.values);
    // Fit the data. Stretching the axis down to zero would flatten a line that only moves a few percent.
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    if (hi === lo) {
      hi += 1;
      lo -= 1;
    }
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    const x = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
    const y = (v: number) => 100 - ((v - lo) / (hi - lo)) * 100;
    return { lo, hi, x, y };
  }, [series, n, zeroLine]);

  if (n === 0) return null;
  const { lo, hi, x, y } = geometry;

  const path = (values: number[]) => values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const first = series[0];
  const area = `${path(first.values)} L${x(n - 1).toFixed(2)},100 L${x(0).toFixed(2)},100 Z`;

  function move(e: React.PointerEvent) {
    const box = plot.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const t = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    setHover(Math.round(t * (n - 1)));
  }

  const rows = Array.from({ length: Math.min(TABLE_ROWS, n) }, (_, k) => Math.round((k * (n - 1)) / Math.max(1, Math.min(TABLE_ROWS, n) - 1)));
  const ticks = [hi, (hi + lo) / 2, lo];

  return (
    <figure>
      {series.length > 1 && (
        <figcaption className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-ink-tertiary">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn("h-0.5 w-4 rounded-full", s.tone === "muted" ? "bg-ink-tertiary" : "bg-accent", s.dashed && "opacity-60")}
              />
              {s.name}
            </span>
          ))}
        </figcaption>
      )}

      <div className="flex gap-2" style={{ height }} aria-hidden="true">
        <div className="flex w-14 shrink-0 flex-col justify-between whitespace-nowrap text-right text-meta tabular-nums text-ink-tertiary">
          {ticks.map((t, i) => (
            <span key={i} className={i === 0 ? "-mt-1" : i === 2 ? "-mb-1" : ""}>
              {compact(t)}
            </span>
          ))}
        </div>

        <div
          ref={plot}
          className="relative min-w-0 flex-1 touch-pan-y select-none"
          onPointerMove={move}
          onPointerDown={move}
          onPointerLeave={() => setHover(null)}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            {[0, 50, 100].map((g) => (
              <line key={g} x1="0" x2="100" y1={g} y2={g} className="text-line" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {zeroLine && lo < 0 && hi > 0 && (
              <line x1="0" x2="100" y1={y(0)} y2={y(0)} className="text-ink-tertiary" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            )}
            <path d={area} className="text-accent" fill="currentColor" fillOpacity="0.07" stroke="none" />
            {series.map((s) => (
              <path
                key={s.name}
                d={path(s.values)}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.dashed ? "5 4" : undefined}
                vectorEffect="non-scaling-stroke"
                className={s.tone === "muted" ? "text-ink-tertiary" : "text-accent"}
              />
            ))}
          </svg>

          {hover !== null && (
            <>
              <div className="pointer-events-none absolute inset-y-0 w-px bg-line-strong" style={{ left: `${x(hover)}%` }} />
              {series.map((s) => (
                <div
                  key={s.name}
                  className={cn(
                    "pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface",
                    s.tone === "muted" ? "bg-ink-tertiary" : "bg-accent",
                  )}
                  style={{ left: `${x(hover)}%`, top: `${y(s.values[hover])}%` }}
                />
              ))}
              <div
                className="pointer-events-none absolute top-0 z-10 w-max max-w-[14rem] rounded-lg bg-hud px-2.5 py-1.5 text-meta text-hud-text shadow-elevated"
                style={{
                  left: `${x(hover)}%`,
                  transform: `translateX(${hover / Math.max(1, n - 1) > 0.65 ? "calc(-100% - 10px)" : "10px"})`,
                }}
              >
                <p>{labels[hover]}</p>
                {series.map((s) => (
                  <p key={s.name} className="tabular-nums">
                    {series.length > 1 ? `${s.name}: ` : ""}
                    {format(s.values[hover])}
                  </p>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div aria-hidden="true" className="relative ml-16 mt-2 h-4 text-meta text-ink-tertiary">
        {xLabels.map((l) => {
          const at = x(l.index);
          return (
            <span
              key={`${l.index}-${l.text}`}
              className="absolute whitespace-nowrap"
              style={{
                left: `${at}%`,
                transform: at < 8 ? "none" : at > 92 ? "translateX(-100%)" : "translateX(-50%)",
              }}
            >
              {l.text}
            </span>
          );
        })}
      </div>

      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {series.map((s) => (
              <th scope="col" key={s.name}>
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i}>
              <th scope="row">{labels[i]}</th>
              {series.map((s) => (
                <td key={s.name}>{format(s.values[i])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
