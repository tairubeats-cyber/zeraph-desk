import { useState } from "react";
import { Flag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select";
import { BasisTag, CategoryGlyph } from "./parts";
import { merchantStats } from "@/lib/finance/analysis";
import { formatMoney, parseISODate } from "@/lib/finance/money";
import type { Finance } from "@/lib/finance/useFinance";
import type { ResolvedTransaction } from "@/lib/finance/types";

const longDate = (iso: string) =>
  parseISODate(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

/**
 * One transaction, editable. Side panel on wide windows, a bottom sheet below
 * that (the classes do the switch; the parent renders the backdrop).
 */
export function TransactionDetail({
  tx,
  finance,
  accountName,
  onClose,
}: {
  tx: ResolvedTransaction;
  finance: Finance;
  accountName: string;
  onClose: () => void;
}) {
  const { categories, categoriesById, transactions } = finance;
  const [note, setNote] = useState(tx.note);

  // Hidden categories can't be picked, but stay selectable if this transaction already has one.
  const options = categories.filter((c) => !c.hidden || c.id === tx.categoryId);
  const merchant = merchantStats(transactions, tx.merchant);
  const siblings = transactions.filter((t) => t.merchant === tx.merchant && t.id !== tx.id && t.categoryId !== tx.categoryId);

  return (
    <Card
      as="section"
      aria-label="Transaction details"
      className="max-h-[85vh] overflow-y-auto rounded-b-none p-5 shadow-elevated lg:max-h-none lg:rounded-card lg:shadow-card"
    >
      <div className="flex items-start gap-3">
        <CategoryGlyph categoryId={tx.categoryId} className="h-11 w-11" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-heading text-ink">{tx.merchant}</h2>
          <p className="text-label font-normal text-ink-tertiary">{longDate(tx.date)}</p>
        </div>
        <Button variant="tertiary" size="sm" onClick={onClose} aria-label="Close details" className="-mr-2 -mt-1 w-8 px-0">
          <X className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </div>

      <p className={"mt-4 text-title tabular-nums " + (tx.amountCents > 0 ? "text-success" : "text-ink")}>
        {formatMoney(tx.amountCents, { cents: true, signed: true })}
      </p>

      <dl className="mt-4 space-y-2 text-body">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-tertiary">Account</dt>
          <dd className="text-right text-ink">{accountName}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-tertiary">Statement line</dt>
          <dd className="break-words text-right text-ink">{tx.description}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-tertiary">Status</dt>
          <dd className="text-ink">{tx.pending ? "Pending" : "Posted"}</dd>
        </div>
      </dl>

      <div className="mt-5 space-y-4 border-t border-line pt-5">
        <SelectField
          label="Category"
          value={tx.categoryId}
          onChange={(e) => void finance.setCategory([tx.id], e.target.value)}
        >
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>

        {siblings.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            className="h-auto whitespace-normal py-2 text-left"
            onClick={() =>
              void finance.setCategory(
                siblings.map((t) => t.id),
                tx.categoryId,
              )
            }
          >
            Use {categoriesById.get(tx.categoryId)?.name ?? "this category"} for {siblings.length} other {tx.merchant}{" "}
            {siblings.length === 1 ? "transaction" : "transactions"}
          </Button>
        )}

        <div>
          <label htmlFor="tx-note" className="text-label text-ink">
            Note
          </label>
          <Textarea
            id="tx-note"
            rows={3}
            className="mt-1.5"
            placeholder="Add a note only you can see"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if (note !== tx.note) void finance.setNote(tx.id, note);
            }}
          />
        </div>

        <Button
          variant="secondary"
          size="sm"
          aria-pressed={tx.flagged}
          onClick={() => void finance.setFlagged(tx.id, !tx.flagged)}
        >
          <Flag className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          {tx.flagged ? "Remove review mark" : "Mark for review"}
        </Button>
      </div>

      {merchant && (
        <div className="mt-5 border-t border-line pt-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-label text-ink">About {tx.merchant}</h3>
            <BasisTag basis="calculation" />
          </div>
          <dl className="mt-2 space-y-2 text-body">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-tertiary">Transactions</dt>
              <dd className="tabular-nums text-ink">{merchant.count}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-tertiary">
                {merchant.spentCents >= 0 ? "Paid" : "Received"} since{" "}
                {parseISODate(merchant.firstDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </dt>
              <dd className="tabular-nums text-ink">{formatMoney(Math.abs(merchant.spentCents), { cents: true })}</dd>
            </div>
          </dl>
        </div>
      )}
    </Card>
  );
}
