#!/usr/bin/env node
// Usage: node tools/simulate.mjs [count=5] [intervalMs=3000]
// Appends fake hand-backs, findings and user messages to docs/metrics/*.jsonl, to test live dashboard updates.
import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "docs", "metrics");
const [count = 5, interval = 3000] = process.argv.slice(2).map(Number);
const roles = ["implementer", "reviewer", "test-engineer", "visual-reviewer"];
const at = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const add = (f, o) => appendFileSync(join(dir, f), JSON.stringify(o) + "\n");
mkdirSync(dir, { recursive: true });

let i = 0;
const tick = () => {
  const n = i++;
  add("ledger.jsonl", { at: at(), round: "2", role: roles[n % roles.length], pkg: `R2-sim-${n}`, model: "sonnet",
    tokens: { input: 1000 * (n + 1), output: 300, cacheRead: 5000, cacheWrite: 500 }, minutes: 1 + n / 2, status: "done", schemaVersion: 1 });
  if (n % 2) add("findings.jsonl", { at: at(), round: "2", source: "review", id: `F-${n}`, severity: n % 3 ? "minor" : "major", summary: `fake finding ${n}`, status: "open", file: "index.html", schemaVersion: 1 });
  if (n % 3 === 2) add("human-log.jsonl", { at: at(), kind: "question", text: `fake question ${n}` });
  console.log(`event ${n + 1}/${count}`);
  if (i < count) setTimeout(tick, interval);
};
tick();
