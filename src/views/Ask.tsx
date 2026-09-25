import { useState } from "react";
import { ArrowUp, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/PageHeader";
import { BasisTag } from "@/components/finance/parts";
import { SUGGESTED_QUESTIONS, type Answer } from "@/lib/finance/ask";
import type { TxFilters } from "@/lib/finance/filters";
import type { ViewKey } from "@/nav";

export interface Asked {
  id: string;
  at: string;
  answer: Answer;
}

function AnswerCard({
  item,
  onOpen,
  onAsk,
}: {
  item: Asked;
  onOpen: (view: ViewKey, filters?: Partial<TxFilters>) => void;
  onAsk: (question: string) => void;
}) {
  const a = item.answer;
  return (
    <Card as="article" aria-label={`Answer to: ${a.question}`} className="p-6 max-md:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-label font-normal text-ink-tertiary">
          <span className="sr-only">You asked: </span>
          {a.question.trim() || "(empty question)"}
        </p>
        {a.answered && <BasisTag basis={a.basis} />}
      </div>

      <h2 className="mt-2 text-heading text-ink">{a.headline}</h2>
      {a.paragraphs.map((p) => (
        <p key={p} className="mt-2 max-w-[70ch] text-body text-ink-secondary">
          {p}
        </p>
      ))}

      {a.facts.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 md:grid-cols-3">
          {a.facts.map((f) => (
            <div key={f.label}>
              <dt className="text-label text-ink-tertiary">{f.label}</dt>
              <dd className="mt-0.5 text-body font-medium tabular-nums text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {a.table && (
        <div className="mt-4 overflow-x-auto border-t border-line pt-4">
          <table className="w-full min-w-[360px] text-body">
            <caption className="mb-2 text-left text-label text-ink-tertiary">{a.table.title ?? "The figures"}</caption>
            <thead>
              <tr className="text-left text-label text-ink-tertiary">
                {a.table.columns.map((col, i) => (
                  <th key={col} scope="col" className={"pb-2 font-medium " + (i > 0 ? "text-right" : "")}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {a.table.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) =>
                    i === 0 ? (
                      <th key={i} scope="row" className="py-2 pr-3 text-left font-medium text-ink">
                        {cell}
                      </th>
                    ) : (
                      <td key={i} className="py-2 text-right text-ink">
                        {cell}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {a.used.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="text-label text-ink-tertiary">Based on</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-label font-normal text-ink-secondary">
            {a.used.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}

      {a.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-meta text-ink-tertiary">
          {a.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {a.links.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {a.links.map((l) => (
            <Button key={l.label} variant="secondary" size="sm" onClick={() => onOpen(l.view, l.filters)}>
              {l.label}
            </Button>
          ))}
        </div>
      )}

      {!a.answered && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-label text-ink-tertiary">Things I can answer</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.slice(0, 5).map((q) => (
              <li key={q}>
                <Suggestion q={q} onAsk={onAsk} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Suggestion({ q, onAsk }: { q: string; onAsk: (question: string) => void }) {
  return (
    <button
      onClick={() => onAsk(q)}
      className="rounded-full border border-line bg-surface px-3 py-1.5 text-label font-normal text-ink-secondary transition-colors duration-150 ease-standard hover:bg-surface-hover hover:text-ink"
    >
      {q}
    </button>
  );
}

export function Ask({
  history,
  ready,
  onAsk,
  onOpen,
}: {
  history: Asked[];
  ready: boolean;
  onAsk: (question: string) => void;
  onOpen: (view: ViewKey, filters?: Partial<TxFilters>) => void;
}) {
  const [text, setText] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !ready) return;
    onAsk(text.trim());
    setText("");
  }

  return (
    <div>
      <PageHeader title="Ask ZeraphDesk" description="Ask about your own numbers. Every answer shows what it used." />

      <form onSubmit={submit} className="flex items-center gap-2">
        <label htmlFor="ask-input" className="sr-only">
          Your question
        </label>
        <Input
          id="ask-input"
          autoComplete="off"
          autoFocus
          className="h-11 flex-1 text-body"
          placeholder="Where did most of my money go this month?"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" variant="primary" className="h-11 w-11 px-0" disabled={!text.trim() || !ready} aria-label="Ask">
          <ArrowUp className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </Button>
      </form>

      <div className="mt-3 flex items-start gap-2 px-1 text-meta text-ink-tertiary">
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <p>Answers are worked out on this computer from your data. Your question and your numbers aren't sent anywhere.</p>
      </div>

      {history.length === 0 ? (
        <section aria-label="Suggested questions" className="mt-8">
          <h2 className="mb-2 px-1 text-label text-ink-tertiary">Try asking</h2>
          <Card>
            <ul className="divide-y divide-line">
              {SUGGESTED_QUESTIONS.map((q) => (
                <li key={q}>
                  <button
                    onClick={() => onAsk(q)}
                    disabled={!ready}
                    className="w-full px-5 py-3 text-left text-body text-ink-secondary transition-colors duration-150 ease-standard hover:bg-surface-secondary hover:text-ink disabled:opacity-50"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : (
        <div className="mt-6 space-y-4" aria-live="polite">
          {history.map((item) => (
            <AnswerCard key={item.id} item={item} onOpen={onOpen} onAsk={onAsk} />
          ))}
        </div>
      )}
    </div>
  );
}
