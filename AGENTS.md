# Repository agent instructions

This file governs IDE and CLI agents. `docs/CODEX.md` governs closed product-launched `codex exec`
processes. Do not merge those roles.

## Repository map

| Path | Owns |
|---|---|
| `src/pages/` | Astro route entry points |
| `src/studio/` | Studio UI, state, and product projections |
| `src/studio/runtime/production/` | Runtime models, validation, hosts, policy, journals, and executors |
| `tests/` | Node tests; `tests/browser/` has Playwright tests |
| `scripts/` | Runtime, evidence, evaluation, and repository checks |
| `bench/` | Evaluation schemas, packs, labels, scores, and receipts |
| `public/demo/runs/` | Recorded product fixtures and evidence |
| `memory/` | Reviewed memory, glossary, correction, and rule artifacts |
| `vendor/` | Pinned local model assets |

Use npm and `package-lock.json`. Run `npm ci` for a clean install. Use `npm install` only for an
intentional dependency or lockfile change. No Node version is pinned, so do not invent one.

Start locally with `npm run dev`. Build and type-check with `npm run build`.

## Work protocol

1. Inspect `git status --short`, relevant diffs, and owner files before editing.
2. Verify claims against code, tests, schemas, and receipts. Cite consequential paths.
3. For multi-area work, use parallel read-only evidence lanes, propose a bounded plan, and wait for
   acceptance. Assign one writer per shared file.
4. Implement one accepted slice. Avoid drive-by refactors and unrelated formatting.
5. Run the mapped checks. Report skips and pre-existing failures separately.
6. Stop for triage. Do not start the next slice without acceptance.

An active collision is an overlapping dirty diff, user-declared lane, or current handoff naming the
same owner. Stop without explicit handoff. Never reset, clean, overwrite, or reformat another lane.

On missing or conflicting evidence, continue read-only, withhold the claim, and report what would
prove it. Commit, push, or open a pull request only when explicitly asked.

## Source-of-truth map

| Concern | Owner |
|---|---|
| Documentation catalog and lifecycle | `docs/README.md` |
| Product identity, loop, and proof boundary | `docs/PRODUCT.md` |
| Current engineering status and roadmap | `docs/build-week/STATUS.md` |
| Capability sequence, done-when, and non-claims | `docs/build-week/CAPABILITY_LADDER.md` |
| Stable stack, module boundaries, and dependency direction | `docs/ARCHITECTURE.md` |
| Production runtime contracts and historical fixture context | `docs/RUNTIME_CONTRACTS.md` |
| Studio UI/runtime meaning, authority, actions, and unavailable states | `docs/STUDIO_PRODUCT_CONTRACT.md` |
| Deep runtime design and dated implementation history | `docs/STUDIO_AUTONOMY.md` |
| Product-launched Codex executor cage | `docs/CODEX.md` |
| Miss-to-gold evaluation design and invariants | `docs/rfcs/0001-miss-to-gold-conveyor.md` |
| Current evaluation facts | `bench/packs/`, `bench/scores/`, and their bound receipts |
| Repository agent operations | `AGENTS.md` |

Use code, schemas, tests, and content-addressed receipts as implementation evidence. `STATUS.md` is
a summary. On conflict, verify implementation, cite the conflict, and update only the owner.

`docs/local/` is ignored context, never public authority. Public docs must not link to it. Treat
tracked mentions as cleanup debt, not proof, and add no new ones.

## Verification matrix

| Change | Minimum verification |
|---|---|
| Documentation or agent instructions | `npm run docs:check`; run the owning domain check when a product, runtime, or evaluation claim changes |
| Astro, React, TypeScript, routes, or styles | `npm run build` |
| Top-level unit behavior | `node --test tests/<file>.test.ts`, then `node --test` for full discovery |
| Runtime contracts, hosts, schedulers, projections, or executors | Targeted Node tests, then `npm run runtime:check` |
| Bench schemas, packs, scores, or receipts | `npm run bench:check` |
| Recorded run evidence | `npm run evidence:check` |
| Memory or glossary review | `npm run memory:check` |
| Speech, language, acoustic, frame, OCR, speaker, or source producers | The matching `npm run <domain>:check` script in `package.json` |
| Studio browser behavior | `npm run build`, then `npm run studio:qa -- tests/browser/<file>.spec.ts`; use `npm run studio:qa` for the full suite |
| Broad deterministic gate | `npm run studio:check` |

`studio:qa:list` only lists browser tests. `studio:check` runs manual subsystem lists and browser
discovery, not every top-level unit or browser test. Use `node --test` for full unit discovery.
Never treat a guarded real Codex or OpenAI skip as proof. Run external execution only with explicit
user authorization, model selection, and required credentials.

## Engineering and honesty rules

For runtime, authority, receipt, and contract changes:

- Keep UI, runtime, evaluation, and agent operations in their owning modules.
- Add facts through typed, validated, versioned schemas and immutable receipts.
- Put models, adapters, and heuristics behind narrow named seams.
- Make unsupported states unavailable, unknown, withheld, or failed.
- Test negative authorization, missing grants, limits, replay, and tamper where relevant.
- Avoid silent schema mutation and shapes that force the next capability to special-case this one.

Standing non-claims:

- Metadata is not downloaded bytes or processing. Replay and animation are not live execution.
- Detector output, including speech activity, acoustics, speaker clusters, overlap, or separation, is
  not transcription, understanding, or translation.
- Coverage, citation closure, receipt integrity, and structural QC are not semantic quality.
- A role or spawn without a granted producer and tool is not capability.
- Private captions and artifacts are not upload, publication, or public authority.

## Review guidelines

When reviewing, prioritize defects. Flag unsupported capability, missing authority, mutable
evidence, silent fallback, incompatible schemas, fake available states, absent negative tests, and
docs that contradict owners or executable evidence. Cite the smallest path and line. Distinguish a
defect from a question. If no finding survives verification, state the remaining test gap.

## Documentation rules

- Keep one owner for each current fact. Link instead of copying status, contracts, or ledgers.
- Keep `AGENTS.md` below 8 KiB. Do not paste roadmap state or implementation history.
- Use short imperative prose. Do not use em dashes, filler, hype, or unsupported completion language.
- Label historical proposals and dated ledgers so they cannot be mistaken for current status.
- Add a nested `AGENTS.md` only when a subtree has stable, materially different commands or safety
  rules. Update `scripts/check-docs.mjs` when that topology is intentionally accepted.

## Handoff and maintenance

Report outcome, files, exact checks, blockers or non-claims, and untouched scope. Include an
architecture decision only when one was made.

Update this file only for stable repository-wide friction, repeated findings, or changed commands.
Prefer executable checks. After changing instruction topology, run `codex debug prompt-input` from
the affected directory and restart Codex.
