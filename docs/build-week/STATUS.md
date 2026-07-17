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

Product identity is defined in [`PRODUCT.md`](../PRODUCT.md) and the public site. This file tracks
engineering status only.

North stars for engineering tracks this week:

- **Evaluation — Bet G / miss-to-gold:** turn run misses into agent-drafted, human-adjudicated,
  receipt-frozen gold, then score and compare against that fixed evidence. This measures beachhead
  meaning quality; it does not establish runtime autonomy or swarm completeness.
- **Runtime — owned-path swarm depth:** execute and replay a bounded, agent-directed owned-media
  study path with exact source, task, evidence, report, admission, synthesis, approval, post-study
  text artifact, and QC lineage. This establishes the implemented understanding spine; it does not
  establish media truth or translation quality.

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
- **U2 bounded frame sampling and inspection:** `media.frames.sample` is an additive scheduler grant
  over exactly one owned-source/video-track window with fixed duration, frame-count, dimension,
  byte, wall, and call ceilings. The host seals and re-hashes a private source snapshot, owns
  ffprobe/ffmpeg decoding from private executable snapshots, records requested and actual PTS plus
  transformation and executable lineage, stores private content-addressed per-frame PNGs, a
  canonical manifest, and a canonical receipt, then atomically records their durable publication.
  The task-private MCP bridge accepts
  only timestamp intent and returns verified image blocks to the child. Cold replay and tamper tests
  reopen the source, receipt, manifest, every frame, and decoder lineage. The default owned audio
  study plan does not request or admit frames. This proves sampling and authorized byte delivery
  only; it does not prove scene understanding or admit visual findings.
- **U3 multimodal admission and generalized abstention:** additive `studio.evidence-citation.v1`,
  `studio.study-report.v2`, parent admission/read v2, `studio.owned-media-study.v2`, readiness v3,
  and caption-causality v3 established the content-addressed owned-audio evidence spine without
  mutating closed v1 receipts. New owned runs still use report/admission v2; v1 is retained only
  through an explicit compatibility selector for historical fixtures and replay.
  Per-kind cold adapters reopen current-run speech, U1 acoustic observation/receipt lineage, and U2
  frame receipt/manifest/PNG/decoder identities. Speech is the only landed claim-support kind and
  must exactly close its claimed range; acoustic citations qualify coverage, while frames remain
  cite-only. Unknown, withheld, unavailable, truncated, conflicting, failed, and not-in-scope states
  deterministically survive admission, synthesis, readiness, and caption causality. Readiness remains
  an integrity/coverage gate, not semantic QC. Future OCR/speaker/document slots fail closed without
  producers. U4 extends this evidence layer additively rather than reopening v1 planning. The Studio
  UI remains unwired and unchanged.
- **U4 budgeted re-study — attenuated current-run speech vertical slice:** the default generalized
  root now exposes `study_restudy_request` beside the five U3 tools and closes terminal
  `studio.owned-media-study.v3`, readiness v4, and caption/caption-causality v4 while reports and
  admissions remain v2. A host-derived request names one exact weak range, evidence-tied cause,
  prior report/citation/speech identities, and one strict attenuated subrange. The host fixes pass 2,
  current-run speech configuration scope, and a 20 s/one-call reservation; the scheduler rejects
  scope broadening, enforces one accepted pass per range/four per producer, and atomically dedupes an
  identical work/configuration fingerprint. Request and terminal receipts retain reserved/measured
  spend, task/report/admission/read lineage, outcome, and disagreement. Study v3 preserves every
  admitted report and accepted pass in order; only pass-new range-closing current-run speech
  citations can support the executed subrange. Otherwise the affected range terminates weak while
  unrelated supported ranges continue. Padded audio, denser frames, alternate recognizer/
  segmentation configuration, and specialist deltas are typed but fail closed until a producer and
  grant are registered. No UI, U5/OCR, semantic-quality, improvement, or Bet G claim is included.

## Post-freeze backlog boundary

### Sequenced next — active understanding backlog

These are ordered, slice-by-slice rungs in [`CAPABILITY_LADDER.md`](./CAPABILITY_LADDER.md), not
indefinite deferrals or a one-day implementation claim:

1. U1 acoustic triage and honest non-dialogue coverage — implemented; accuracy evaluation remains
   separate.
2. U2 bounded frame sampling and inspection — implemented; visual interpretation remains a later
   producer rung.
3. U3 multimodal admission and generalized abstention — implemented and default-runtime wired;
   frames remain cite-only.
4. U4 budgeted multi-pass re-study — one attenuated current-run speech pass implemented and
   default-runtime wired; additional delta producers remain closed.
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
- U2 proves bounded source/video-track decoding, content-addressed PNG delivery, receipt lineage,
  and replay/tamper closure. It does not prove that a child selected the right timestamp, saw or
  understood a scene, recognized text or people, or produced a study-admissible visual claim.
- U3 proves typed observation-to-target association, per-kind cold audit, range closure, generalized
  abstention preservation, and content-addressed replay. It does not prove multimodal understanding,
  evidence accuracy, independent corroboration, reliability equivalence, truth arbitration,
  transcription/translation quality, OCR, or scene understanding.
- U4 proves exact weak-range/cause selection, one bounded delta-bearing pass, scheduler caps/dedupe,
  durable pass history/disagreement, citation-only support upgrades, terminal weakness, and replay.
  A pass count, token count, agent count, role label, or successful citation does not prove
  understanding, semantic correctness, accuracy, quality, or improvement.

## Where to read what

- [`CAPABILITY_LADDER.md`](./CAPABILITY_LADDER.md) — post–Build Week media senses, budgeted re-study,
  external context, quality boundaries, and a parked later-learning appendix.
- [`PRODUCT.md`](../PRODUCT.md) — product identity, loop, Build Week proof bar, and route map.
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
