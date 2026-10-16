# helloharnessfaketestproject

A fake project for exercising the harness without real work. It holds harness-shaped project data
(STATE, RESUME block, plan, ledger, human log, round retro, review) so the live dashboard in
`../agent_harness/dashboard/` has something to read, watch and write to.

- `tools/simulate.mjs` appends fake hand-backs, findings and user messages, to test live updates.
- The "product" is a single static page (`index.html`). Nothing here is real delivery work.
