# Build Week status

Last updated: 2026-07-16

## Document roles

This is the **only living Build Week status and roadmap**. Completed owned-swarm planning checklists
have been consolidated into the completion record below; Git retains their detailed history. The
product and architecture documents define stable intent and boundaries, the autonomy and contract
documents are deep references, and the miss-to-gold RFC owns the separate evaluation conveyor.

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

## Explicit deferrals

- Additional semantic producers: music/noise, diarization/overlap, separation, OCR, frames, and
  visual context.
- Semantic transcription/translation evaluation, independent judging, calibration, and scored Bet G
  results.
- Transparent model-turn continuation, distributed scheduling, elastic workers, and unlimited
  recursion.
- Hosted/link ingest, accounts, remote execution, retention/access policy, and full live controls.
- Production topology/workspace polish, Results/export/upload/CDN/publication, and cross-run memory
  promotion from studies.

## Next

1. Catch the UI up to the validated production projections without inventing missing runtime facts.
2. Make one owned-path walkthrough demoable end to end: source → plan → bounded swarm → study → human
   approval → private captions/QC, with the recorded lineage visible.
3. Package Bet G later as the separate evaluation story after real gold is drafted, independently
   adjudicated, frozen, and scored.

## Honesty non-claims

- Recognizer hypotheses, coverage, citation closure, human approval, and structural QC are not
  transcription accuracy or translation quality.
- Private study/caption artifacts are not publication, upload, or public availability.
- Bounded agent-directed execution is not unlimited autonomy or swarm completeness for every media
  class.
- Recorded replay fixtures are not the owned-path swarm, and no scored Bet G result exists yet.

## Where to read what

- [`PRODUCT.md`](../PRODUCT.md) — stable pitch, product loop, Build Week product bar, and route map.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — structural boundaries, chosen stack, and dependency
  direction; not the current roadmap.
- [`STUDIO_AUTONOMY.md`](../STUDIO_AUTONOMY.md) — deep runtime design and implementation ledger; use
  this status page for what is done and next.
- [`RUNTIME_CONTRACTS.md`](../RUNTIME_CONTRACTS.md) — exact production contract references plus
  deliberately inert historical proposal shapes.
- [`STUDIO_PRODUCT_CONTRACT.md`](../STUDIO_PRODUCT_CONTRACT.md) — UI/runtime authority, product-flow,
  data, and action contracts.
- [`0001-miss-to-gold-conveyor.md`](../rfcs/0001-miss-to-gold-conveyor.md) — Bet G evaluation design,
  implemented scaffold, and the remaining human-gold requirements.
