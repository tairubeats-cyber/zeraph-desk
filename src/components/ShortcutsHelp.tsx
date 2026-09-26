import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { shortcutGroups } from "@/lib/shortcuts";

/** Ctrl on Windows and Linux, ⌘ on a Mac. */
export const modifierName = () => (typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform) ? "⌘" : "Ctrl");

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-line bg-surface-secondary px-1.5 font-sans text-meta font-medium text-ink">
      {children}
    </kbd>
  );
}

/**
 * The list of keyboard shortcuts. A modal dialog like Ask: focus moves in, Tab stays inside, Escape closes it and
 * returns to where you were. Opens with "?".
 */
export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement;
    close.current?.focus();
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

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    // The only control is the close button, so Tab has nowhere else to go.
    e.preventDefault();
    close.current?.focus();
  }

  const groups = shortcutGroups(modifierName());

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[8vh]" onKeyDown={onKeyDown}>
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 animate-fade-in bg-black/30" />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="relative max-h-[84vh] w-full max-w-2xl animate-view-in overflow-y-auto rounded-card border border-line bg-surface-elevated p-6 shadow-elevated"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="shortcuts-title" className="text-heading text-ink">
              Keyboard shortcuts
            </h2>
            <p className="mt-1 text-label font-normal text-ink-secondary">They don't work while you're typing in a field, and never take over copy, paste or find.</p>
          </div>
          <button
            ref={close}
            onClick={onClose}
            aria-label="Close the list of shortcuts"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors duration-150 hover:bg-surface-secondary"
          >
            <X className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 space-y-6">
          {groups.map((g) => {
            const chord = g.rows[0]?.keys[0] === "g";
            return (
              <section key={g.title} aria-label={g.title}>
                <h3 className="text-label text-ink-tertiary">{g.title}</h3>
                <ul className={chord ? "mt-2 grid gap-x-8 gap-y-1 sm:grid-cols-2" : "mt-2 space-y-1"}>
                  {g.rows.map((r) => (
                    <li key={r.keys.join("+") + r.label} className="flex items-center justify-between gap-3 py-1">
                      <span className="text-body text-ink">{r.label}</span>
                      <span className="flex shrink-0 items-center gap-1 text-meta text-ink-tertiary" aria-label={r.keys.join(chord ? " then " : " plus ")}>
                        {r.keys.map((k, i) => (
                          <span key={i} className="flex items-center gap-1" aria-hidden="true">
                            {i > 0 && (chord ? "then" : "+")}
                            <Kbd>{k}</Kbd>
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
