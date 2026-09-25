import type { ReactNode } from "react";
import type { Finance } from "@/lib/finance/useFinance";
import { LoadFailed, LoadingBlock } from "./parts";

/** Anything that loads asynchronously: the finance snapshot, plans, planning data. */
interface Source {
  status: "loading" | "ready" | "error";
  error: string | null;
  reload: () => unknown;
}

/**
 * What to show instead of a finance screen while its data isn't ready or
 * failed to load; null once all of it is ready. Views call it after all their
 * hooks, so the hook order never changes.
 */
export function gate(finance: Finance, ...others: Source[]): ReactNode | null {
  const sources: Source[] = [finance, ...others];
  const failed = sources.find((s) => s.status === "error");
  if (failed) {
    return (
      <LoadFailed
        message={failed.error ?? ""}
        onRetry={() => {
          for (const s of sources) void s.reload();
        }}
      />
    );
  }
  if (!finance.snapshot || others.some((s) => s.status === "loading")) return <LoadingBlock label="Loading…" />;
  return null;
}
