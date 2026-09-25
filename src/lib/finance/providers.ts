import { db } from "../db";
import type { Connection, FinancialDataProvider, FinancialSnapshot, Institution } from "./types";
import { generateSample } from "./sample";
import { guessCategory } from "./csv";
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

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";

/**
 * What the person imported from their bank's files. It's real data they
 * supplied, so it isn't labelled as sample, but it isn't a bank connection
 * either: balances are what they entered (or what the file's balance column
 * said) and nothing updates until they import again.
 */
export const importedProvider: FinancialDataProvider = {
  id: "import",
  name: "Imported files",
  origin: "provider",
  async load(): Promise<FinancialSnapshot> {
    const [accounts, transactions, balances, imports] = await Promise.all([
      db.srcAccounts(),
      db.srcTransactions(),
      db.srcBalances(),
      db.srcImports(),
    ]);

    const institutions = new Map<string, Institution>();
    for (const a of accounts) {
      const id = `inst-${slug(a.institution)}`;
      if (!institutions.has(id)) institutions.set(id, { id, name: a.institution.trim() || "Unnamed institution" });
    }

    const lastFor = (institutionId: string): string | null => {
      const ids = new Set(accounts.filter((a) => `inst-${slug(a.institution)}` === institutionId).map((a) => a.id));
      const stamps = [...imports.filter((i) => ids.has(i.accountId)).map((i) => i.at), ...accounts.filter((a) => ids.has(a.id)).map((a) => a.createdAt)];
      return stamps.sort().pop() ?? null;
    };
    const connections: Connection[] = [...institutions.values()].map((i) => ({
      id: `conn-${i.id}`,
      institutionId: i.id,
      status: "imported",
      origin: "provider",
      lastSyncedAt: lastFor(i.id),
    }));

    return {
      institutions: [...institutions.values()],
      connections,
      accounts: accounts.map((a) => ({
        id: a.id,
        institutionId: `inst-${slug(a.institution)}`,
        connectionId: `conn-inst-${slug(a.institution)}`,
        name: a.name,
        kind: a.kind,
        mask: a.mask,
        balanceCents: a.balanceCents,
      })),
      // A category the file named wins; otherwise a first guess from the words on the line, which the person can change.
      transactions: transactions.map((t) => ({ ...t, categoryHint: t.categoryHint ?? guessCategory(t.description, t.amountCents) })),
      balanceHistory: balances,
      // Holdings and deposits aren't in a transaction export, so investment accounts show a balance and nothing finer.
      positions: [],
      investmentActivity: [],
    };
  },
};

/**
 * The provider the app reads from: the person's imported data once they've
 * added an account, otherwise the sample. A bank-data aggregator would slot in
 * here as another provider; nothing downstream reads anything but `FinancialSnapshot`.
 */
export async function pickProvider(): Promise<FinancialDataProvider> {
  return (await db.srcAccountCount()) > 0 ? importedProvider : sampleProvider;
}
