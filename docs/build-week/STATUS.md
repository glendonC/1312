# Build Week status

- Document type: Living status
- Lifecycle: Active
- Authority: Current milestones, blockers, active work, and next actions
- Last verified: 2026-07-19
- Update when: Engineering state changes

## Document roles

This is the **only living engineering status and roadmap**. Completed owned-swarm planning
checklists have been consolidated into the completion record below; Git retains their detailed
history. Product identity and architecture define stable intent and boundaries. Autonomy and
contract documents are deep references. The miss-to-gold RFC owns conveyor invariants, not pack
counts. The media-understanding capability sequence lives in
[`CAPABILITY_LADDER.md`](./CAPABILITY_LADDER.md); rung IDs such as U1 through U7 are defined there.
This file summarizes acceptance and blockers; it does not reopen the closed owned-path v2 campaign.

## North stars

Product identity is defined in [`PRODUCT.md`](../PRODUCT.md) and the public site. This file tracks
engineering status only.

North stars for the active engineering tracks:

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
  seams are split into cohesive modules. The initial-coverage recovery read model and production-facts
  UI are included.
- **Bounded initial-coverage recovery — contract slice:** one terminal, typed execution fault in a
  required generalized initial-coverage worker can authorize one host-owned exact replacement in the
  same durable runtime. Content-addressed classification, authorization, and terminal receipts keep
  failed attempt 0 visible, clone its exact task/context/grant/output authority into distinct attempt
  1 identities, suppress concurrent/duplicate/equivalent work, and either pass the replacement report
  through ordinary admission/read/synthesis or terminally exhaust and withhold. Baseline allocation
  remains a separate 1,220,000 ms/32-call ceiling; the recovery contingency is 480,000 ms/4 calls;
  the total ceiling is 1,700,000 ms/36 calls. Deterministic hostile tests cover five replaceable fault
  classes, tamper, stale authority, crash-after-authorization interruption, healthy-sibling
  preservation, full contingency consumption, and no evidence-quality retry. Studio production facts
  now project validated failure classifications, authorization, failed attempt 0, replacement attempt
  1, and reported or exhausted terminal lineage, with an explicit unavailable state when those
  receipts are absent. Allocation values are shown as ceilings, not forecasts. This slice includes no
  Results UI, best-of-K selection, quality retry, root/caption/Learning recovery, live provider proof,
  restart liveness, semantic success, correctness, quality, or cost-reduction claim.
- **Selected-language Apply producer:** an exact verified caption span can now enter a separate
  private language-explanation host with typed meaning/word/phrase/grammar/translation-choice
  facets, immutable grant/artifact/receipt lineage, cold audit, authenticated POST/GET, and a strict
  browser client parser. Failed attempts remain immutable and visible while bounded host-numbered
  retries and explicit restart recovery can close transient or interrupted work without inventing
  output. Production Results now bind verified captions to content-bound private source playback
  through a short-lived host-minted grant, and an explicit exact-span selection can request the
  five facets from that verified media moment with coalesced identical actions, stale-response
  rejection, and bounded explicit retry. The default executor is unavailable and visibly
  non-retryable; real OpenAI execution requires an explicit operator-selected model and flag.
  Facets remain semantically `not_reviewed`, and follow-up, listening/culture/reference producers,
  learner persistence, grading, SRS, and export are not included.
- **Learning fine-tune prep spine:** a second private post-caption Apply producer accepts one exact
  verified caption identity plus a typed `studio.learning-fine-tune.v1` value (armed lenses
  `word_order`, `grammar_salience`, `situating`, `culture_reference`, and `historical_reference`,
  plus one closed temperature) and stores immutable `studio.learning-prep.artifact.v1` and
  `studio.learning-prep.receipt.v1` lineage with grant, journal events, projection, cold audit,
  authenticated GET/POST, bounded retries, and explicit interrupted-attempt recovery. Segmentation
  is a host-validated beat partition or an explicit watch-through reason; per-moment candidates
  anchor exact caption lines and abstain with closed reasons; temperature only caps surfaced
  available candidates and never coerces availability. Available notes stay `not_reviewed`
  caption-context inference with empty external citations, so culture or history availability is a
  receipted note, not verified culture truth. The default executor is unavailable; real OpenAI
  execution requires an explicit operator-selected model and flag on the runtime host command line,
  while deterministic executors stay test-injected only. A strict browser
  client re-hashes both stored objects, a request controller creates at most one explicit prep per
  fine-tune with bounded retry, and the production Customize learning face plus watch-first Moments
  overlay project only host-derived states: the overlay surfaces at most one prepared available
  note for the moment under the playhead and stays silent otherwise, while withheld, abstained, and
  all-withheld states stay visible in the face. Deterministic coverage lives in
  `tests/studio-learning-prep.test.ts` and one desktop browser test in
  `tests/browser/studio-production-seams.spec.ts` covering the prepared and unconfigured paths;
  adapter, configuration, and guard coverage lives in `tests/studio-learning-prep-openai.test.ts`.
  A guarded live proof requires explicit environment opt-in and claims execution and stored lineage
  only, never semantic quality or culture truth; its default skip is not proof. One live gpt-4o-mini
  proof was captured on 2026-07-19 with a receipted provider response id and an honest all-abstained
  watch-through result over the one-line test caption; it proves execution and lineage only. No
  learner persistence, export, or Learning OS surface is included.
- **Bet G first scored capture:** `hard-ko-v1` is frozen and the human-labeled run-007 score receipt
  exists with `judge: null`. It is one benchmark data point, not production semantic QC, calibration,
  or a general quality/improvement claim.
- **Bet G ablation packaging foundation:** `studio.bench.ablation.v1` binds one exact
  content-addressed config leaf delta to current frozen pack and freeze bytes, keeps results and
  model judge null, requires three paired repetitions per frozen clip, and separates structural
  diagnostics from human semantic scores. The first registration plans raw versus eligible
  anonymous U7 (conditional separation) stems. `studio.bench.u7-ablation-inputs.v1` binds exact
  pre-capture media for all three frozen clips. A cold-audit-first packager emits both fixed
  anonymous-stem capture drafts, preserves the exact registered configs, maps absent output only to
  missing or withheld, and keeps semantic fields null. No registered capture, label, variance, or
  result exists yet.
- **Bet G IL-03 provider campaign foundation:** additive capture-executor, execution-input, and
  execution-attribution V2 contracts bind one host-owned OpenAI audio-translation call and its exact
  provider receipt. The adapter has no retries or output selection, requires explicit live gates
  and provider-media authority before charging, and keeps injected transports test-only.
  Owned-local rule-change registration V2 binds exact training media only when ownership authorizes
  redistribution and requires a human approval receipt for the exact proposal bytes. That receipt
  never authorizes live capture. A replacement result-free registration binds `run-005`, frozen
  `hard-ko-provider-authorized-v1`, the exact-byte human-approved proposal, the certified provider
  executor, the sole rule-content delta, and all 18 planned calls. Both qualification-only releases
  exist and record `runtime_deployable: false`. The live grid spent all 18 slots once with zero
  retries. Fifteen calls produced captures and execution attributions. The three `Ni5rBtowdnI`
  without-rule calls returned HTTP 200 but failed as `provider_invalid_output`, so those slots are
  spent with no capture or attribution. The 15 successful captures have operator-authorized
  hackathon label receipts and scores with `judge: null`. The receipts declare `blinded: true`, but
  their notes explicitly say the fill was not independent blind human semantic QC. Six structural
  paired-score receipts exist for c1 and c3. Their with-side deltas are unfavorable under those
  disclosed labels. Qualification refused before writing a result because all nine preregistered
  pairs are required. The bench gate validates all six pairs, then remains nonzero because the
  shared c3 capture has no second score receipt naming `hard-ko-v1`. No accepted memory, runtime
  deployment, or product improvement result exists.

Rung IDs below (`U1`…`U7`, including slice labels such as `U6.1` and `U7.1`) are defined in
[`CAPABILITY_LADDER.md`](./CAPABILITY_LADDER.md). This section records acceptance state; done-when
and non-claims remain in the ladder.

- **U1 acoustic triage:** a pinned local YAMNet-compatible ONNX producer operates over the exact
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
- **U4 budgeted re-study: attenuated and padded current-run speech slices:** the default generalized
  root now exposes `study_restudy_request` beside the five U3 tools and closes terminal
  `studio.owned-media-study.v3`, readiness v4, and caption/caption-causality v4 while reports and
  admissions remain v2. A host-derived request names one exact weak range, evidence-tied cause,
  prior report/citation/speech identities, and one registered speech delta. For the closed
  `speaker_overlap` cause, the host derives one exact conflicting U6 accounting cell and requires the
  caller to echo that temporal range unchanged through `attenuated_subrange`. Other causes may use a
  strict weak-range attenuation backed by broader prior speech, or `padded_audio_window` backed by
  exact prior speech over the weak range. Padding must add context on at least one side, remain inside
  the root audio scope and speech duration limit, and stay at or below 2 s per side. The host fixes
  pass 2, a delta-specific current-run speech configuration scope, and a 20 s/one-call reservation;
  the scheduler rejects
  scope broadening, enforces one accepted pass per range/four per producer, and atomically dedupes an
  identical work/configuration fingerprint. Request and terminal receipts retain reserved/measured
  spend, task/report/admission/read lineage, outcome, and disagreement. Study v3 preserves every
  admitted report and accepted pass in order; only pass-new range-closing current-run speech
  citations from attenuation can support the executed subrange. Padded context always preserves the
  prior weak class and cannot perform semantic arbitration. Otherwise the affected range terminates
  weak while unrelated supported ranges continue. Denser frames, alternate recognizer/segmentation
  configuration, and specialist deltas remain typed but fail closed. No UI, U5/OCR,
  semantic-quality, improvement, or Bet G claim is included.
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
- **U5.1 visual-change candidates: cite-only vertical slice:**
  `media.visual-transitions.analyze` is now one explicit scheduler grant and task-private
  launcher/MCP bridge accepting exactly a completed U2 frame operation id plus the completed U5 OCR
  operation id bound to it. Same task, agent, executor, launch, source, video track, and range are
  required. The host cold-audits both lineages, then measures every adjacent frame pair on a fixed
  32 by 32 nearest-cell-center RGB grid. Mean absolute channel delta at or above 250,000 ppm is
  stored only as `visual_change_candidate`; OCR available-hypothesis set change is secondary
  lineage and never changes the threshold. Private observation/receipt artifacts close exact
  frame, U2, U5, producer, limit, score, interval, and nonclaim identities. Cold audit reopens and
  reruns the producer. U3 accepts selected intervals only as cite-only temporal media context, with
  no claim or coverage citation ids. One call, 2 to 4 frames, 2 MiB/frame, 8 MiB total, 256 KiB per
  observation/receipt, and 5 s wall are enforced. Scene/shot/cut claims, semantic visual
  understanding, right-frame selection, default specialist routing, U4 denser frames, UI,
  caption/publication authority, and person/object/place/action/mood/cultural claims remain closed.
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
- **U7-to-Bet-G packaging:** an evaluation-only adapter now consumes that cold audit. It registers
  exact source bytes for every frozen clip and can materialize only the raw-versus-stem1 and
  raw-versus-stem2 capture pair for one named operation and repetition. It writes no synthetic
  evidence and grants no correctness, quality, judge, or preference authority.
- **U7 follow-through accounting:** a content-addressed evaluation audit now derives all 9 required
  minimum operation pairs and 18 capture slots from the immutable frozen-pack registration and
  input registry. Complete same-operation pairs, exact capture bindings, human score bindings, and
  extra positive repetitions remain visible; zero captures cannot look complete. The portable check
  retains missing local sources and runtime as unavailable. A separate local-readiness probe verifies
  ignored source bytes and the qualified pinned separator when present without creating a portable
  platform pin. This workspace is locally ready, but the repository still has 0 of 18 minimum capture
  slots and 0 scores. Result, judge, preference, quality, caption, publication, and stem-selection
  authority remain unavailable.
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
- **R2 optional offline runtime wiring:** `computer.use.readonly` is now a global child capability
  behind a distinct dormant root `study.computer-use` request capability. Neither is active on the
  default root, and the default scheduler has no R2 surface or driver policy. Ordinary spawn cannot
  request the child. A configured root may echo only the host-derived `{ inputId, candidateId }` for
  the same current v3 conflict and cold-audited R1 empty-query cause; the scheduler fixes the child
  contract and rejects stale, forged, duplicate, or cross-executor work. The launcher mounts one
  task-private empty-object `computer_use_readonly` tool over the loopback bridge and requires one
  same-grant, same-execution, same-launch completed operation. Started, completed, and failed events
  project the executor/launch-bound operation, and five private origins retain the sealed fixture,
  screenshots, visible content, action receipts, and session receipt. A worker can select only
  bounded screen-region identities into `external_screen_region` citations. Admission keeps them
  report-level and `cite_only`, with exact task, agent, executor, session, and screenshot lineage;
  they cannot support claims, coverage, captions, quality, or readiness. The only driver remains
  `offline_fixture`, with zero network, cookies, credentials, downloads, uploads, or mutations. No
  live browser runs, and a real isolated read-only driver remains open.
- **Recorded completion flow (persistent canvas + golden Result node):** on the recorded surface
  the swarm canvas no longer unmounts at completion. A golden **Result** node — the shared
  agent-field material in a gold palette with an orbiting hairline aura — forms at the topology's
  terminus on the orchestrator's free face (widest ring gap; behind the root in tidy layouts), so
  its delivery wire can never cross another wire. It projects the run's real receipted captions,
  emits no trace, and mounts only once the fold is complete. The result workspace auto-opens
  full-bleed over the canvas in the focus-panel idiom (gold identity anchor with bundle-derived
  language pair, range, and per-line counts; LearningResultExperience unchanged) with a command
  baseline: **Source** and **Coverage** disclosures (renamed from Details / Run details) and one
  **Close · Esc** exit. The Result/Process switch is gone from the recorded surface — the orb is
  the sole re-entry — while the owned-source production surface keeps its switch. The completed
  graph carries a passive "Recorded evidence · completed process graph" chip. The agent-focus
  workbench player now uses the shared squircle screen and on-video chrome; the below-frame
  transport remains only for pictureless media. No new runtime request, receipt, or authority
  claim is introduced; everything shown is projection of the already-loaded bundle.

## Post-freeze backlog boundary

### Sequenced next — active understanding backlog

These are ordered, slice-by-slice rungs in [`CAPABILITY_LADDER.md`](./CAPABILITY_LADDER.md), not
indefinite deferrals. Status here is a summary; ladder done-when and non-claims win on conflict.

1. U1 acoustic triage and honest non-dialogue coverage: implemented; accuracy evaluation remains
   separate.
2. U2 bounded frame sampling and inspection: implemented; visual interpretation remains a later
   producer rung.
3. U3 multimodal admission and generalized abstention: implemented and default-runtime wired;
   frames remain cite-only.
4. U4 budgeted multi-pass re-study: attenuated current-run speech, the exact U6.1
   (`speaker_overlap` separation trigger) cause, and one bounded non-speaker padded-audio pass are
   implemented and default-runtime wired; additional delta producers remain closed.
5. U5 OCR and scene/on-screen context: OCR and deterministic cite-only visual-change candidate
   slices are implemented; scene/shot semantics, default specialist routing, and U4 denser-frame/
   specialist wiring remain.
6. U6 anonymous speaker/overlap evidence: one pinned local producer, immutable accounting receipt,
   launcher bridge, U3 coverage qualification, and typed exact-range U4 overlap trigger implemented;
   non-darwin native pins and a diarization quality bench remain.
7. U7 conditional separation and raw/stem comparison: the first U6.1-triggered, pinned local,
   private-artifact, cold-audited slice is implemented and default-runtime wired, and a U7.1
   (acoustic `mixed`-cell trigger) closed U1 eligibility path reuses the same host. Its exact Bet G
   input and capture-packaging boundary is implemented; other platforms/models, independent or human
   semantic preference, registered capture executions, and scores remain.
8. R1 bounded receipted web research: the first trigger-gated slice (grant, scheduler admission,
   launcher tools, journaled operations, production v2 report construction, cite-only span admission)
   is wired offline; a real
   provider behind an explicit allow flag, DNS pinning, freshness/provenance depth, and
   deeper context-specialist synthesis remain. Default v3 conflict derivation is wired but dormant.
9. R2 optional offline runtime wiring: implemented behind dormant root authority and explicit host
   composition; a real isolated read-only driver remains after media senses and R1.
10. G1 semantic evaluation expansion, execution of registered ablation captures, repeated scores,
    variance, and later packs; structural QC remains separate.

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
3. Execute the 9 pending pre-registered `hard-ko-v1` raw-versus-eligible-stem operation pairs through
   the exact packager, then obtain exact-byte-bound blinded human labels and score all 18 captures.
   The follow-through audit is the structural checklist, not a semantic result. Measure variance
   later without recasting run-007 or structural diagnostics as runtime semantic QC.
4. Preserve the provider-authorized campaign as an incomplete partial measurement. Do not retry the
   three spent c2 without-rule attempts or treat the hackathon labels, six pairs, or refused
   qualification command as a campaign win. Any replacement grid or real independent blind human
   review requires a separately authorized slice.

## Honesty non-claims

- Recognizer hypotheses, coverage, citation closure, human approval, and structural QC are not
  transcription accuracy or translation quality.
- Private study/caption artifacts are not publication, upload, or public availability.
- Bounded agent-directed execution is not unlimited autonomy or swarm completeness for every media
  class.
- Recorded replay fixtures are not the owned-path swarm. The run-007 Bet G score exists with a null
  model judge; one human-labeled capture does not establish calibration, generalization, or that the
  prepped path is better.
- The IL-03 provider campaign has 15 scored captures under disclosed hackathon labels and six
  partial pairs, not independent blind human semantic QC or a qualification result. The partial
  deltas are unfavorable, but an incomplete grid still cannot establish a campaign outcome.
  Eligibility is not deployment, accepted memory is not runtime consumption, and none of these
  facts proves a product self-improvement win.
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
  durable pass history/disagreement, attenuation-only citation support upgrades, padded-context
  weak-state preservation, terminal weakness, and replay.
  A pass count, token count, agent count, role label, or successful citation does not prove
  understanding, semantic correctness, accuracy, quality, or improvement.
- U5 proves one bounded local OCR execution path, exact U2 frame lineage, immutable hypotheses,
  cold audit/tamper closure, cite-only U3 association, and fail-closed limits/abstention. It does not
  prove displayed text is correct, identify a person/place/object, infer script/language,
  translate/culturally interpret text, understand a scene, select the right frame, or improve a
  transcript/caption.
- U5.1 proves one bounded deterministic adjacent-frame RGB-grid measurement path, exact same-
  executor U2/U5 lineage, immutable score/classification/interval identities, cold rerun, and
  cite-only temporal association. It does not prove a scene, shot, cut, semantic change, relevant
  moment, right frame, person, object, place, action, mood, culture, OCR truth, dialogue, caption
  correctness, quality, or improvement.
- U6 proves one bounded local anonymous-clustering execution path, exact owned-audio lineage,
  complete range accounting, immutable hypotheses/receipt, cold audit/tamper closure, U3
  coverage/conflict preservation, and one exact typed overlap-to-attenuated-speech request. It does
  not prove that pass resolved overlap, identify people, link speakers across artifacts or runs, prove
  speaker count/turn boundaries, validate any word or translation, authorize captions,
  perform separation, or establish diarization accuracy.
- U7 proves one exact U6.1-triggered and one U7.1 U1-`mixed`-triggered local separation path, private
  raw/stem lineage, immutable receipts, same-recognizer structural comparison, and cold replay/tamper
  closure. The Bet G adapter proves only exact input registration, capture completeness, and
  missing/withheld mapping. The follow-through audit proves only exact minimum-grid accounting,
  pair/score binding, and typed local readiness; its current 0 of 18 state is pending, not success.
  It does not prove that either estimate is cleaner or semantically better,
  that agreement is independent evidence, that any recognized word or translation is correct, or
  that stems may support claims, captions, publication, speaker identity, source identity, or a
  quality/improvement score.
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

- [`CAPABILITY_LADDER.md`](./CAPABILITY_LADDER.md): media-understanding rung order, done-when,
  external context bounds, quality non-claims, and a parked later-learning appendix.
- [`PRODUCT.md`](../PRODUCT.md): product identity, loop, proof bar, and route map.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md): structural boundaries, chosen stack, and dependency
  direction; not the current roadmap.
- [`STUDIO_AUTONOMY.md`](../STUDIO_AUTONOMY.md): deep runtime design and implementation ledger; use
  this status page for what is done and next.
- [`RUNTIME_CONTRACTS.md`](../RUNTIME_CONTRACTS.md): exact production contract references plus
  deliberately inert historical proposal shapes.
- [`STUDIO_PRODUCT_CONTRACT.md`](../STUDIO_PRODUCT_CONTRACT.md): UI/runtime authority, product-flow,
  data, and action contracts.
- [`0001-miss-to-gold-conveyor.md`](../rfcs/0001-miss-to-gold-conveyor.md): Bet G evaluation design and
  conveyor invariants; current frozen pack and score artifacts live under `bench/`.
