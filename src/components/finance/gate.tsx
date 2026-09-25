import type { ReactNode } from "react";
import type { Finance } from "@/lib/finance/useFinance";
import type { Plans } from "@/lib/finance/usePlans";
import { LoadFailed, LoadingBlock } from "./parts";

/**
 * What to show instead of a money-management screen while its data isn't
 * ready or failed to load; null once both are ready. Views call it after all
 * their hooks, so the hook order never changes.
 */
export function gate(finance: Finance, plans: Plans): ReactNode | null {
  if (finance.status === "error" || plans.status === "error") {
    return (
      <LoadFailed
        message={finance.error ?? plans.error ?? ""}
        onRetry={() => {
          void finance.reload();
          void plans.reload();
        }}
      />
    );
  }
  if (!finance.snapshot || plans.status === "loading") return <LoadingBlock label="Loading…" />;
  return null;
}
