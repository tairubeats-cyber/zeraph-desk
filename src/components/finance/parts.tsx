import {
  ArrowLeftRight,
  Car,
  CircleDollarSign,
  Clapperboard,
  Flag,
  HeartPulse,
  House,
  Info,
  Landmark,
  Plane,
  Repeat,
  ShoppingBag,
  ShoppingBasket,
  StickyNote,
  Tag,
  TrendingUp,
  Umbrella,
  UtensilsCrossed,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { formatMoney, parseISODate } from "@/lib/finance/money";
import type { Basis, Category, ResolvedTransaction } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** What kind of statement a figure is. The four kinds are never allowed to look alike. */
const BASIS: Record<Basis, { label: string; hint: string }> = {
  fact: { label: "Fact", hint: "reported directly by your accounts" },
  calculation: { label: "Calculation", hint: "arithmetic on your account data" },
  projection: { label: "Projection", hint: "a forecast built on assumptions" },
  insight: { label: "AI insight", hint: "an interpretation generated from your data" },
  scenario: { label: "Scenario", hint: "a hypothetical, not a prediction" },
};

export function BasisTag({ basis }: { basis: Basis }) {
  const b = BASIS[basis];
  return (
    <span className="inline-flex h-5 items-center rounded-full bg-surface-secondary px-2 text-meta font-medium text-ink-tertiary">
      {b.label}
      <span className="sr-only">: {b.hint}</span>
    </span>
  );
}

/** Shown on every finance screen while the data is the built-in sample. */
export function SampleNotice({ onOpenAccounts }: { onOpenAccounts?: () => void }) {
  return (
    <div
      role="note"
      className="mb-6 flex items-start gap-3 rounded-card border border-line bg-surface-secondary px-4 py-3 text-body text-ink-secondary"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" strokeWidth={1.75} aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-medium text-ink">Sample data.</span> No accounts are connected, so every balance and
        transaction here is invented for you to try things out.
        {onOpenAccounts && (
          <>
            {" "}
            <button onClick={onOpenAccounts} className="rounded text-accent underline-offset-2 hover:underline">
              See accounts
            </button>
          </>
        )}
      </p>
    </div>
  );
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  housing: House,
  transportation: Car,
  food: ShoppingBasket,
  dining: UtensilsCrossed,
  shopping: ShoppingBag,
  entertainment: Clapperboard,
  healthcare: HeartPulse,
  travel: Plane,
  subscriptions: Repeat,
  utilities: Zap,
  insurance: Umbrella,
  debt: Landmark,
  investments: TrendingUp,
  income: CircleDollarSign,
  transfers: ArrowLeftRight,
};

/** A quiet glyph for a category. Custom categories all get the tag. */
export function CategoryGlyph({ categoryId, className }: { categoryId: string; className?: string }) {
  const Icon = CATEGORY_ICONS[categoryId] ?? Tag;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-ink-secondary",
        className,
      )}
    >
      <Icon className="h-[17px] w-[17px]" strokeWidth={1.6} />
    </span>
  );
}

/** Money with tabular figures. Inflows read in the success colour; that's meaning, not decoration. */
export function Amount({
  cents,
  showCents = true,
  className,
}: {
  cents: number;
  showCents?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("tabular-nums", cents > 0 && "text-success", className)}>
      {formatMoney(cents, { cents: showCents, signed: true })}
    </span>
  );
}

const shortDate = (iso: string) => parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function TransactionRow({
  tx,
  category,
  accountName,
  selected = false,
  showDate = false,
  onSelect,
}: {
  tx: ResolvedTransaction;
  category: Category | undefined;
  accountName: string;
  selected?: boolean;
  /** Show the date in the second line; lists that aren't grouped by day need it. */
  showDate?: boolean;
  onSelect?: (tx: ResolvedTransaction) => void;
}) {
  const body = (
    <>
      <CategoryGlyph categoryId={tx.categoryId} />
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-body font-medium text-ink">{tx.merchant}</span>
          {tx.pending && (
            <span className="shrink-0 rounded-full bg-surface-secondary px-1.5 text-meta text-ink-tertiary">
              Pending
            </span>
          )}
          {tx.flagged && (
            <>
              <Flag className="h-3.5 w-3.5 shrink-0 text-warning" strokeWidth={1.75} aria-hidden="true" />
              <span className="sr-only">Marked for review</span>
            </>
          )}
          {tx.note && (
            <>
              <StickyNote className="h-3.5 w-3.5 shrink-0 text-ink-tertiary" strokeWidth={1.75} aria-hidden="true" />
              <span className="sr-only">Has a note</span>
            </>
          )}
        </span>
        <span className="block truncate text-label font-normal text-ink-tertiary">
          {showDate && `${shortDate(tx.date)} · `}
          {category?.name ?? "Other"} · {accountName}
        </span>
      </span>
      <Amount cents={tx.amountCents} className="shrink-0 text-body font-medium" />
    </>
  );

  const base = "flex w-full items-center gap-3 px-4 py-3";
  if (!onSelect) return <div className={base}>{body}</div>;
  return (
    <button
      onClick={() => onSelect(tx)}
      aria-pressed={selected}
      className={cn(
        base,
        "transition-colors duration-150 ease-standard hover:bg-surface-secondary aria-pressed:bg-accent-soft",
      )}
    >
      {body}
    </button>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div role="status" className="py-24 text-center text-body text-ink-tertiary">
      {label}
    </div>
  );
}

export function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="mx-auto mt-16 max-w-md p-6 text-center">
      <h1 className="text-heading text-ink">Couldn't load your finances</h1>
      <p role="alert" className="mt-2 text-body text-ink-tertiary">
        {message}
      </p>
      <Button className="mt-4" onClick={onRetry}>
        Try again
      </Button>
    </Card>
  );
}
