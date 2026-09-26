// Runs every tests/*.test.ts: bundles it with esbuild (so it can import from src/ as the app does) and runs it under node.
// Usage: npm test            (all suites)
//        npm test -- csv     (only suites whose name contains "csv")
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const only = process.argv[2];
const dir = "tests";
const suites = readdirSync(dir).filter((f) => f.endsWith(".test.ts") && (!only || f.includes(only)));
const out = mkdtempSync(join(tmpdir(), "zeraph-tests-"));
let failed = 0;
let checks = 0;

for (const file of suites) {
  const outfile = join(out, file.replace(/\.ts$/, ".cjs"));
  await build({ entryPoints: [join(dir, file)], bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error" });
  const run = spawnSync(process.execPath, [outfile], { encoding: "utf8" });
  const lines = (run.stdout || "").split("\n");
  const ok = lines.filter((l) => l.startsWith("ok")).length;
  const bad = lines.filter((l) => l.startsWith("FAIL"));
  checks += ok + bad.length;
  const pass = run.status === 0 && bad.length === 0;
  console.log((pass ? "PASS " : "FAIL ") + file.replace(".test.ts", "").padEnd(22) + (ok + bad.length) + " checks");
  if (!pass) {
    failed++;
    for (const l of bad) console.log("   " + l);
    if (run.stderr) console.log(run.stderr.split("\n").slice(0, 6).map((l) => "   " + l).join("\n"));
  }
}
rmSync(out, { recursive: true, force: true });
console.log("\n" + (failed ? failed + " of " + suites.length + " suites failed" : "all " + suites.length + " suites passed") + " (" + checks + " checks)");
process.exit(failed ? 1 : 0);
