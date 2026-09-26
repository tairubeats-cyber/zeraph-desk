import { useEffect, useRef, useState } from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { SUGGESTED_QUESTIONS } from "@/lib/finance/ask";

/**
 * The Ask box that opens from anywhere with the keyboard shortcut. It's a
 * modal dialog: focus starts in the field, Tab stays inside it, Escape closes
 * it and returns to where you were.
 */
export function AskPalette({
  open,
  onClose,
  onAsk,
}: {
  open: boolean;
  onClose: () => void;
  onAsk: (question: string) => void;
}) {
  const [text, setText] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement;
    setText("");
    input.current?.focus();
    return () => {
      if (returnTo.current instanceof HTMLElement) returnTo.current.focus();
    };
  }, [open]);

  // Escape closes it wherever focus has ended up: clicking a blank spot inside the dialog moves focus to the page.
  useEffect(() => {
    if (!open) return;
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open, onClose]);

  if (!open) return null;

  const q = text.trim().toLowerCase();
  const suggestions = SUGGESTED_QUESTIONS.filter((s) => !q || s.toLowerCase().includes(q)).slice(0, 6);

  function submit(question: string) {
    if (!question.trim()) return;
    onClose();
    onAsk(question.trim());
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>("input, button") ?? [])].filter((el) => !el.hasAttribute("disabled"));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]" onKeyDown={onKeyDown}>
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/30 animate-fade-in" />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Ask ZeraphDesk"
        className="relative w-full max-w-xl overflow-hidden rounded-card border border-line bg-surface-elevated shadow-elevated animate-view-in"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
          className="flex items-center gap-3 border-b border-line px-4 py-3"
        >
          <Sparkles className="h-4 w-4 shrink-0 text-ink-tertiary" strokeWidth={1.75} aria-hidden="true" />
          <label htmlFor="palette-input" className="sr-only">
            Ask ZeraphDesk
          </label>
          <input
            id="palette-input"
            ref={input}
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ask about your money…"
            className="min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-ink-tertiary focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Ask"
            disabled={!text.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-opacity duration-150 disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </form>
        <ul className="max-h-72 overflow-y-auto py-1">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                onClick={() => submit(s)}
                className="w-full px-4 py-2.5 text-left text-body text-ink-secondary transition-colors duration-150 ease-standard hover:bg-surface-secondary hover:text-ink"
              >
                {s}
              </button>
            </li>
          ))}
          {suggestions.length === 0 && <li className="px-4 py-3 text-label font-normal text-ink-tertiary">Press Enter to ask this as written.</li>}
        </ul>
        <p className="border-t border-line px-4 py-2 text-meta text-ink-tertiary">
          Answers come from your data on this computer. Nothing is sent anywhere.
        </p>
      </div>
    </div>
  );
}
