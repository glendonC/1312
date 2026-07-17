# Build Week status

Last updated: 2026-07-17

## Document roles

This is the **only living Build Week status and roadmap**. Completed owned-swarm planning checklists
have been consolidated into the completion record below; Git retains their detailed history. The
product and architecture documents define stable intent and boundaries, the autonomy and contract
documents are deep references, and the miss-to-gold RFC owns the separate evaluation conveyor.
The post–Build Week media-understanding, research, and later-learning plan lives in
[`CAPABILITY_LADDER.md`](./CAPABILITY_LADDER.md); it depends on the closed owned-path v2 spine and does
not reopen that campaign.

## North stars

- **Evaluation — Bet G / miss-to-gold:** turn run misses into agent-drafted, human-adjudicated,
  receipt-frozen gold, then score and compare against that fixed evidence. This measures output
  quality; it does not establish runtime autonomy or swarm completeness.
- **Runtime — owned-path swarm depth:** execute and replay a bounded, agent-directed owned-media
  study path with exact source, task, evidence, report, admission, synthesis, approval, caption, and
  QC lineage. This establishes the implemented runtime path; it does not establish media truth or
  translation quality.

Keep these tracks separate. A Bet G score is not swarm depth, and runtime depth is not a quality
score.

## Done

- **Owned-path depth v1:** the four foundational slices are implemented: range-bound perception and
  evidence reads, a root-to-child round trip, current-run caption/QC lineage, and a production-backed
  swarm projection.
- **Owned-path depth v2 campaign exit:** slices 1–5 are complete in code: durable model-directed
  orchestration, current-run semantic evidence, coverage-aware report admission, gap-directed study
  planning/synthesis, and study-causal captions with independent structural QC. The campaign is
  closed; do not reopen its slices as a new runtime plan.
- **Runtime modularity:** launcher, validation, projection, protocol, and runtime-host review/caption
  seams are split into cohesive modules; UI catch-up remains next.
- **Bet G first scored capture:** `hard-ko-v1` is frozen and the human-labeled run-007 score receipt
  exists with `judge: null`. It is one benchmark data point, not production semantic QC, calibration,
  or a general quality/improvement claim.
- **U1 acoustic triage:** a pinned local YAMNet-compatible ONNX producer now operates over the exact
  sealed mono-16 kHz owned-media bytes, produces a complete closed-vocabulary partition plus a
  separate execution receipt, and seals both additively in preflight V4. Spawned children can read
  the actual observations only through exact `evidence.read` grants. Deterministic VAD/acoustic/
  lyrics reconciliation is stored in study-readiness V2; only strong non-speech agreement may close
  `not_in_requested_dialogue_scope`, and caption storage/reopening forbids Korean or English text on
  excluded ranges. V1–V3 inputs continue to use their existing path unchanged.

## Post-freeze backlog boundary

### Sequenced next — active understanding backlog

These are ordered, slice-by-slice rungs in [`CAPABILITY_LADDER.md`](./CAPABILITY_LADDER.md), not
indefinite deferrals or a one-day implementation claim:

1. U1 acoustic triage and honest non-dialogue coverage — implemented; accuracy evaluation remains
   separate.
2. U2 bounded frame sampling and inspection.
3. U3 multimodal admission and generalized abstention.
4. U4 budgeted multi-pass re-study over exact gaps/subranges.
5. U5 OCR and scene/on-screen context.
6. U6 anonymous speaker/overlap evidence.
7. U7 conditional separation and raw/stem comparison.
8. R1 bounded receipted web research.
9. R2 optional bounded read-only computer-use after media senses and research.
10. G1 semantic evaluation expansion, registered ablations, repeated captures, variance, and later
    packs; structural QC remains separate.

### Parked / out of this climb

- Learning OS, Anki/Quizlet/Feather exports, in-app tutors, mastery, and SRS behavior.
- Live/low-latency captions, latency optimization, and always-on media/screen capture.
- Unrestricted computer/browser/shell access, credentials, signed-in sessions, and external mutations
  such as messages, purchases, uploads, publication, or account changes.
- Unlimited recursion, transparent model-turn continuation, distributed scheduling, elastic workers,
  and unconstrained remote execution.
- UI redesign/projection work owned elsewhere, plus hosted/link ingest, accounts, retention/access
  policy, public upload/CDN/publication, and production-topology work.

## Next

1. Catch the UI up to the validated production projections without inventing missing runtime facts.
2. Make one owned-path walkthrough demoable end to end: source → plan → bounded swarm → study → human
   approval → private captions/QC, with the recorded lineage visible.
3. Package the frozen `hard-ko-v1` and human-labeled run-007 receipt as the separate Bet G baseline;
   add registered ablations and variance later without recasting that score as runtime semantic QC.

## Honesty non-claims

- Recognizer hypotheses, coverage, citation closure, human approval, and structural QC are not
  transcription accuracy or translation quality.
- Private study/caption artifacts are not publication, upload, or public availability.
- Bounded agent-directed execution is not unlimited autonomy or swarm completeness for every media
  class.
- Recorded replay fixtures are not the owned-path swarm. The run-007 Bet G score exists with a null
  model judge; one human-labeled capture does not establish calibration, generalization, or that the
  prepped path is better.
- U1 proves bounded execution, lineage, authorization, full-duration accounting, and abstention. It
  does not prove acoustic classification accuracy, complete speech detection, lyric understanding,
  transcription/translation correctness, or semantic caption QC.

## Where to read what

- [`CAPABILITY_LADDER.md`](./CAPABILITY_LADDER.md) — post–Build Week media senses, budgeted re-study,
  external context, quality boundaries, and a parked later-learning appendix.
- [`PRODUCT.md`](../PRODUCT.md) — stable pitch, product loop, Build Week product bar, and route map.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — structural boundaries, chosen stack, and dependency
  direction; not the current roadmap.
- [`STUDIO_AUTONOMY.md`](../STUDIO_AUTONOMY.md) — deep runtime design and implementation ledger; use
  this status page for what is done and next.
- [`RUNTIME_CONTRACTS.md`](../RUNTIME_CONTRACTS.md) — exact production contract references plus
  deliberately inert historical proposal shapes.
- [`STUDIO_PRODUCT_CONTRACT.md`](../STUDIO_PRODUCT_CONTRACT.md) — UI/runtime authority, product-flow,
  data, and action contracts.
- [`0001-miss-to-gold-conveyor.md`](../rfcs/0001-miss-to-gold-conveyor.md) — Bet G evaluation design and
  conveyor history; current frozen pack and score artifacts live under `bench/`.
