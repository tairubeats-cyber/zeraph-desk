import type { FinancialDataProvider } from "./types";
import { generateSample } from "./sample";
import { toISODate } from "./money";

/**
 * The built-in provider. It invents data and says so: `origin: "sample"` is
 * what makes every screen show the sample-data notice. It is not a bank
 * connection and must never be presented as one.
 */
export const sampleProvider: FinancialDataProvider = {
  id: "sample",
  name: "Sample data",
  origin: "sample",
  async load() {
    return generateSample(toISODate(new Date()));
  },
};

/**
 * The provider the app reads from. When a real one exists (a bank-data
 * aggregator behind our proxy, a CSV import) it replaces this line. Nothing
 * else changes, because everything downstream reads `FinancialSnapshot`.
 */
export const activeProvider: FinancialDataProvider = sampleProvider;
