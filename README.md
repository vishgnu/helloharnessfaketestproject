# helloharnessfaketestproject

A fake project for exercising the harness without real work. It holds harness-shaped project data
(STATE, RESUME block, plan, ledger, human log, round retro, review) so the live dashboard in
`../agent_harness/dashboard/` has something to read, watch and write to.

- `tools/simulate.mjs` appends fake hand-backs, findings and user messages, to test live updates.
- The "product" is a single static page (`index.html`). Nothing here is real delivery work.

## Lifecycle simulator

`node tools/lifecycle.mjs [--target ../hello-lifecycle] [--speed 1] [--from intake] [--to accept] [--step]`

Plays the first phases of a harness project (Intake, Circles, Spec, Plan, Build, Accept) into a **separate**
sibling folder, in the real file formats, so you can watch them in the live dashboard. Add the target folder in
the dashboard (picker or `POST /api/projects`) before or while it runs.

- Each step waits 3-8 s (divided by `--speed`); `--step` waits for Enter instead. One line per step says what changed and which tab shows it.
- Build includes one red test, one stalled agent and a stale RESUME (50 min behind the ledger).
- `--from` fast-forwards the earlier phases silently; `--to` stops after a phase.
- The target must be empty or carry a `.lifecycle-sim` marker (it is then wiped and rewritten). This folder is never touched.
- `tools/simulate.mjs` (random ledger/finding events into this folder) is unchanged.
