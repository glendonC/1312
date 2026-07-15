# Runtime modularity audit

Status: post-integration audit and completed behavior-preserving runtime extractions
Baseline: `e7c66df` (`Add validated source-bound runtime launches`)
Audited: 2026-07-14 through 2026-07-15

## Scope and constraints

The audit covered `src/studio/`, production runtime, preflight, runtime inspectors, non-bench
scripts, and tests. Bench, gold, freeze, scoring-pack, and listen-pass work was excluded. Recorded
`RunBundle` replay and the independently versioned production journal remain separate protocols.

## Candidate ranking

| Rank | Candidate | Evidence | Classification |
|---:|---|---|---|
| 1 | `production/assertions.ts` | 1,017 lines, 52 declarations, 12 consumers, unrelated contract domains | Refactored |
| 2 | `production/launcher.ts` | 701 lines combining adapter parsing, worker contract, subprocess bounds, and runtime orchestration | Refactored |
| 3 | `production/memory/inspection.ts` | 831 lines combining receipt parsing, ledger evaluation, materialization, projection, and consumption | Refactored after focused characterization |
| 4 | `production/runStart.ts` | Newly integrated filesystem loader plus pure request/forecast/start construction and persistence | Monitor until the new contract settles |
| 5 | `scripts/lib/memory-review.mjs` | 985 lines spanning repository IO, review policy, bench-bound decisions, and materialization | Refactor after memory inspection boundaries |
| 6 | `production/model.ts` | 45 exported types and 19 consumers; behavior-free catalog with one run-start/forecast dependency | Leave cohesive; monitor dependency direction |
| 7 | `production/projection.ts` | One pure exhaustive reducer protecting cross-event invariants | Leave cohesive |
| 8 | Forecast and observability modules | Large but already separated into model, validation, indexing/query, and aggregation responsibilities | Leave cohesive |
| 9 | Studio store and runtime inspector UI | Central replay session state; local file loading still coupled to inspector presentation | Monitor |
| 10 | Preflight receipt validators | Repeated-looking primitives protect different pinned producer contracts and diagnostics | Leave cohesive |
| 11 | `scripts/run-clip.mjs` | Legacy recorded-run pipeline with no narrow non-bench characterization suite | Needs tests before splitting |

## Completed module map

Production validation now flows in one direction:

```text
validation/primitives.ts
  ├─ language.ts
  ├─ scheduling.ts ─ artifacts.ts
  ├─ media.ts
  ├─ execution.ts
  └─ handoffs.ts
domain validators ─ events.ts
domain validators + events.ts ─ assertions.ts compatibility facade
```

The facade preserves the previous 12 public validator names and all existing consumer imports.
Closed-schema checks, wire literals, error text, producer identities, null/unavailable rules, and
event-union semantics are unchanged.

Executor ownership is now:

```text
executor/codexEvents.ts       Codex JSONL and measured-usage parsing
executor/workerContract.ts    closed output schema, validator, and no-media prompt
executor/processRunner.ts     timeout, termination, and stdout/stderr bounds
executor/launcherFailure.ts   safe operator-facing adapter failure
launcher.ts                   scheduler/registry coordination, receipts, artifacts, and handoff
```

`launcher.ts` retains `CodexExecWorkerLauncher`, `CodexWorkerLauncherOptions`, and
`CodexWorkerLaunchResult`. Its fixed command, ephemeral/read-only execution, no-inherited-shell
policy, output schema, usage receipt, artifact lineage, and report-up behavior remain intact.

Memory inspection ownership is now:

```text
memory/contentIdentity.ts    canonical JSON and SHA-256 content identity
memory/validation.ts         exact parsing for proposals, decisions, snapshots, and consumption
memory/ledgerEvaluation.ts   pure review, ablation, supersession, revocation, and head policy
memory/materialization.ts    snapshot closure and run-consumption binding verification
memory/reviewInspection.ts   validated operator-selected projection and transitions
memory/consumption.ts        durable run binding before accepted values are exposed
memory/inspection.ts         three-export compatibility facade
```

The facade preserves `memoryContentId`, `inspectMemoryReviewArtifacts`, and
`consumeAcceptedMemorySnapshotForRun`. Inspection remains read-only; accepted-value consumption
still waits for its exact run/snapshot receipt to be recorded before returning entries.

## Dependency rules

- Validation primitives contain no domain, service, UI, or adapter imports.
- Domain validators depend only on primitives, production wire types, and narrower validator
  domains; the event validator is the only union-level composition point.
- Runtime services continue importing the compatibility facade; no consumer migration was needed.
- Executor mechanics do not import scheduler, journal, artifact-store, or handoff services.
- The launcher coordinates services but does not own Codex parsing, worker schema mechanics, or
  subprocess lifecycle details.
- Memory dependencies flow from identity to exact parsing, ledger policy, materialization
  verification, and finally inspection/consumption. No memory module imports its UI inspector.
- Provider details remain in preflight producers or executor/media adapters, not scheduler/storage.
- Requested source language, target language, selected pack, and detected-language evidence remain
  distinct. No Korean-only policy was found in production scheduling, storage, or projection.

## Deferred risks

- `scripts/lib/memory-review.mjs` still duplicates canonicalization, validation, and ledger concepts.
  Its producer/CLI contracts need characterization before aligning it with the new runtime modules.
- `memory/validation.ts` is the largest remaining memory module, but its 429 lines have one reason
  to change: exact parsing of the five closed memory receipt schemas. Split only if a schema gains
  an independent owner or consumer.
- `runStart.ts` mixes trusted filesystem loading with pure contract construction, but its contract
  landed in the audit baseline and should stabilize before another move.
- `RunBundle` is owned by `transport.ts`, producing a family of three related type-only cycle paths
  through `bundle.ts`, preflight source adapters, and recorded evidence validation. These erase at
  runtime; move the type only in a separate recorded-replay cleanup.
- The production reducer should not be split until an approach preserves its sequencing and
  cross-domain invariants centrally.

## Verification

Baseline passed: build, runtime, speech, language, evidence, memory, and browser-test discovery.
Post-refactor verification includes focused validation, executor-contract, memory-ledger, and
materialization tests; the complete production runtime suite; TypeScript/Astro build; diff checks;
and a production import-cycle scan. Final command results are recorded in the task handoff.
