#!/usr/bin/env node
// Lifecycle simulator: plays the first phases of a harness project (Intake, Circles, Spec, Plan, Build, Accept)
// into a SEPARATE sibling project folder, in the real file formats, so the live dashboard can be watched.
// Usage: node tools/lifecycle.mjs [--target ../hello-lifecycle] [--speed 1] [--from intake] [--to accept] [--step]
// Fake data only. Node built-ins only. The fixture project itself is never touched.
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const PHASES = ["intake", "circles", "spec", "plan", "build", "accept"];
const TAB = { overview: "Dashboard", plan: "Plan", ledger: "Ledger", reviews: "Reviews", rounds: "Rounds" };
const HARNESS_VERSION = "0.6.0";
const MARKER = ".lifecycle-sim";

// ---- arguments ----
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const target = resolve(opt("target", "../hello-lifecycle"));
const speed = Number(opt("speed", "1"));
const from = PHASES.indexOf(opt("from", "intake")), to = PHASES.indexOf(opt("to", "accept"));
const stepMode = args.includes("--step");
if (!(speed > 0) || from < 0 || to < 0 || from > to) {
  console.error("usage: node tools/lifecycle.mjs [--target dir] [--speed n>0] [--from phase] [--to phase] [--step]\nphases: " + PHASES.join(", "));
  process.exit(2);
}

// ---- target folder: only an empty folder or one that carries the marker ----
if (existsSync(target)) {
  const entries = readdirSync(target);
  if (entries.length && !entries.includes(MARKER)) {
    console.error(`refused: ${target} is not empty and has no ${MARKER} marker`);
    process.exit(1);
  }
  for (const e of entries) if (e !== MARKER) rmSync(join(target, e), { recursive: true, force: true });
}
mkdirSync(target, { recursive: true });
writeFileSync(join(target, MARKER), "created by tools/lifecycle.mjs; safe to overwrite\n");

// ---- small helpers ----
const iso = (ms = Date.now()) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
const isoMin = (ms) => iso(ms).replace(/:\d\dZ$/, "Z"); // "2026-10-16T15:10Z" like the real RESUME block
const put = (rel, text) => { const p = join(target, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
const addLine = (rel, o) => { const p = join(target, rel); mkdirSync(dirname(p), { recursive: true }); appendFileSync(p, JSON.stringify({ ...o, schemaVersion: 1 }) + "\n"); };
const LEDGER = "docs/metrics/ledger.jsonl", HUMAN = "docs/metrics/human-log.jsonl", FINDINGS = "docs/metrics/findings.jsonl";
const hand = (round, role, pkg, status, k, minutes, extra) => addLine(LEDGER, {
  at: iso(), round, role, pkg, model: "sonnet", status, minutes,
  tokens: { input: 900 * k, output: 250 * k, cacheRead: 4000 * k, cacheWrite: 400 * k }, ...(extra ? { extra } : {}),
});
const human = (kind, text) => addLine(HUMAN, { at: iso(), kind, text });
// A finding keeps its id when its status changes (a correction is a new line with the same id; the latest wins).
const findingIds = new Map();
const finding = (round, source, severity, summary, status, file) => {
  if (!findingIds.has(summary)) findingIds.set(summary, `F-${findingIds.size + 1}`);
  const id = findingIds.get(summary);
  addLine(FINDINGS, { at: iso(), round, source, id, severity, summary, status, file });
  return id;
};
// R-D22 records: a decision-request is open until a `decision` with the same id exists; testruns.jsonl carries one line per suite run.
const DECISIONS = "docs/metrics/decisions.jsonl", TESTRUNS = "docs/metrics/testruns.jsonl";
const ask = (id, kind, question, o = {}) => addLine(DECISIONS, { type: "decision-request", id, at: iso(), kind, question, phase: S.phase, ...(S.round ? { round: S.round } : {}), ...o });
const answer = (id, text, o = {}) => addLine(DECISIONS, { type: "decision", id, at: iso(), answer: text, by: "user", ...o });
let runNo = 0;
const testrun = (suite, passed, failed, red, slice) => addLine(TESTRUNS, { at: iso(), id: `tr-${++runNo}`, suite, passed, failed, skipped: 0, ...(slice ? { slice } : {}), ...(red?.length ? { red } : {}), round: S.round || undefined });

// ---- STATE.md and SESSION-NOTES.md are rewritten from one small state object ----
const S = { phase: "Intake", round: "", note: "", waiting: [], where: "", inFlight: "nothing", next: "", resumeAt: null };
function sync() {
  // the dashboard reads "Phase: X. Round Y" (round only when the line is not bold)
  const head = S.round ? `Phase: ${S.phase}. Round ${S.round} in flight.` : `**Phase: ${S.phase}.**`;
  put("docs/product/STATE.md", `# STATE

Harness version: ${HARNESS_VERSION}

_Target: a tiny recipe box web page. Updated ${iso().slice(0, 10)}._

${head} ${S.note}

## Waiting for you

${S.waiting.length ? S.waiting.map((w, i) => `${i + 1}. ${w}`).join("\n") : "Nothing."}
`);
  put("docs/SESSION-NOTES.md", `# Session notes

## RESUME HERE
_Last updated ${isoMin(S.resumeAt ?? Date.now())}._

**Where we are:** ${S.where}
**In flight:** ${S.inFlight}
**Next steps:** ${S.next}
**Waiting for you:** ${S.waiting.length ? S.waiting.join("; ") : "nothing."}

---
`);
}

// ---- content ----
const CIRCLE_Q = [
  ["Who uses the recipe box?", "One person, on a phone or laptop, offline-first."],
  ["Where do recipes live?", "A single JSON file in the browser (localStorage), export as a file."],
  ["Search?", "Title and ingredient substring search, no ranking."],
  ["Photos per recipe?", "None in v1; text only."],
  ["Hosting?", "Static page on any host."],
];
const CIRCLE_FOLLOW = [
  ["Export format?", "JSON, one file, human readable."],
  ["Units (metric / imperial)?", "Free text, no conversion."],
  ["Tags or folders?", "Flat tags, comma separated."],
];
const ANSWER = ["Single user, offline", "localStorage, accept default", "Search: yes, accept default", "No photos", "Static page"];
const FOLLOW_ANSWER = ["JSON", "Free text", "Tags"];

function writeCircle(file, title, rows, answered, score) {
  put(`docs/product/circles/${file}`, `# ${title}

_Target: the recipe box. Status: **${answered.length === rows.length ? "answered" : "open"}**._

## Questions (answer, or say "accept all defaults")

| # | Question | Proposed default | Answer |
|---|---|---|---|
${rows.map((r, i) => `| ${file.slice(7, 9) === "01" ? "Q" : "F"}${i + 1} | ${r[0]} | ${r[1]} | ${answered[i] ?? "(open)"} |`).join("\n")}

## Readiness

Readiness: ${score} of 20 (threshold 16).
`);
}

const REQS = [
  ["R-1", "Add a recipe with title, ingredients and steps.", "AC-1-1: saving a recipe adds it to the list within 1 s."],
  ["R-2", "List all recipes, newest first.", "AC-2-1: the list shows title and tag chips."],
  ["R-3", "Edit and delete a recipe.", "AC-3-1: delete asks for confirmation."],
  ["R-4", "Search by title or ingredient.", "AC-4-1: typing filters the list on every key press."],
  ["R-5", "Tag recipes.", "AC-5-1: clicking a tag filters the list."],
  ["R-6", "Export all recipes as one JSON file.", "AC-6-1: the exported file imports back unchanged."],
  ["R-7", "Import a JSON file.", "AC-7-1: a malformed file shows an error and changes nothing."],
  ["R-8", "Works offline after the first load.", "AC-8-1: with the network off the page still opens."],
  ["R-9", "Keyboard use for add and search.", "AC-9-1: every control is reachable with Tab."],
  ["R-10", "Readable on a phone.", "AC-10-1: no horizontal scroll at 360 px width."],
  ["R-11", "Print view of one recipe.", "AC-11-1: the print view hides navigation."],
  ["R-12", "Remember the last search.", "AC-12-1: reload keeps the search text."],
];
const writeReqs = (n) => put("docs/product/20-requirements.md", `# 20 Requirements: recipe box

_Spec phase, ${iso().slice(0, 10)}. ${n} requirements so far._

${REQS.slice(0, n).map((r) => `## ${r[0]} ${r[1]}\n- ${r[2]}\n`).join("\n")}`);

const ADRS = [
  ["ADR-001-storage.md", "Storage in localStorage", "Recipes are one JSON array under one key. No backend."],
  ["ADR-002-no-framework.md", "No UI framework", "Plain ES modules and one HTML file keep the page under 50 kB."],
  ["ADR-003-offline.md", "Offline through a service worker", "One cache-first service worker; the cache name carries the version."],
];
const writeAdr = (i) => put(`docs/product/decisions/${ADRS[i][0]}`, `# ${ADRS[i][0].slice(0, 7)} ${ADRS[i][1]}\n\nStatus: proposed (architect, ${iso().slice(0, 10)}).\n\n## Decision\n${ADRS[i][2]}\n`);

const SLICES = {
  G1: ["Recipe store", ["Store module", "Add and list view", "Edit and delete"]],
  G2: ["Search and share", ["Search box", "Tags", "Export and import"]],
};
const PLAN = `# 50 Plan: recipe box

_Plan phase, ${iso().slice(0, 10)} (architect). Harness ${HARNESS_VERSION}._

${Object.entries(SLICES).map(([g, [title, sl]]) => `## Round ${g} ${title}

Goal: ${title.toLowerCase()} works end to end. Group demo: open the page and try it.

${sl.map((t, i) => `### ${g}-S${i + 1} ${t}\n- Goal: ${t.toLowerCase()}.\n- Size: S. Click: yes.\n`).join("\n")}`).join("\n")}`;

function writeReview() {
  put("docs/reviews/G1-review.md", `# G1 review (Recipe store)

Scope: G1-S1..G1-S3. Verdict: changes needed (no blocker).

## Findings

| id | sev | where | why | fix |
|---|---|---|---|---|
| G1-R01 | medium | store.js:42 | delete does not ask for confirmation (AC-3-1) | add confirm step |
| G1-R02 | low | list.js:17 | tag chips overflow at 360 px | wrap chips |
| G1-R03 | low | store.js:9 | storage key not versioned | add version suffix |
`);
}

// ---- the script: a flat list of steps ----
const steps = [];
const step = (phase, tab, text, fn) => steps.push({ phase: PHASES.indexOf(phase), tab, text, fn });

// Intake
step("intake", "overview", "project folder with the brief; the project appears in the picker", () => {
  put("docs/product/00-brief.md", `# 00 Brief: recipe box\n\nA tiny static web page where one person keeps their recipes, searches them and exports them.\n\n## Out of scope\nAccounts, photos, sharing links.\n`);
  S.note = "Intake started; brief written."; S.where = "Intake. Brief written."; S.next = "Facilitator reads the brief and opens circle 1";
  sync();
});
step("intake", "overview", "STATE shows Phase: Intake and the harness version", () => {
  hand("Intake", "facilitator", "brief", "done", 6, 1.2, "brief read, 5 questions drafted");
  S.waiting = ["Read [00-brief.md](00-brief.md) and say if it is right."]; S.note = `Brief in [00-brief.md](00-brief.md).`;
  ask("brief-ok", "other", "Read the brief and say if it is right.", { options: ["Right", "Needs changes"], default: "Right", blocks: "Circle 1 (the facilitator waits for your read).", source: "docs/product/00-brief.md" });
  sync();
});

// Circles
let score = 0;
step("circles", "overview", "circle-01.md with 5 questions; human-log gets 5 questions; Waiting lists them", () => {
  S.phase = "Circles"; S.note = "Circle 1 is open."; S.where = "Circles. Circle 1 open (5 questions, each with a default)."; S.next = "Answers to circle 1, then circle 2 if readiness < 16";
  S.inFlight = "nothing (waiting for answers)";
  S.waiting = CIRCLE_Q.map((q, i) => `Q${i + 1}: ${q[0]} (default: ${q[1]})`);
  writeCircle("circle-01.md", "Circle 1", CIRCLE_Q, [], score);
  CIRCLE_Q.forEach((q, i) => human("question", `Q${i + 1}: ${q[0]} Default: ${q[1]}`));
  answer("brief-ok", "Right");
  CIRCLE_Q.forEach((q, i) => ask(`circle1-q${i + 1}`, "circle-question", `Q${i + 1}: ${q[0]}`, { options: [q[1]], default: q[1], blocks: "Circle 1 readiness (needs 16 of 20 to leave Circles).", source: `docs/product/circles/circle-01.md#q${i + 1}` }));
  hand("Circles", "facilitator", "circle-01", "done", 9, 2.1, "5 questions with defaults");
  sync();
});
const READY1 = [5, 8, 11, 13, 15];
CIRCLE_Q.forEach((q, i) => step("circles", "overview", `Q${i + 1} answered; readiness ${READY1[i]}/20`, () => {
  score = READY1[i];
  const answered = ANSWER.slice(0, i + 1);
  writeCircle("circle-01.md", "Circle 1", CIRCLE_Q, answered, score);
  human("decision", `Q${i + 1}: ${ANSWER[i]}`);
  answer(`circle1-q${i + 1}`, ANSWER[i]);
  S.waiting = CIRCLE_Q.slice(i + 1).map((x, j) => `Q${i + 2 + j}: ${x[0]} (default: ${x[1]})`);
  S.note = `Circle 1: ${i + 1} of 5 answered. Readiness ${score} of 20 (threshold 16).`;
  S.where = `Circles. Circle 1: ${i + 1} of 5 answered, readiness ${score}/20.`;
  sync();
}));
step("circles", "overview", "readiness 15 < 16: circle-02.md with 3 follow-ups", () => {
  writeCircle("circle-02.md", "Circle 2", CIRCLE_FOLLOW, [], score);
  CIRCLE_FOLLOW.forEach((q, i) => human("question", `F${i + 1}: ${q[0]} Default: ${q[1]}`));
  CIRCLE_FOLLOW.forEach((q, i) => ask(`circle2-f${i + 1}`, "circle-question", `F${i + 1}: ${q[0]}`, { options: [q[1]], default: q[1], blocks: "Circle 2 readiness (15 of 20, needs 16).", source: `docs/product/circles/circle-02.md#f${i + 1}` }));
  S.waiting = CIRCLE_FOLLOW.map((q, i) => `F${i + 1}: ${q[0]} (default: ${q[1]})`);
  S.note = "Circle 2 open: 3 follow-ups. Readiness 15 of 20, below 16.";
  S.where = "Circles. Circle 2 open (3 follow-ups).";
  sync();
});
const READY2 = [17, 18, 19];
CIRCLE_FOLLOW.forEach((q, i) => step("circles", "overview", `F${i + 1} answered; readiness ${READY2[i]}/20`, () => {
  score = READY2[i];
  writeCircle("circle-02.md", "Circle 2", CIRCLE_FOLLOW, FOLLOW_ANSWER.slice(0, i + 1), score);
  human("decision", `F${i + 1}: ${FOLLOW_ANSWER[i]}`);
  answer(`circle2-f${i + 1}`, FOLLOW_ANSWER[i]);
  S.waiting = CIRCLE_FOLLOW.slice(i + 1).map((x, j) => `F${i + 2 + j}: ${x[0]} (default: ${x[1]})`);
  S.note = `Circle 2: ${i + 1} of 3 answered. Readiness ${score} of 20.`;
  if (i === 2) { S.waiting = ["Your go to leave Circles (phase gate) so Spec can start."]; S.note = "Readiness 19 of 20, above 16. Waiting for the go.";
    ask("gate-leave-circles", "gate", "Leave Circles and start Spec? Readiness is 19 of 20 (threshold 16).", { options: ["approve", "reject"], default: "approve", blocks: "The Spec phase (requirements and ACs).", source: "docs/product/circles/circle-02.md#readiness" }); }
  sync();
}));

// Spec
step("spec", "overview", "go to leave Circles; Phase: Spec", () => {
  human("go", "leave Circles, start Spec");
  answer("gate-leave-circles", "approve", { how: "default" });
  S.phase = "Spec"; S.note = "Circles left (go given). Spec writer is working."; S.where = "Spec. Writing 20-requirements.md.";
  S.inFlight = "spec-writer on 20-requirements.md"; S.next = "Requirements, then the gate: approve Spec and Plan"; S.waiting = [];
  sync();
});
[4, 8, 12].forEach((n) => step("spec", "overview", `20-requirements.md grows to ${n} requirements`, () => {
  writeReqs(n);
  hand("Spec", "spec-writer", `20-requirements-${n}`, "done", n, 0.8 + n / 8, `${n} requirements`);
  S.note = `Spec: ${n} requirements written.`; S.where = `Spec. ${n} of 12 requirements written.`;
  sync();
}));
step("spec", "overview", "gate 'approve Spec and Plan' waits for you", () => {
  S.inFlight = "nothing (gate)"; S.waiting = ["Gate: approve Spec and Plan (12 requirements in [20-requirements.md](20-requirements.md))."];
  S.note = "Spec complete. Gate open."; S.where = "Spec complete. Gate: approve Spec and Plan."; S.next = "After your go: architect writes ADRs and the plan";
  human("question", "Gate: approve Spec and Plan?");
  ask("gate-spec-plan", "gate", "Approve Spec and Plan (12 requirements)?", { options: ["approve", "reject"], default: "approve", why: "All 12 requirements have testable ACs; readiness 19 of 20.", blocks: "The architect (ADRs and the plan).", source: "docs/product/20-requirements.md#r-12-remember-the-last-search" });
  sync();
});

// Plan
step("plan", "overview", "go: Spec approved; Phase: Plan", () => {
  human("go", "approve Spec and Plan");
  answer("gate-spec-plan", "approve", { how: "default" });
  S.phase = "Plan"; S.note = "Spec approved. Architect is working."; S.where = "Plan. Spec approved; writing ADRs and 50-plan.md.";
  S.inFlight = "architect on decisions/ and 50-plan.md"; S.waiting = []; S.next = "Plan with 2 groups x 3 slices, then Build";
  sync();
});
ADRS.forEach((a, i) => step("plan", "overview", `${a[0]} appears in decisions/`, () => {
  writeAdr(i);
  hand("Plan", "architect", a[0].slice(0, 7), "done", 5, 1.5, a[1]);
  S.note = `Plan: ${i + 1} of 3 ADRs.`;
  sync();
}));
step("plan", "plan", "50-plan.md with Round G1, G2 and 3 slices each", () => {
  put("docs/product/50-plan.md", PLAN);
  hand("Plan", "architect", "50-plan", "done", 8, 2.4, "2 groups, 6 slices");
  S.note = "Plan written: 2 groups, 6 slices, 3 ADRs."; S.where = "Plan written (G1, G2). Ready to build."; S.inFlight = "nothing"; S.next = "Build G1";
  sync();
});

// Build
const flight = (id, text) => { S.where = `Build. **${id} in flight**.`; S.inFlight = text; };
step("build", "overview", "G1-S1 starts: ledger 'started' row, In flight changes, plan shows it active", () => {
  S.phase = "Build"; S.round = "G1"; S.note = "Plan approved. Building group G1.";
  hand("G1", "implementer", "G1-S1", "started", 0, 0);
  flight("G1-S1", "implementer on G1-S1 (store module)"); S.next = "G1-S1, G1-S2, G1-S3, then review and accept G1";
  sync();
});
step("build", "plan", "G1-S1 done: ledger row with tokens{}", () => {
  hand("G1", "implementer", "G1-S1", "done", 40, 3.1, "12 unit tests green");
  testrun("unit", 12, 0, [], "G1-S1");
  S.where = "Build. G1-S1 done, G1-S2 next."; S.inFlight = "nothing"; sync();
});
step("build", "plan", "G1-S2 starts", () => {
  hand("G1", "implementer", "G1-S2", "started", 0, 0);
  flight("G1-S2", "implementer on G1-S2 (add and list view)"); sync();
});
step("build", "ledger", "one red test: test-engineer row 'blocked' and a high finding", () => {
  hand("G1", "test-engineer", "G1-S2", "blocked", 18, 1.6, "1 test red: list sorts oldest first");
  testrun("unit", 20, 1, ["list sorts newest first (list.test.js)"], "G1-S2");
  finding("G1", "review", "high", "G1-S2: test 'newest first' is red", "open", "list.js");
  flight("G1-S2", "implementer fixing 1 red test on G1-S2 (list sorts oldest first)");
  S.waiting = ["Nothing to decide yet; 1 test red on G1-S2 (agent is fixing)."]; sync();
});
step("build", "plan", "red test fixed, G1-S2 done; finding fixed", () => {
  finding("G1", "review", "high", "G1-S2: test 'newest first' is red", "fixed", "list.js");
  hand("G1", "implementer", "G1-S2", "done", 35, 2.8, "all tests green");
  testrun("unit", 21, 0, [], "G1-S2");
  S.waiting = []; S.where = "Build. G1-S2 done, G1-S3 next."; S.inFlight = "nothing"; sync();
});
step("build", "overview", "G1-S3 starts, then its agent stalls: 'stalled' ledger row and finding", () => {
  hand("G1", "implementer", "G1-S3", "started", 0, 0);
  hand("G1", "implementer", "G1-S3", "stalled", 6, 0, "no output for 28 min");
  const stallF = finding("G1", "proxy", "medium", "G1-S3: agent stalled (no output for 28 min)", "open", "store.js");
  ask("stalled-g1-s3", "other", "The agent on G1-S3 has produced no output for 28 min: restart it or stop it?", { options: ["Restart the agent", "Stop it"], default: "Restart the agent", why: "Stalled agents cost nothing but hold the slice.", blocks: "G1-S3 and the G1 review.", source: "docs/product/50-plan.md#g1-s3-edit-and-delete", slice: "G1-S3", findings: [stallF] });
  flight("G1-S3", "implementer on G1-S3 (edit and delete): STALLED, no output for 28 min");
  S.waiting = ["Agent on G1-S3 is stalled: restart it or stop it?"]; sync();
});
step("build", "overview", "stale moment: ledger moves on, RESUME 'Last updated' is 50 min behind (stale banner)", () => {
  hand("G1", "reviewer", "G1-S3", "done", 12, 1.1, "partial review while the agent restarts");
  S.resumeAt = Date.now() - 50 * 60000; sync();
});
step("build", "overview", "RESUME refreshed; G1-S3 done; stale banner clears", () => {
  S.resumeAt = null; S.waiting = [];
  answer("stalled-g1-s3", "Restart the agent", { how: "default" });
  hand("G1", "implementer", "G1-S3", "done", 30, 2.2, "restarted, finished; delete asks for confirmation");
  S.where = "Build. G1-S1..S3 built; review next."; S.inFlight = "reviewer on G1"; sync();
});
step("build", "reviews", "G1-review.md with 3 findings; findings.jsonl rows", () => {
  writeReview();
  finding("G1", "review", "medium", "G1-R01 delete does not ask for confirmation", "open", "store.js");
  finding("G1", "review", "low", "G1-R02 tag chips overflow at 360 px", "open", "list.js");
  finding("G1", "review", "low", "G1-R03 storage key not versioned", "open", "store.js");
  testrun("unit", 24, 0, [], "G1-S3");
  hand("G1", "reviewer", "G1", "done", 22, 3.5, "3 findings, no blocker");
  S.inFlight = "implementer fixing 3 review findings on G1"; sync();
});

// Accept
step("accept", "overview", "review findings fixed; group G1 waits for your accept", () => {
  ["G1-R01 delete does not ask for confirmation", "G1-R02 tag chips overflow at 360 px", "G1-R03 storage key not versioned"].forEach((t, i) =>
    finding("G1", "review", ["medium", "low", "low"][i], t, "fixed", i === 1 ? "list.js" : "store.js"));
  hand("G1", "implementer", "G1-fix", "done", 15, 2, "3 findings fixed, tests green");
  testrun("unit", 27, 0, [], "G1-fix"); testrun("e2e", 6, 0, [], "G1-fix");
  ask("accept-g1", "slice-review", "Accept group G1 (Recipe store)? Open the page and try add, list, edit, delete.", { options: ["Accept", "Changes needed"], default: "Accept", blocks: "Group G2 (search and share).", source: "docs/reviews/G1-review.md", slice: "G1", findings: ["F-3", "F-4", "F-5"].filter((f) => [...findingIds.values()].includes(f)), tests: ["unit", "e2e"] });
  S.where = "Build. G1 built, reviewed, fixed. Waiting for accept."; S.inFlight = "nothing";
  S.waiting = ["Accept group G1 (Recipe store): open the page and try add, list, edit, delete."]; S.note = "G1 waits for acceptance.";
  S.next = "After your accept: start G2"; sync();
});
step("accept", "plan", "G1 accepted (human-log 'go'); group and slices turn done", () => {
  human("go", "accept G1");
  answer("accept-g1", "Accept", { how: "default" });
  S.where = "Build. G1 accepted."; S.waiting = []; S.next = "G2 slices"; sync();
});
step("accept", "overview", "next group starts: G2-S1 in flight", () => {
  S.round = "G2"; S.note = "G1 accepted. Building group G2.";
  hand("G2", "implementer", "G2-S1", "started", 0, 0);
  S.where = "Build. G1 accepted. **G2-S1 in flight**."; S.inFlight = "implementer on G2-S1 (search box)"; S.next = "G2-S1, G2-S2, G2-S3, then review and accept G2"; sync();
});

// ---- run ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rl = stepMode ? createInterface({ input: process.stdin, output: process.stdout }) : null;
const play = steps.filter((s) => s.phase <= to);
let shown = 0;
const total = play.filter((s) => s.phase >= from).length;
console.log(`lifecycle simulator -> ${target}  (speed ${speed}${stepMode ? ", step mode: press Enter after each step" : ""}, ${PHASES[from]}..${PHASES[to]}, ${total} steps)`);
console.log(`add the folder to the dashboard (picker or POST /api/projects) and open it.`);
for (const [i, s] of play.entries()) {
  s.fn(); // earlier phases (before --from) are written silently so the files stay consistent
  if (s.phase < from) continue;
  console.log(`[${String(++shown).padStart(2, "0")}/${total}] ${PHASES[s.phase].padEnd(7)} ${s.text}  => tab: ${TAB[s.tab]}`);
  if (shown === total) break;
  if (stepMode) await rl.question("  (Enter for the next step) ");
  else await sleep((3000 + ((i * 2749) % 5001)) / speed); // 3-8 s per step, divided by speed
}
rl?.close();
console.log("done.");
