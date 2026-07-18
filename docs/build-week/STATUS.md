# Build Week status

Last updated: 2026-07-18

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
  an integrity/coverage gate, not semantic QC. The U5 OCR slot now has a cite-only producer/audit;
  U6 speaker-turn evidence now has a coverage-qualification-only producer/audit, while the document
  slot still fails closed without a producer. U4 extends this evidence layer
  additively rather than reopening v1 planning. The Studio
  UI remains unwired and unchanged.
- **U4 budgeted re-study — attenuated current-run speech vertical slice:** the default generalized
  root now exposes `study_restudy_request` beside the five U3 tools and closes terminal
  `studio.owned-media-study.v3`, readiness v4, and caption/caption-causality v4 while reports and
  admissions remain v2. A host-derived request names one exact weak range, evidence-tied cause,
  prior report/citation/speech identities, and one attenuated speech delta. For the new closed
  `speaker_overlap` cause, the host derives one exact conflicting U6 accounting cell and requires the
  caller to echo that temporal range unchanged; other causes still require a strict weak-range
  subrange. Both require prior broader speech. The host fixes pass 2,
  current-run speech configuration scope, and a 20 s/one-call reservation; the scheduler rejects
  scope broadening, enforces one accepted pass per range/four per producer, and atomically dedupes an
  identical work/configuration fingerprint. Request and terminal receipts retain reserved/measured
  spend, task/report/admission/read lineage, outcome, and disagreement. Study v3 preserves every
  admitted report and accepted pass in order; only pass-new range-closing current-run speech
  citations can support the executed subrange. Otherwise the affected range terminates weak while
  unrelated supported ranges continue. Padded audio, denser frames, alternate recognizer/
  segmentation configuration, and specialist deltas are typed but fail closed until a producer and
  grant are registered. No UI, U5/OCR, semantic-quality, improvement, or Bet G claim is included.
- **U5 on-screen OCR — cite-only vertical slice:** `media.frames.ocr` is now an explicit scheduler
  grant and task-private launcher/MCP bridge that accepts only a completed same-task U2 frame
  operation identity. The host cold-audits U2 source/manifest/receipt/PNG/decoder lineage, then runs
  local Tesseract.js/core 7.0.0 with vendored `tessdata_fast` 4.1.0 Korean+English models at pinned
  commit `65727574dfcd264acbb0c3e07860e4e9e9b22185`; model/runtime/configuration files are hashed,
  network model fetch and cache are disabled, and the decoder seam is replaceable. Separate private
  content-addressed observation and receipt artifacts retain exact frame ids/timestamps, boxes,
  NFC-normalized text, confidence/state, model/runtime/config identity, and hard count/byte/text/wall
  limits. Below-70 confidence and overlapping contradictory hypotheses store null text as unknown;
  overflow stores truncated with no partial text. Missing grant/frame/model, out-of-range U2 input,
  tamper, and drift fail closed. U3 now cold-audits `ocr_span` only as `cite_only` media context in
  report/admission v2; OCR does not enter claim or coverage citation ids and cannot authorize KO/EN
  caption text or overwrite speech evidence. Scene/shot production, script/language inference,
  subtitle-perfect aggregation, default visual-specialist/root routing, and U4 denser-frame or
  specialist wiring remain. No UI, face/biometric/person-id, publication, semantic-quality, or
  Bet G claim is included.
- **U6 anonymous speaker/overlap evidence — coverage + typed U4 trigger vertical slices:**
  `media.speakers.analyze` is a one-call scheduler grant and task-private launcher/MCP bridge whose
  child request is exactly `{}`; the host injects the owned source, audio track, range, task, agent,
  and grant. Production seals mono-16 kHz PCM and runs pinned local `sherpa-onnx-node` 1.13.4 on
  darwin-arm64 with pyannote segmentation 3.0 plus the 3D-Speaker ERes2Net embedding model. The
  replaceable diarizer seam returns raw clusters; the host assigns only operation-local
  `anon_cluster_N` labels, closes the complete granted range into available anonymous-turn,
  conflicting overlap, unknown rapid/no-hypothesis, or truncated cells, and stores separate private
  content-addressed observations and receipt artifacts with exact model/runtime/configuration hashes.
  Cold audit reopens source and both artifacts, re-derives identities, and re-hashes current lineage
  without rerunning inference. U3 registers `speaker_turn` only as exact temporal
  `coverage_qualification`; the adapter reconstructs every accounting cell in the target range, so
  a caller cannot omit overlap/uncertainty cells. It cannot be `claim_support`, cannot authorize
  Korean/English caption text, and does not overwrite speech. Missing grant/model/source, oversized
  normalized audio, drift, tamper, timeout, and output overflow fail closed. U6.1 adds the typed
  `speaker_overlap` cause only for a cold-audited conflicting overlap cell inside a synthesized weak
  range with prior broader speech. The existing `attenuated_subrange` producer runs once over that
  exact host range; widening, narrowing, forged `recognizer_disagreement`, identical work, and missing
  grants fail closed. Speaker evidence stays coverage-only, and the pass does not itself resolve the
  conflict or authorize captions. That U6 slice included no UI, named/person/biometric/cross-run
  identity, perfect diarization, non-darwin native pins, diarization quality bench, U7 separation,
  ambient always-diarize, OCR reopen, semantic-quality, or Bet G claim.
- **U7 conditional separation and raw-versus-stem comparison — first U6.1-triggered vertical
  slice:** the default restudied root now has the grant-gated `study_separation_request` tool. Its
  closed request contains only a host-derived input identity and trigger identity. Ordinary child
  spawn cannot request `media.audio.separate`; the scheduler may issue that one-call child grant
  only for one cold-audited U6.1 `conflicting` overlap cell, with the source track and half-open range
  copied exactly. A U7.1 second eligible cause additively admits one cold-audited U1 acoustic cell
  classified `mixed` (necessarily strong, with both speech and music above support) over its exact
  half-open range, reusing the same grant/producer/comparison/audit path; ordinary spawn still cannot
  request the capability and no other acoustic class (music, noise, speech-candidate, unknown)
  qualifies. The replaceable producer seam is backed on this runtime by an explicitly
  bootstrapped, offline SpeechBrain 1.1.0 SepFormer WSJ02Mix model at immutable revision
  `3a2826343a10e2d2e8a75f79aeab5ff3a2473531`; missing or changed runtime/model bytes fail closed.
  The host preserves the owned raw artifact, seals only the granted range, and stores two anonymous
  private content-addressed derived audio estimates plus canonical separation/comparison receipts.
  Stem origins directly retain raw source/content/track/range, the trigger kind and observation
  identity, method, model, and configuration lineage. One current-run recognizer contract runs over raw and both estimates; the
  deterministic result is only `agreement`, `disagreement`, or `abstention` after normalized-text
  comparison. It always carries null semantic preference and no semantic, caption, publication,
  speaker/source-identity, or quality authority. Cold audit reopens raw, both stems, both receipts,
  the comparison, the audited trigger cause, and current producer lineage by stored identities
  rather than caller paths. No U3 claim-support/caption schema, UI, public stem delivery, human preference,
  quality score, R1/R2, or Bet G ablation is included.
- The first wired R1 slice makes `research.investigate` a scheduler-issued grant that is mintable
  only through the recorded `study_research_request` root tool call under a root `study.research`
  grant, from one host-derived unresolved-conflict trigger re-derived inside the admission
  transaction. The launcher mounts path-free `research_search`/`research_document_snapshot` per
  grant, journals `research.operation_*` events into a cold-auditable `researchOperations`
  projection with executor lineage on every receipt, and admission accepts
  `external_document_span` citations as cite-only media context. The default provider is the
  offline fixture and the default domain allowlist is empty, so no egress occurs without explicit
  composition policy; ambient codex web search stays disabled. A full two-query budget that returns
  no results can now produce one exact-gap, executor-bound
  `studio.research-exhaustion.receipt.v1` projected in `researchExhaustions`; it is an R2 cause only
  and carries no semantic or caption authority. The default v3 root now holds dormant
  `study.research`; after at least two admitted reads, a cold-reopened pre-synthesis inspection
  journals `studio.research-request-input.v2` with the exact root, admission/read/pass basis and
  conflicting coverage evidence. `artifact_read` exposes that candidate, and only a current exact
  conflict echo can mint the bounded child. Empty trigger lists grant nothing and research is never
  automatic. A research-granted worker can now echo only exact cold-audited snapshot/extraction
  identities plus sorted bounded UTF-8 byte spans into its v2 report. The launcher-owned builder
  emits those spans only as cite-only media context; searches/snippets cannot enter the list, and
  research cannot become claim support or supported coverage.

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
4. U4 budgeted multi-pass re-study — one attenuated current-run speech pass plus the exact U6.1
   `speaker_overlap` cause/trigger implemented and default-runtime wired; additional delta producers
   remain closed.
5. U5 OCR and scene/on-screen context — OCR cite-only vertical slice implemented; scene/shot,
   default specialist routing, and U4 denser-frame/specialist wiring remain.
6. U6 anonymous speaker/overlap evidence — one pinned local producer, immutable accounting receipt,
   launcher bridge, U3 coverage qualification, and typed exact-range U4 overlap trigger implemented;
   non-darwin native pins and a diarization quality bench remain.
7. U7 conditional separation and raw/stem comparison — the first U6.1-triggered, pinned local,
   private-artifact, cold-audited slice is implemented and default-runtime wired, and a U7.1 closed
   U1 `mixed`-acoustic eligibility trigger now reuses the same path; other platforms/models,
   independent or human semantic preference, and Bet G ablation remain.
8. R1 bounded receipted web research — the first trigger-gated slice (grant, scheduler admission,
   launcher tools, journaled operations, production v2 report construction, cite-only span admission)
   is wired offline; a real
   provider behind an explicit allow flag, DNS pinning, freshness/provenance depth, and
   deeper context-specialist synthesis remain. Default v3 conflict derivation is wired but dormant.
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
  transcription/translation quality, OCR accuracy, or scene understanding.
- U4 proves exact weak-range/cause selection, one bounded delta-bearing pass, scheduler caps/dedupe,
  durable pass history/disagreement, citation-only support upgrades, terminal weakness, and replay.
  A pass count, token count, agent count, role label, or successful citation does not prove
  understanding, semantic correctness, accuracy, quality, or improvement.
- U5 proves one bounded local OCR execution path, exact U2 frame lineage, immutable hypotheses,
  cold audit/tamper closure, cite-only U3 association, and fail-closed limits/abstention. It does not
  prove displayed text is correct, identify a person/place/object, infer script/language,
  translate/culturally interpret text, understand a scene, select the right frame, or improve a
  transcript/caption.
- U6 proves one bounded local anonymous-clustering execution path, exact owned-audio lineage,
  complete range accounting, immutable hypotheses/receipt, cold audit/tamper closure, U3
  coverage/conflict preservation, and one exact typed overlap-to-attenuated-speech request. It does
  not prove that pass resolved overlap, identify people, link speakers across artifacts or runs, prove
  speaker count/turn boundaries, validate any word or translation, authorize captions,
  perform separation, or establish diarization accuracy.
- U7 proves one exact U6.1-triggered and one U7.1 U1-`mixed`-triggered local separation path, private
  raw/stem lineage, immutable receipts, same-recognizer structural comparison, and cold replay/tamper
  closure. It does not prove that either estimate is cleaner or semantically better, that agreement is
  independent evidence, that any recognized word or translation is correct, or that stems may support
  claims, captions, publication, speaker identity, source identity, or a quality/improvement score.
  The pinned SepFormer is a two-speaker wsj0-2mix model, so a `mixed` speech-plus-music U1 trigger
  runs it outside its training domain and claims only raw-versus-stem comparability, never that music
  and speech were cleanly separated.
- R1 proves trigger-gated grant minting, closed egress policy enforcement, receipted
  search/snapshot/extraction lineage, journal-projected operations with executor binding, cold
  audit by content identity, exact snapshot-span worker echoes, cite-only `external_document_span`
  report construction/admission, and one cold-auditable structural exhaustion cause when the full
  query budget returns no results. It does not prove
  source truth, currency, entity match, semantic correctness, transcript or caption authority, or
  semantic insufficiency. It does not prove that any run researched anything: no default run
  produces research, snippets are never
  citations, and the snapshot receipts keep disclosing
  `dnsRebindingWindow: "checked_before_fetch_not_pinned"` because the destination address is
  re-resolved between the policy check and the fetch.

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
