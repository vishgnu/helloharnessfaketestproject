#!/usr/bin/env node
// Usage: node tools/simulate.mjs [count=5] [intervalMs=3000]
//        node tools/simulate.mjs --ack [--delay ms=1500] [--result done|refused|n/a] [--once] [--target <project root>]
// --ack plays the orchestrator for steering: it watches docs/metrics/steering.jsonl and, `delay` ms after it first sees a
// command without an ack, appends {type:"ack", id, at, by:"orchestrator", result}. Runs until stopped; --once exits as soon as
// it has acked everything it saw.
// Appends fake hand-backs, findings and user messages to docs/metrics/*.jsonl, to test live dashboard updates.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`), opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const root = opt("target", join(dirname(fileURLToPath(import.meta.url)), "..")); // --target <project root>: act on another copy (tests use a temp copy)
const dir = join(root, "docs", "metrics");
const [count = 5, interval = 3000] = argv.filter((a, i) => /^\d+$/.test(a) && !String(argv[i - 1] ?? "").startsWith("--")).map(Number);
const roles = ["implementer", "reviewer", "test-engineer", "visual-reviewer"];
const at = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const add = (f, o) => appendFileSync(join(dir, f), JSON.stringify(o) + "\n");
mkdirSync(dir, { recursive: true });

if (flag("ack")) {
  const delay = Number(opt("delay", 1500)), result = opt("result", "done"), file = join(dir, "steering.jsonl");
  const seen = new Map(); // command id -> time first seen
  const read = () => { try { return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
  const pass = () => {
    const rows = read(), acked = new Set(rows.filter((r) => r.type === "ack").map((r) => r.id));
    let n = 0;
    for (const c of rows.filter((r) => r.type !== "ack" && r.kind && r.id && !acked.has(r.id))) {
      if (!seen.has(c.id)) seen.set(c.id, Date.now());
      if (Date.now() - seen.get(c.id) >= delay) { add("steering.jsonl", { type: "ack", id: c.id, at: at(), by: "orchestrator", result, schemaVersion: 1 }); console.log(`acked ${c.id} (${c.kind}) ${result}`); n++; }
    }
    if (flag("once") && n && ![...seen.keys()].some((id) => !read().some((r) => r.type === "ack" && r.id === id))) process.exit(0);
  };
  console.log(`ack mode: watching ${file}, delay ${delay} ms`);
  setInterval(pass, 200);
} else {
let i = 0;
const tick = () => {
  const n = i++;
  add("ledger.jsonl", { at: at(), round: "2", role: roles[n % roles.length], pkg: `R2-sim-${n}`, model: "sonnet",
    tokens: { input: 1000 * (n + 1), output: 300, cacheRead: 5000, cacheWrite: 500 }, minutes: 1 + n / 2, status: "done", schemaVersion: 1 });
  if (n % 2) add("findings.jsonl", { at: at(), round: "2", source: "review", id: `F-${n}`, severity: n % 3 ? "low" : "medium", summary: `fake finding ${n}`, status: "open", file: "index.html", schemaVersion: 1 });
  if (n % 3 === 2) add("human-log.jsonl", { at: at(), kind: "question", text: `fake question ${n}` });
  console.log(`event ${n + 1}/${count}`);
  if (i < count) setTimeout(tick, interval);
};
tick();
}
