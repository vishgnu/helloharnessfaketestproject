# helloharnessfaketestproject

A fake project for exercising the harness without real work. It holds harness-shaped project data
(STATE, RESUME block, plan, ledger, human log, round retro, review) so the live dashboard in
`../agent_harness/dashboard/` has something to read, watch and write to.

- `tools/simulate.mjs` appends fake hand-backs, findings and user messages, to test live updates.
- The "product" is a single static page (`index.html`). Nothing here is real delivery work.

## Lifecycle simulator

`node tools/lifecycle.mjs [--target ../hello-lifecycle] [--speed 1] [--from intake] [--to accept] [--step] [--scenario default|mockup]`

Plays the first phases of a harness project (Intake, Circles, Spec, Plan, Build, Accept) into a **separate**
sibling folder, in the real file formats, so you can watch them in the live dashboard. Add the target folder in
the dashboard (picker or `POST /api/projects`) before or while it runs.

- Each step waits 3-8 s (divided by `--speed`); `--step` waits for Enter instead. One line per step says what changed and which tab shows it.
- Build includes one red test, one stalled agent and a stale RESUME (50 min behind the ledger).
- `--from` fast-forwards the earlier phases silently; `--to` stops after a phase.
- The target must be empty or carry a `.lifecycle-sim` marker (it is then wiped and rewritten). This folder is never touched.
- `tools/simulate.mjs` (random ledger/finding events into this folder) is unchanged.

### Scenario `mockup` (journey J8: a client UX mock-up with a redo)

`node tools/lifecycle.mjs --scenario mockup --target ../hello-mockup --customer "Example Client" --short "Checkout mock-up"`

Default scenario and all other flags are unchanged. The mockup scenario plays 24 steps: Intake (brief, `_Customer:`/`_Short:`),
Circles 1 (4 questions as decision requests, answered), variants round 1 (`variants/checkout/` with `A.html`, `B.html`, `C.html`
as inline-only pages, `notes.md`, `decision.md`, a `variant-pick` request), pick A, Spec, client feedback (human-log plus
`comments.jsonl`, one reply), then the **redo**: a `phase` record `{from:"Spec", to:"Circles", redo:true, reason}` in
`decisions.jsonl` and a `Back in Circles: <reason>` line in STATE. After that: circle 2 (2 new questions), variants round 2
(`variants/checkout-r2/`, request `vp-checkout-r2` with `supersedes: "vp-checkout"`, round-1 `decision.md` marked superseded),
pick B2, Spec again, gate, Plan (group M1, 2 slices), Build (1 review finding, fixed) and Accept.
