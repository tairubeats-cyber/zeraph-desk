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
 * What the person brought in themselves: accounts they added and filled from their bank's files, and accounts
 * they chose to link through SimpleFIN Bridge. Both are real data, so neither is labelled sample. A file
 * account isn't a connection: its balance is what was entered (or the file's balance column said) and nothing
 * updates until they import again. A SimpleFIN account is: the bridge supplies its balance and transactions
 * each time the person syncs, and the connection is marked as needing attention when the last sync had a problem.
 */
export const importedProvider: FinancialDataProvider = {
  id: "import",
  name: "Your accounts",
  origin: "provider",
  async load(): Promise<FinancialSnapshot> {
    const [accounts, transactions, balances, imports, runs] = await Promise.all([
      db.srcAccounts(),
      db.srcTransactions(),
      db.srcBalances(),
      db.srcImports(),
      db.syncRuns(),
    ]);

    // One institution per name, one connection per institution and source, so a bank with a file account and a
    // linked account shows both honestly.
    const institutionId = (a: { institution: string }) => "inst-" + slug(a.institution);
    const connectionId = (a: { institution: string; provider: string | null }) => "conn-" + (a.provider ?? "file") + "-" + slug(a.institution);

    const institutions = new Map<string, Institution>();
    for (const a of accounts) {
      const id = institutionId(a);
      if (!institutions.has(id)) institutions.set(id, { id, name: a.institution.trim() || "Unnamed institution" });
    }

    const lastSync = runs.find((r) => r.kind === "sync" && r.ok) ?? null;
    const lastRun = runs.find((r) => r.kind === "sync") ?? null;
    const connections = new Map<string, Connection>();
    for (const a of accounts) {
      const id = connectionId(a);
      if (connections.has(id)) continue;
      if (a.provider === "simplefin") {
        const trouble = lastRun !== null && (!lastRun.ok || lastRun.message !== null);
        connections.set(id, {
          id,
          institutionId: institutionId(a),
          status: trouble ? "needs_attention" : "connected",
          origin: "provider",
          lastSyncedAt: lastSync?.at ?? null,
        });
      } else {
        const ids = new Set(accounts.filter((x) => connectionId(x) === id).map((x) => x.id));
        const stamps = [...imports.filter((i) => ids.has(i.accountId)).map((i) => i.at), ...accounts.filter((x) => ids.has(x.id)).map((x) => x.createdAt)];
        connections.set(id, { id, institutionId: institutionId(a), status: "imported", origin: "provider", lastSyncedAt: stamps.sort().pop() ?? null });
      }
    }

    return {
      institutions: [...institutions.values()],
      connections: [...connections.values()],
      accounts: accounts.map((a) => ({
        id: a.id,
        institutionId: institutionId(a),
        connectionId: connectionId(a),
        name: a.name,
        kind: a.kind,
        mask: a.mask,
        balanceCents: a.balanceCents,
      })),
      // A category the file named wins; otherwise a first guess from the words on the line, which the person can change.
      transactions: transactions.map((t) => ({ ...t, categoryHint: t.categoryHint ?? guessCategory(t.description, t.amountCents) })),
      balanceHistory: balances,
      // Holdings and deposits aren't in a transaction export or the bridge's reply, so investment accounts show a balance and nothing finer.
      positions: [],
      investmentActivity: [],
    };
  },
};

/**
 * The provider the app reads from: the person's own accounts (files and linked) once they've
 * added one, otherwise the sample. Nothing downstream reads anything but `FinancialSnapshot`.
 */
export async function pickProvider(): Promise<FinancialDataProvider> {
  return (await db.srcAccountCount()) > 0 ? importedProvider : sampleProvider;
}
