import { createContext, useContext } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

type AskFn = (question: string) => void;

const AskContext = createContext<AskFn>(() => undefined);

/** Lets any screen hand a question to Ask ZeraphDesk without threading a callback through every view. */
export const AskProvider = AskContext.Provider;
export const useAsk = () => useContext(AskContext);

/**
 * A quiet "Ask about this" button for a screen's header. The question it asks
 * is spelled out on the button's tooltip, so it's clear what will be asked.
 */
export function AskLink({ label, question }: { label: string; question: string }) {
  const ask = useAsk();
  return (
    <Button variant="tertiary" onClick={() => ask(question)} title={question}>
      <Sparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      {label}
    </Button>
  );
}
