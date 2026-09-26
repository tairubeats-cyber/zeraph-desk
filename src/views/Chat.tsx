import { useEffect, useRef, useState } from "react";
import { ArrowUp, CircleAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/PageHeader";
import { BasisTag } from "@/components/finance/parts";
import { MAX_QUESTION_CHARS, NEVER_SENT, sentText } from "@/lib/finance/aiChat";
import type { Chat as ChatState, ChatMessage } from "@/lib/finance/useChat";
import type { ViewKey } from "@/nav";

const EXAMPLES = [
  "What stands out in my spending over the last few months?",
  "Am I on track for my goals?",
  "Which of my debts is costing me the most?",
  "Is there anything in my numbers I should look at more closely?",
];

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .filter((p) => p.trim())
        .map((p, i) => (
          <p key={i} className="mt-2 max-w-[70ch] whitespace-pre-line text-body text-ink-secondary first:mt-0">
            {p.trim()}
          </p>
        ))}
    </>
  );
}

function Message({ m }: { m: ChatMessage }) {
  if (m.role === "user") {
    return (
      <div className="flex flex-col items-end">
        <p className="max-w-[85%] rounded-card bg-accent-soft px-4 py-2.5 text-body text-ink">
          <span className="sr-only">You asked: </span>
          {m.content}
        </p>
        {m.sent && (
          <p className="mt-1 max-w-[85%] text-meta text-ink-tertiary">
            Sent with: {m.sent.length ? m.sent.map((s) => s.toLowerCase()).join(", ") : "your question only"}
          </p>
        )}
      </div>
    );
  }
  return (
    <Card as="article" aria-label="Claude's reply" className="p-5 md:p-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-label text-ink-tertiary">Claude</p>
        <BasisTag basis="insight" />
      </div>
      <Paragraphs text={m.content} />
      {m.unconfirmed.length > 0 && (
        <p role="note" className="mt-4 flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2 text-label font-normal text-ink">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" strokeWidth={1.75} aria-hidden="true" />
          <span>
            Check {m.unconfirmed.length === 1 ? "this figure" : "these figures"}: {m.unconfirmed.join(", ")}. {m.unconfirmed.length === 1 ? "It wasn't" : "They weren't"} among the figures sent, so
            {m.unconfirmed.length === 1 ? " it" : " they"} may be Claude's own arithmetic or a guess.
          </span>
        </p>
      )}
      <p className="mt-4 border-t border-line pt-3 text-meta text-ink-tertiary">
        An AI's reading of the summary you sent. It can be wrong and isn't financial advice. The figures on your other screens are the ones to rely on.
      </p>
    </Card>
  );
}

function Intro({ chat, onOpen }: { chat: ChatState; onOpen: (view: ViewKey) => void }) {
  const sample = chat.summary?.sample;
  return (
    <Card className="p-6 max-md:p-5">
      <h2 className="text-heading text-ink">Talk through your finances with Claude</h2>
      <p className="mt-2 max-w-[62ch] text-body text-ink-secondary">
        Ask Claude open questions about your numbers and get a plain-language answer. It's a language model, so it can be wrong; every reply is labelled that way. Ask ZeraphDesk, the other screen, answers a fixed set of questions on this computer and sends nothing.
      </p>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <section aria-label="What is sent">
          <h3 className="text-label text-ink-tertiary">What is sent, only when you press Send</h3>
          <ul className="mt-2 space-y-2">
            <li className="text-body text-ink-secondary">
              <span className="font-medium text-ink">Your question</span> and the earlier messages in this chat
            </li>
            {chat.summary ? (
              chat.summary.sections.map((s) => (
                <li key={s.key} className="text-body text-ink-secondary">
                  <span className="font-medium text-ink">{s.title}.</span> {s.about}
                </li>
              ))
            ) : (
              <li className="text-body text-ink-tertiary">Loading your finances…</li>
            )}
          </ul>
          <p className="mt-2 text-label font-normal text-ink-tertiary">Totals and balances only. You can leave any part out of a message.</p>
        </section>
        <section aria-label="What is never sent">
          <h3 className="text-label text-ink-tertiary">What is never sent</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-body text-ink-secondary">
            {NEVER_SENT.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <h3 className="mt-4 text-label text-ink-tertiary">Where it goes</h3>
          <p className="mt-1 text-body text-ink-secondary">
            To Zeraph's service, which passes it to Claude and returns the reply. Zeraph's service counts the tokens used for each seat and doesn't keep the text. This chat is kept in memory only and is gone when you close ZeraphDesk. How long Anthropic, which runs Claude, keeps what it receives is up to Anthropic's own terms, not ZeraphDesk.
          </p>
        </section>
      </div>

      <div className="mt-5 flex items-start gap-2 rounded-control bg-surface-secondary px-3 py-2.5 text-label font-normal text-ink-secondary">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <p>Before each message you'll see exactly what would be sent, and nothing leaves until you press Send. It's off until you turn it on, and you can turn it off at any time.</p>
      </div>

      {sample && <p className="mt-3 text-label font-normal text-ink-tertiary">You're looking at sample data right now, so what would be sent is invented, not yours.</p>}

      {chat.seat === false && (
        <p role="note" className="mt-4 flex items-start gap-2 text-body text-ink-secondary">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.75} aria-hidden="true" />
          <span>
            AI chat needs your seat token, the same one Desk uses to write drafts.{" "}
            <button onClick={() => onOpen("connections")} className="font-medium text-accent underline underline-offset-2">
              Add it under Connections
            </button>
            .
          </span>
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={!chat.seat || !chat.ready} onClick={() => void chat.setEnabled(true)}>
          Turn on AI chat
        </Button>
        <Button variant="tertiary" onClick={() => onOpen("ask")}>
          Use Ask ZeraphDesk instead
        </Button>
      </div>
    </Card>
  );
}

function Review({ chat }: { chat: ChatState }) {
  const { request, summary, excluded } = chat;
  if (!request || !summary) return null;
  const text = sentText(request);
  const earlier = request.messages.length - 1;
  return (
    <Card as="section" aria-labelledby="review-title" className="border-accent p-5 md:p-6">
      <h2 id="review-title" className="text-heading text-ink">
        Review before sending
      </h2>
      <p className="mt-1 max-w-[62ch] text-body text-ink-secondary">Nothing has been sent yet. This is exactly what will go to Claude when you press Send.</p>

      <p className="mt-4 text-label text-ink-tertiary">Your question</p>
      <p className="mt-0.5 text-body text-ink">{request.messages[request.messages.length - 1].content}</p>
      {earlier > 0 && <p className="mt-1 text-label font-normal text-ink-tertiary">The {earlier} earlier messages in this chat go with it, so Claude has the context.</p>}

      <fieldset className="mt-4">
        <legend className="text-label text-ink-tertiary">Parts of your finances to include</legend>
        <ul className="mt-2 space-y-2">
          {summary.sections.map((s) => (
            <li key={s.key}>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-accent"
                  checked={!excluded.has(s.key)}
                  disabled={chat.busy}
                  onChange={() => chat.toggleSection(s.key)}
                />
                <span className="min-w-0">
                  <span className="block text-body font-medium text-ink">{s.title}</span>
                  <span className="block text-label font-normal text-ink-tertiary">{s.about}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {summary.sections.length === 0 && <p className="mt-2 text-label font-normal text-ink-tertiary">There's nothing in your finances to include yet, so only your question goes.</p>}
      </fieldset>

      {summary.sample && <p className="mt-3 text-label font-normal text-ink-secondary">This is sample data. Claude is told it's an example, not yours.</p>}

      <details className="mt-4 rounded-control border border-line">
        <summary className="cursor-pointer px-3 py-2 text-label text-ink">Show the exact text ({text.length.toLocaleString("en-US")} characters)</summary>
        <pre tabIndex={0} aria-label="The exact text that will be sent" className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-line px-3 py-2 font-mono text-meta text-ink-secondary">
          {request.system}
          {request.messages.map((m) => `\n\n[${m.role === "user" ? "You" : "Claude"}] ${m.content}`).join("")}
        </pre>
      </details>

      {chat.error && (
        <p role="alert" className="mt-4 flex items-start gap-2 text-body text-danger">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          {chat.error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="primary" loading={chat.busy} onClick={() => void chat.send()}>
          Send to Claude
        </Button>
        {chat.busy ? (
          <Button variant="secondary" onClick={chat.stop}>
            Stop
          </Button>
        ) : (
          <Button variant="tertiary" onClick={chat.cancelReview}>
            Cancel
          </Button>
        )}
      </div>
    </Card>
  );
}

export function Chat({ chat, onOpen }: { chat: ChatState; onOpen: (view: ViewKey) => void }) {
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const { refreshSeat } = chat;

  // The seat token may have been added under Connections since this was last open.
  useEffect(() => {
    void refreshSeat();
  }, [refreshSeat]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [chat.messages.length, chat.reviewing]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !chat.ready) return;
    chat.review(text);
    setText("");
  }

  return (
    <div>
      <PageHeader
        title="AI chat"
        description="Talk through your finances with Claude. You see exactly what's sent before every message."
        actions={
          chat.enabled ? (
            <>
              <Button variant="tertiary" size="sm" disabled={chat.messages.length === 0 && !chat.reviewing} onClick={chat.clear}>
                Clear chat
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void chat.setEnabled(false)}>
                Turn off
              </Button>
            </>
          ) : undefined
        }
      />

      {!chat.enabled ? (
        <Intro chat={chat} onOpen={onOpen} />
      ) : (
        <div>
          {chat.messages.length === 0 && !chat.reviewing && (
            <section aria-label="Ideas for a first question">
              <h2 className="mb-2 px-1 text-label text-ink-tertiary">Try asking</h2>
              <Card>
                <ul className="divide-y divide-line">
                  {EXAMPLES.map((q) => (
                    <li key={q}>
                      <button
                        onClick={() => chat.review(q)}
                        disabled={!chat.ready}
                        className="w-full px-5 py-3 text-left text-body text-ink-secondary transition-colors duration-150 ease-standard hover:bg-surface-secondary hover:text-ink disabled:opacity-50"
                      >
                        {q}
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
              <p className="mt-2 px-1 text-meta text-ink-tertiary">Choosing one only opens the review step. Nothing is sent until you press Send there.</p>
            </section>
          )}

          <div className="space-y-4" aria-live="polite">
            {chat.messages.map((m) => (
              <Message key={m.id} m={m} />
            ))}
          </div>

          {chat.reviewing && (
            <div className="mt-4">
              <Review chat={chat} />
            </div>
          )}

          {!chat.reviewing && (
            <form onSubmit={submit} className="mt-4 flex items-center gap-2">
              <label htmlFor="chat-input" className="sr-only">
                Your message to Claude
              </label>
              <Input
                id="chat-input"
                autoComplete="off"
                autoFocus
                maxLength={MAX_QUESTION_CHARS}
                className="h-11 flex-1 text-body"
                placeholder={chat.messages.length ? "Ask a follow-up" : "Ask about your money"}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <Button type="submit" variant="primary" className="h-11 gap-1.5 px-4" disabled={!text.trim() || !chat.ready}>
                Review
                <ArrowUp className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              </Button>
            </form>
          )}
          {!chat.reviewing && <p className="mt-2 px-1 text-meta text-ink-tertiary">Pressing Review shows what would be sent. Nothing is sent until you press Send.</p>}
          <div ref={end} />
        </div>
      )}
    </div>
  );
}
