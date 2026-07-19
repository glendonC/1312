# Contributing to 1321

Focused issues and pull requests are welcome. Open an issue before starting a change that is larger
than a typo or a contained one-file correction. Early alignment matters because runtime, Studio,
evaluation, and documentation work often move in parallel.

## Read the owners first

Use [`docs/README.md`](docs/README.md) to find the document that owns a product or engineering fact.
Use [`AGENTS.md`](AGENTS.md) when working through Codex or another IDE or CLI agent.

Keep each change inside one clear boundary:

- `src/pages/` owns Astro route entry points.
- `src/studio/` owns Studio UI, state, and product projections.
- `src/studio/runtime/production/` owns production runtime contracts and execution.
- `tests/` owns Node and browser verification.
- `bench/` owns frozen evaluation inputs, labels, scores, and receipts.
- `docs/` owns public product, architecture, contract, and status references.

Do not overwrite an active lane or mix an unrelated refactor into a focused change.

## Set up locally

```sh
npm ci
npm run dev
```

Use `npm install` only when intentionally changing a dependency or the lockfile. The repository does
not pin a Node version, so do not add an unsupported version claim.

## Make an evidence-backed change

- Verify current behavior against code, tests, schemas, or bound receipts.
- Update the owning document when a product claim, contract, or status fact changes. Prefer
  link-to-owner over copying status into architecture or RFC text.
- Keep unsupported states unavailable, unknown, withheld, or failed.
- Do not submit secrets, credentials, private media, or material you cannot redistribute.
- Do not alter frozen benchmark inputs or gold labels to improve a score.
- Preserve third-party notices and file-specific license terms.
- Avoid drive-by formatting and unrelated cleanup.
- Capability rung IDs (`U1`…`U7`, and related slice labels) are defined in
  [`docs/build-week/CAPABILITY_LADDER.md`](docs/build-week/CAPABILITY_LADDER.md). Outside that file,
  gloss or link on first use.

## Run the relevant checks

| Change | Minimum check |
|---|---|
| Documentation | `npm run docs:check` |
| Astro, React, TypeScript, routes, or styles | `npm run build` |
| Focused unit behavior | `node --test tests/<file>.test.ts` |
| Runtime contracts or execution | Targeted tests, then `npm run runtime:check` |
| Bench artifacts | `npm run bench:check` |
| Recorded evidence | `npm run evidence:check` |
| Studio browser behavior | `npm run build`, then `npm run studio:qa -- tests/browser/<file>.spec.ts` |
| Broad deterministic gate | `npm run studio:check` |

Report any skipped check and any pre-existing failure. A guarded external-model skip is not proof.

## Open a pull request

1. Branch from `main`.
2. Keep the change focused and preserve unrelated work.
3. Describe the outcome, files changed, and checks actually run.
4. State limitations and unsupported claims.
5. Link the issue or evidence that motivated the change.

Security vulnerabilities do not belong in public issues or pull requests. Follow
[`SECURITY.md`](SECURITY.md).

## License

By submitting original work, you agree that it may be distributed under the repository's
[MIT License](LICENSE). Files, models, media, and other assets with separate terms retain those
terms. Submit only work you have the right to license.
