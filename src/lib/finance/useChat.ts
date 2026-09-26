import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db, newEvent } from "../db";
import { ApiError, generate } from "../claude";
import type { Intel } from "./useIntel";
import {
  buildRequest,
  buildSummary,
  describeFailure,
  sentText,
  unconfirmedFigures,
  type ChatTurn,
  type SectionKey,
} from "./aiChat";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  /** Dollar figures in a reply that weren't among the figures that were sent. */
  unconfirmed: string[];
  /** For a question: which parts of the summary went with it. */
  sent?: string[];
}

/** How long to wait for a reply before giving up. */
export const REPLY_TIMEOUT_MS = 60_000;

/**
 * State for the AI chat screen. The chat lives in memory only: closing ZeraphDesk forgets it. A message is sent
 * only by `send()`, which the screen calls from the Send button after showing exactly what would go.
 */
export function useChat(intel: Intel) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<SectionKey>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seat, setSeat] = useState<boolean | null>(null);
  const abort = useRef<AbortController | null>(null);

  const enabled = intel.prefs.aiChat;
  const ctx = intel.askContext;
  const summary = useMemo(() => (ctx ? buildSummary(ctx) : null), [ctx]);

  const earlier: ChatTurn[] = useMemo(() => messages.map((m) => ({ role: m.role, content: m.content })), [messages]);
  /** Exactly what a send would post. The screen shows this, so what's shown is what goes. */
  const request = useMemo(() => (summary && reviewing ? buildRequest(summary, earlier, reviewing, excluded) : null), [summary, reviewing, earlier, excluded]);

  const refreshSeat = useCallback(async () => {
    setSeat(!!(await db.seatToken().catch(() => null)));
  }, []);

  useEffect(() => {
    void refreshSeat();
  }, [refreshSeat]);

  const review = useCallback((question: string) => {
    if (!question.trim()) return;
    setError(null);
    setReviewing(question.trim());
  }, []);

  const cancelReview = useCallback(() => {
    abort.current?.abort();
    setReviewing(null);
    setError(null);
  }, []);

  const toggleSection = useCallback((key: SectionKey) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /** Stop a message that is on its way. */
  const stop = useCallback(() => abort.current?.abort(), []);

  const send = useCallback(async () => {
    if (!request || !summary || busy || !enabled) return;
    const req = request;
    const included = summary.sections.filter((s) => !excluded.has(s.key)).map((s) => s.title);
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abort.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REPLY_TIMEOUT_MS);
    try {
      const token = await db.seatToken();
      if (!token) {
        setSeat(false);
        setError("There's no seat token yet. Add it under Connections, then send again.");
        return;
      }
      const reply = await generate({ system: req.system, messages: req.messages, maxTokens: req.maxTokens, signal: controller.signal }, token);
      if (!reply) {
        setError("Claude sent back an empty reply. You can send it again.");
        return;
      }
      const at = new Date().toISOString();
      const question = req.messages[req.messages.length - 1].content;
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", content: question, at, unconfirmed: [], sent: included },
        { id: crypto.randomUUID(), role: "assistant", content: reply, at, unconfirmed: unconfirmedFigures(reply, sentText(req)) },
      ]);
      setReviewing(null);
      // Counts only: what was asked and answered is never written to the log.
      await db.log(newEvent("ai_message_sent", null, { chars: sentText(req).length, sections: included.length })).catch(() => undefined);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined;
      setError(describeFailure({ status, timedOut, cancelled: !timedOut && err instanceof DOMException && err.name === "AbortError" }));
    } finally {
      clearTimeout(timer);
      abort.current = null;
      setBusy(false);
    }
  }, [request, summary, busy, enabled, excluded]);

  const clear = useCallback(() => {
    abort.current?.abort();
    setMessages([]);
    setReviewing(null);
    setError(null);
  }, []);

  const setEnabled = useCallback(
    async (on: boolean) => {
      if (!on) clear();
      await intel.savePrefs({ ...intel.prefs, aiChat: on });
      await db.log(newEvent("ai_chat_changed", null, { on: on ? 1 : 0 })).catch(() => undefined);
    },
    [intel, clear],
  );

  return { enabled, seat, refreshSeat, summary, messages, reviewing, request, excluded, busy, error, ready: ctx !== null, review, cancelReview, toggleSection, send, stop, clear, setEnabled };
}

export type Chat = ReturnType<typeof useChat>;
