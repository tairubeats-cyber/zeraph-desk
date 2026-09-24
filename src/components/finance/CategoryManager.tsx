import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { CategoryGlyph } from "./parts";
import { FALLBACK_CATEGORY_ID } from "@/lib/finance/categories";
import type { Finance } from "@/lib/finance/useFinance";
import type { CategoryKind } from "@/lib/finance/types";

const KINDS: Record<CategoryKind, string> = {
  expense: "Spending",
  income: "Income",
  transfer: "Not counted (transfers)",
};

/** Add, rename and hide categories. Nothing is deleted: transactions keep pointing at their category. */
export function CategoryManager({ finance }: { finance: Finance }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CategoryKind>("expense");
  const [error, setError] = useState<string | null>(null);

  function add(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError("Give the category a name.");
    if (finance.categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      return setError("You already have a category with that name.");
    }
    setError(null);
    void finance.addCategory(trimmed, kind);
    setName("");
  }

  return (
    <Card as="section" aria-label="Categories" className="mb-4 p-5">
      <h2 className="text-heading text-ink">Categories</h2>
      <p className="mt-1 max-w-[62ch] text-body text-ink-tertiary">
        Rename them, hide the ones you don't use, or add your own. Transfers aren't counted as income or spending.
      </p>

      <ul className="mt-4 grid gap-x-6 gap-y-1 md:grid-cols-2">
        {finance.categories.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-1">
            <CategoryGlyph categoryId={c.id} className="h-8 w-8" />
            <Input
              key={c.name}
              aria-label={`Name of ${c.name}`}
              defaultValue={c.name}
              className={"min-w-0 flex-1 " + (c.hidden ? "text-ink-tertiary" : "")}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (!next) e.target.value = c.name;
                else if (next !== c.name) void finance.saveCategory({ ...c, name: next });
              }}
            />
            <span className="hidden w-16 shrink-0 text-meta text-ink-tertiary xl:block">
              {c.kind === "expense" ? "Spending" : c.kind === "income" ? "Income" : "Transfer"}
            </span>
            <Button
              variant="tertiary"
              size="sm"
              className="w-8 shrink-0 px-0"
              disabled={c.id === FALLBACK_CATEGORY_ID}
              aria-label={c.hidden ? `Show ${c.name}` : `Hide ${c.name}`}
              title={c.id === FALLBACK_CATEGORY_ID ? "Other catches uncategorised transactions, so it stays." : undefined}
              onClick={() => void finance.saveCategory({ ...c, hidden: !c.hidden })}
            >
              {c.hidden ? (
                <EyeOff className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              )}
            </Button>
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="mt-4 flex flex-wrap items-start gap-2 border-t border-line pt-4">
        <div className="min-w-[180px] flex-1">
          <Input
            aria-label="New category name"
            placeholder="New category"
            value={name}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          {error && (
            <p role="alert" className="mt-1.5 text-label text-danger">
              {error}
            </p>
          )}
        </div>
        <Select aria-label="What it counts as" className="w-56" value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
          {Object.entries(KINDS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="primary">
          Add category
        </Button>
      </form>
    </Card>
  );
}
