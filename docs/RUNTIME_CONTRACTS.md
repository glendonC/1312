# Runtime contracts

- Document type: Mixed contract reference
- Lifecycle: Active
- Authority: Production runtime contracts plus explicitly inert fixture history
- Last verified: 2026-07-20
- Update when: A runtime contract changes, or fixture history is split out

Long contract reference. For product orientation use [`PRODUCT.md`](./PRODUCT.md) and
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

This file mixes two authorities until fixture history is split:

1. **Historical snapshot (below):** production-inert typed proposal fixtures.
2. **Active production contracts:** `src/studio/runtime/production/` protocol and receipts.

Capability rung IDs (`U1`…`U7`, including slice labels such as `U6.1` and `U7.1`) are defined in
[`build-week/CAPABILITY_LADDER.md`](./build-week/CAPABILITY_LADDER.md). First use in a section should
gloss or link there. Current roadmap state lives in [`build-week/STATUS.md`](./build-week/STATUS.md).

## Historical snapshot: bounded runtime contract proposal

These original proposal contracts predate the production implementation and remain deliberately
inert. Consequently these contracts:

- are not part of `RunBundle`, `Trace`, `RunState`, `applyTrace`, or either transport;
- cannot appear in the normal Studio UI;
- are exercised only by `src/studio/lab/runtimeFixtures.ts`;
- are rejected by the fixture validator unless `fixtureOnly` is true and the fixture says it is not
  runtime evidence.

## Separate production implementation

`src/studio/runtime/production/` is an independently versioned protocol and implementation. It does
not import the historical proposal or its `fixtureOnly` events.

Rung shorthand used below (see [`CAPABILITY_LADDER.md`](./build-week/CAPABILITY_LADDER.md)):
`U1` acoustic triage, `U2` bounded frame sampling, `U3` multimodal admission, `U4` budgeted
re-study, `U5` OCR / cite-only visual context, `U6` anonymous speaker/overlap, `U6.1` exact
`speaker_overlap` re-study trigger, `U7` conditional separation, `U7.1` acoustic `mixed`-cell
separation trigger.

Current real producers include:

- an append-only NDJSON event journal and pure replay projection;
- a bounded scheduler that derives task ids, depth, parentage, ownership, grants, and reservations;
- a dynamic registry that registers only a scheduler-issued launch permit;
- a content-addressed artifact store with closed ingest, preflight-evidence, and media-operation origins;
- a capability host that performs real, scoped ffmpeg audio-range extraction and one bounded
  `signal`/`digital_silence` audio-activity observation, with content-addressed receipts and source lineage;
- a task-private child bridge that publishes only scheduler-granted `media_extract`/`media_seek`,
  accepts no caller paths or operation ids, and delegates authorization, budget, source, range,
  journal, artifact, and receipt authority to that capability host;
- a separate task-private `media_frames_sample` bridge that accepts only bounded timestamp intent,
  injects task/source/video-track/grant/operation authority, and returns verified PNG image blocks
  plus host-authored manifest/receipt identities rather than paths or filenames;
- a bounded frame host that seals and re-hashes the registered source into a private decode snapshot,
  executes private identified ffmpeg/ffprobe snapshots, enforces duration/count/input-output
  dimension/per-frame and aggregate byte/wall/call ceilings, stores requested and actual PTS plus
  transformation and decoder lineage, and atomically records content-addressed frame, manifest, and
  receipt artifacts;
- a separate path-free `media_frames_ocr` bridge and bounded OCR host that accept only one completed
  same-task U2 (frame sampling) operation identity, cold-audit its source/manifest/receipt/PNG/decoder lineage,
  run pinned local Tesseract.js/core 7.0.0 over the real PNG bytes with vendored Korean+English
  `tessdata_fast` 4.1.0 models, and atomically store private content-addressed observation/receipt
  artifacts under fixed count/byte/text/wall/call ceilings;
- a separate path-free `media_visual_transitions_analyze` bridge and deterministic visual-change
  host that accept only exact completed same-task U2 frame and U5 OCR operation identities, cold-audit
  both lineages, and atomically store cite-only adjacent-frame RGB-grid candidates plus immutable
  observation/receipt artifacts under fixed frame/byte/wall/call ceilings;
- a separate path-free `media_speakers_analyze` bridge and bounded speaker/overlap host whose child
  request is exactly `{}`, injects the one scheduler-owned source/audio-track/range, seals mono-16 kHz
  PCM, runs a pinned local anonymous-clustering producer, and atomically stores complete-range
  observation/receipt artifacts under fixed duration/turn/cell/cluster/byte/wall/call ceilings;
- an additive host-owned U3 citation/admission lane that cold-audits current-run speech, U1 acoustic
  observation/receipt lineage, U2 frame receipt/manifest/PNG/decoder identities, U5 OCR, and U6
  anonymous speaker/overlap
  observation/receipt/model/runtime lineage before storing content-addressed report, admission/read,
  study, and readiness contracts and deriving caption causality from their recursively reopened
  lineage. Frame and OCR evidence remain cite-only; anonymous speaker/overlap may qualify coverage
  only; speech remains the only claim-support kind;
- an additive U4 range-pass host and scheduler lane on the default generalized root: it derives exact
  weak-range/cause/prior-evidence inputs, including a closed receipt-backed `speaker_overlap` cause
  whose execution range is one exact audited U6 accounting cell; it accepts that exact attenuated
  cell, a strict attenuated current-run speech subrange for other causes, or one registered bounded
  padded-audio window around a non-speaker weak range with exact prior speech. It fixes producer,
  configuration, budget, and child scope, records request and terminal spend/
  evidence receipts, dedupes identical work, and projects ordered pass/disagreement history into
  study v3 and readiness/caption causality v4;
- an `evidence.read` host plus separate task-private bridge that publishes only `evidence_read`,
  accepts only an exact scheduler-granted artifact id, injects task/agent/operation identity, and
  returns only facts intersecting the scheduler-granted source/window, clipped to that window, from
  already-validated pinned VAD/language receipts with original lineage;
- an `analysis.evidence.assess` host plus separate task-private bridge that publishes only
  `evidence_assess`, accepts completed same-task evidence-read receipt/content identities and closed
  range/citation claims, injects task/agent/operation identity, and emits a content-addressed
  `studio.evidence-assessment.receipt.v1` without reading producer files;
- an authenticated read-only assessment-audit endpoint that reopens the stored assessment and every
  cited evidence-read receipt by content identity, re-hashes canonical bytes, closes exact ranges,
  states, fact indexes, and task/artifact/journal lineage, and returns no partial audit;
- an `analysis.evidence.decide` host plus path-free task-private `evidence_decide` bridge that
  accepts only exact audited assessment operation/artifact/receipt/content identities, re-runs the
  live audit, and emits one content-addressed `studio.evidence-decision.receipt.v1` with a closed
  `withheld` or `proceed_to_publish_review` outcome and canonical reason codes;
- an authenticated decision-receipt read endpoint that re-hashes the stored decision, re-runs every
  input assessment audit, re-derives policy, and returns no partial verification;
- a host-only publish-review intake producer that accepts only one exact host-verified decision
  operation/artifact/receipt/content identity and emits a private content-addressed
  `studio.publish-review-intake.receipt.v1` with only `queued` or `rejected`;
- an authenticated publish-review intake read endpoint that re-hashes the intake, re-verifies the
  decision and every assessment/read audit, and returns no partial lineage;
- a host-authoritative human review producer that accepts only a verified queued intake plus the
  exact host-configured reviewer id and required attestation, then appends one private immutable
  `approve_for_caption_production` or `reject_with_reasons` receipt with closed reasons;
- a separate immutable approval-revocation producer and an authenticated review read endpoint that
  re-hash decision/revocation bytes and recursively verify intake, decision, assessment, and read
  lineage without creating caption or publication state;
- a separate caption-production host that accepts only one exact approval identity, recursively
  verifies it remains unrevoked, derives source/range from immutable runtime state, and emits private
  content-addressed timed KO+EN artifact and receipt objects under fixed duration/line/text/artifact/
  wall limits, preserving withheld/unavailable;
- an authenticated caption read that re-hashes both stored objects and recursively repeats approval,
  revocation, intake, decision, assessment, and read verification without exposing caller paths or
  claiming upload/publication;
- a structured handoff host that validates required child output and parent-only acceptance.

### Durable agent-directed orchestration kernel

New owned runs carry one content-addressed `studio.task-job-context.v1` on every scheduler task.
The root binds the registered source artifact/content, exact analysis request and requested range,
requested source-language policy, target language, selected pack, output depth, and detector-evidence
artifact/content identities. Child contexts are constructed only by scheduler inheritance or range/
evidence attenuation; the model-facing spawn schema contains no context, task, agent, grant,
dependency-task, launch, executor, or path fields.

The Codex root is a separate executor role with an explicitly configured model. Ambient Codex
configuration and the documented shell, web, app, hook, goal, memory, remote-plugin, and built-in
multi-agent tool families are disabled for that process. Its task-private MCP surface is selected
from the root contract. A new owned run keeps U3 report/admission v2 but closes the additive U4
study-v3 path and exposes exactly `task_spawn_request`, `task_reports_wait`, `report_disposition`,
`artifact_read`, `study_restudy_request`, and `study_synthesize`. It has no
`study_planning_decision` or ambient follow-up authority. `study_restudy_request` accepts only one
exact host-derived weak range/cause and a registered delta; the current slice registers attenuated
current-run speech plus one bounded non-speaker padded-audio window. A `speaker_overlap` cause must
copy its exact host-derived U6 cell through attenuation. Other causes may use a strict weak-range
subrange or the registered padded window. The explicit v1
compatibility selector retains the closed six-tool planning/synthesis surface for historical
fixtures. Spawn records the root execution/tool-call causation, returns one accepted/rejected
scheduler decision, and starts accepted per-task launch promises without waiting. Wait journals
`waiting_for_children` and returns only terminal task/report/artifact identities or closed failure
states.

Every executing task now has one durable `task.launch_claimed` event. `executor.started` consumes
that exact claim and a task cannot acquire a second executor in replay. File-journal appends reject
stale sequence writers. Recovery never resumes an ambiguous model turn: it appends
`runtime.interrupted`, closes active executor/task identities, and does not create a report.

The generalized initial-coverage path also has a narrower same-process recovery contract for an
already terminal executor fault. A launcher-authored
`studio.executor-failure-classification.receipt.v1` separates replaceable `process_failed`,
`executor_timed_out`, `required_tool_omitted`, `invalid_structured_output`, and
`provider_transport_failed` faults from terminal configuration, authorization, interruption,
output-limit, handoff, root, and unknown failures. The scheduler, not the model, may then append one
content-addressed `studio.agent-recovery-authorization.receipt.v1` and atomically create attempt 1
for the exact attempt-0 source, range, task context, required output, capability envelope,
dependencies, and 240,000 ms/2-call allocation. The logical work identity is immutable, the task,
agent, launch, and executor identities are new, and attempt 0 remains a failed task with its original
executor and classification facts. A terminal
`studio.agent-recovery-terminal.receipt.v1` records only `replacement_reported` or `exhausted`; a
reported replacement enters the unchanged report/disposition/admission/read/synthesis path, while
exhaustion permits no attempt 2 and withholds the root.

The generalized ceilings are explicit and separate: 1,220,000 ms/32 calls for baseline allocation,
480,000 ms/4 calls for at most two initial-coverage replacement reservations, and 1,700,000 ms/36
calls total. These are allocation ceilings, not forecasts of cost, success, correctness, or quality.
Ordinary model-authored spawn remains charged only against the baseline ceiling and cannot consume
the recovery contingency; equivalent ordinary work after a recovery authorization is rejected.
Valid unavailable/empty provider results, weak or conflicting evidence, report rejection, caption or
Learning work, root failure, and ambiguous host-restart state do not enter this replacement lane.
Cold restart still interrupts ambiguous work and cannot reconstruct the process-local launch permit;
this slice proves duplicate prevention and honest interruption, not restart liveness or root
continuation.

The deterministic orchestrator remains an explicitly named test seam. Its host-authored child
contract proves scheduler/launch/replay mechanics only and is not model-planning evidence. The
guarded real-Codex proof requires `STUDIO_RUN_REAL_CODEX_SWARM=1` and an explicit
`STUDIO_OWNED_SWARM_MODEL`; by default it retains its run-start receipt, journal, and
content-addressed executor/usage objects under `.studio/owned-swarm-proofs`.

The exact runtime test executes that path against the receipted run-005 media, performs two reads,
one assessment, one audited decision, one host-only publish-review intake, independent approve,
reject, and revoke review paths, and an approval-gated caption job, then reopens the event journal to prove replay equivalence. It also
rejects fixture-only input, provider-field leakage,
duplicate work, limit violations, scope escalation, invalid registration, source/evidence-byte
drift, unauthorized media/evidence/assessment/decision calls, unread assessment inputs, non-audited
decision inputs, out-of-bounds fact
indexes, caller-controlled paths, malformed requests, changed receipt lineage, budget overflow, and
invalid handoffs.

This does not make the Studio live. A bounded local `codex exec` worker launcher and a separate
production-journal Studio adapter now exist, but `/studio/runtime/` is an inspector and does not
start workers. The default owned-source path consumes validated poll batches through that adapter
and renders production-only source-artifact, task, spawn request/decision, worker, grant, operation,
output-artifact lineage, decision facts, queued/rejected publish-review intake lineage, immutable
human review/revocation facts, caption job/artifact identities and counts, and report
facts without creating a `RunBundle`, legacy trace, or replay agent. The source region exposes only
validated ingest-origin identity and content facts, and
artifact references link only when their source/output destination is rendered. The deterministic
host exercises one real bounded seek plus worker-output receipt/report lineage. No hosted runtime
service or live control acknowledgement producer exists. The launcher can expose `media_extract`,
`media_seek`, `media_frames_sample`, `media_frames_ocr`, `media_speakers_analyze`, `evidence_read`, `evidence_assess`, and/or `evidence_decide`
only for matching live task grants, in addition to the closed
structured report output. `evidence.read` is not a detector call: it reads registered, immutable
V2/V3 receipt artifacts or V4 acoustic observations under an exact source/task window, per-artifact 32 KiB/64-fact ceilings, and the shared task tool-call
budget. `analysis.evidence.assess` adds a separate 1-assessment/4-receipt/8-claim/32-cited-index/
512-structured-token ceiling and requires exact fact indexes and bounding ranges. V1 and absent
receipts produce none of those grants. `analysis.evidence.decide` adds a separate one-decision/four-
audited-assessment ceiling and lets the host, not the caller, derive outcome/reasons.
`media.frames.sample` is a real sampling/byte-delivery capability under one exact owned source/video
scope and the shared task call budget; the child supplies timestamps only. Its receipt proves decode,
storage, lineage, and authorized PNG delivery, not OCR, scene/person understanding, right-frame
selection, or visual evidence admission. The default owned audio-study root does not request frames.
`media.frames.ocr` is a separate one-call capability over an already completed same-task frame
operation; the child supplies no paths, bytes, source, track, range, grant, or model configuration.
Its receipt proves which pinned local producer ran over which verified frame identities. It does not
prove text truth, identity, spelling, translation, cultural meaning, dialogue, or person identity.
`media.speakers.analyze` is a separate one-call capability over one exact owned audio range; the
child supplies no path, bytes, source, track, range, grant, model, clustering configuration, or
speaker count. Its receipt proves which pinned local producer ran over which sealed normalized
audio identity and how the complete granted range was accounted for. It does not prove person
identity, biometric/cross-run linkage, correct turn boundaries or speaker count, transcription,
translation, dialogue correctness, or caption authority.
Successful receipts conservatively charge the full authorized wall grant and separately record
elapsed host work before receipt persistence; the final append-only journal commit is an atomic
durability boundary, not a preemptible decoder/model interval.
`media.extract`, `media.seek`, `media.frames.sample`, `media.frames.ocr`, `media.speakers.analyze`, `evidence.read`,
`analysis.evidence.assess`, and `analysis.evidence.decide` are real
scheduler/host/child-bridge capabilities; assessment is opinion over completed reads and decision is
an audit-state gate, not sensing or publication. Publish-review intake is an application-host
producer rather than a child capability or MCP tool. It accepts only the exact identity of a
decision that passes the complete decision-receipt verification and records only `queued` or
`rejected`; it performs no review and creates no captions or publication state. Human review is a
second application-host authority over verified queued intake. It binds the configured local reviewer
and explicit attestation to one immutable approve/reject receipt; only an approval may receive one
separate immutable revocation. Approval means eligibility for the separate bounded caption producer,
not caption, correctness, upload, or publication state. Caption production is a third application-
host authority, shares per-runtime mutation serialization with review revocation, accepts no source,
range, path, bytes, or prose, and cannot upload or publish. The other media operations and
detector/model calls in this proposal remain unavailable. The tables below
continue to document the fixture contract itself and should not be read as the production wire
schema.

U1 adds `studio.preflight-bundle.v4` without rewriting V1–V3. It indexes a private
`studio.acoustic-observations.v1` complete range partition and a separate
`studio.acoustic-triage.receipt.v1` that closes the exact source, selected audio track, sealed
mono-16 kHz PCM, VAD receipt, model/runtime/configuration identities, limits, and observation
content. A V4 descriptor stores both objects content-addressed; `studio.evidence-read.receipt.v3`
exposes only clipped observation facts and carries the producer-receipt content identity. Acoustic
facts are not accepted as speech-specific evidence-assessment or `studio.study-report.v1`
citations. When V4 is present, `studio.study-readiness.receipt.v2` stores a deterministic
`studio.dialogue-scope-policy.v1` partition derived from VAD, acoustic uncertainty, and
`includeLyrics`. Only strong VAD non-speech plus strong noise, or strong music when lyrics are not
requested, becomes `not_in_requested_dialogue_scope`; mixed, weak, missing, truncated, failed, or
disagreeing evidence abstains. Excluded samples remain in full-duration accounting but are removed
from a separately reported semantic-coverage denominator. Readiness rejects supported study text
over an excluded range, and additive `studio.caption-production.artifact.v2` plus
`studio.caption-production.receipt.v2` storage and recursive reopening require null Korean and
English text for every excluded overlap. Caption V1 remains closed for runs without acoustic policy.
This is lineage and abstention authority, not acoustic accuracy,
speech absence, lyric understanding, transcription/translation truth, or semantic caption QC.

U3 leaves every closed v1 producer and receipt unchanged. `studio.evidence-citation.v1` binds one
typed evidence kind and use to an exact claim, coverage range, or media-context target. It carries
evidence artifact/content, producer receipt/content, source artifact/content/track, observation ids,
upstream and observation states, and temporal range, sampled media point, or future document-span
locators. A document span has no ambient authority: it must name the exact media entity/range it
qualifies. `sourceArtifacts` is exact lineage accounting only; it cannot substitute for the typed
observation-to-target association.

Admission dispatches by evidence kind and reconstructs the citation from cold producer bytes.
Current-run speech delegates to semantic-evidence reopening and is the only landed claim-support
kind; available temporal observations must exactly tile the claim. U1 acoustic citations reopen the
separate observation and producer-receipt bytes, derive content-bound observation ids, and may qualify
coverage but never transcript text. U2 frame citations delegate to complete frame sampling audit and
remain cite-only point identities. U5 OCR citations reopen the OCR observation/receipt artifacts,
current pinned runtime/model/config identities, and complete U2 lineage, and remain cite-only media
points. U6 speaker-turn citations reopen the separate anonymous speaker/overlap observations and
receipt, source, runtime/model/configuration lineage, and may qualify exact temporal coverage only;
the adapter reconstructs every accounting cell in the target range. External-document remains a
typed slot without a producer adapter and therefore fails closed.

`studio.study-report.v2` and `studio.parent-admission.receipt.v2` re-derive the U1
`studio.dialogue-scope-policy.v1` for the exact task. Deterministic precedence preserves conflicting,
failed, truncated, unavailable, withheld, unknown, and not-in-scope evidence over otherwise available
claims; worker-withheld and operation-failed are explicit abstention inputs. Prose is not an input to
that policy. `studio.owned-media-study.v2` copies only admitted citations and aggregates every child
state without truth arbitration. `studio.study-readiness.receipt.v3` reopens the complete chain and
checks only stored integrity, full range coverage, and unresolved conflict. It contains explicit
semantic/translation/truth non-claims and no quality score. `studio.caption-line-causality.v3` permits
text only from range-closing current-run speech citations under supported ready coverage; every other
state yields null source and target text.

These U3 objects are stored through the content-addressed artifact store and recursively cold-replayed
by host adapters. They remain the report/admission evidence layer for new owned runs. U4 now extends
the default terminal chain to owned-media study v3, readiness v4, and, only after a verified human
approval, caption-production/caption-causality v4. The launcher, worker report union, production-event
projection, validation union, artifact kinds, and observability index carry that chain; there is no
orphan additive host.
The explicit `studyContractVersion: "v1"` path preserves closed historical fixtures and receipts but
is not the default. Audio-only runs request no frames/OCR by default, U6 requires a separate explicit
grant, and absent acoustic, frame, OCR, or speaker/overlap evidence
supplies no authority; only current-run speech may authorize dialogue text. Studio UI projection remains
outside this cutover. This boundary proves citation
integrity, coverage policy, and abstention preservation—not multimodal understanding, OCR accuracy, scene
semantics, producer accuracy, independent corroboration, truth arbitration, or caption quality.

U4 does not reuse or mutate v1 planning/follow-up events. `studio.study-restudy-input.v1` is a
host-derived view over the current admitted v2 reports: each candidate names one exact non-supported
coverage cell, its evidence-tied cause/raw states, and prior report, admission, citation, observation,
and current-run speech-operation/range identities. The model request contains only `inputId`, the
exact `coverageId`/`causeId`, and one typed delta. Attenuated speech and bounded padded audio are the
registered current-run speech deltas. Denser frame timestamps, alternate receipted configuration,
and granted-specialist members remain reserved union shapes and fail closed because they have no
registered producer/grant.

For `speaker_overlap`, the host classifies only a cold-audited `speaker_turn` /
`coverage_qualification` temporal observation whose state/raw tuple is exactly `conflicting` /
`speaker:overlap:overlap_hypothesis_requires_speech_restudy`, lies inside the synthesized conflicting
cell, and is backed by strictly broader current-run speech. Raw aggregate text alone, rapid turns,
no-hypothesis cells, truncation, and missing speaker grants do not qualify. The host deterministically
chooses at most one overlap cell for a weak coverage cell and binds its report/citation/observation
identities into the cause. A request must echo that exact cause range; it cannot widen, narrow, or
rename it `recognizer_disagreement`.

The registered `attenuated_subrange` producer requires either that exact overlap range or, for other
causes, a strict contained weak range, always previously covered by broader current-run speech work.
The host fixes pass number 2, the runtime-injected current-run
recognizer configuration scope, a 20,000 ms/one-call reservation, and a single v2 report child with
attenuated immutable task context. `studio.study-range-pass-request.receipt.v1` retains the prior
evidence, cause, delta, producer/configuration, pass number, reservation, caps, and explicit
understanding/improvement/semantic-correctness non-claims. The scheduler admits at most one pass per
range and four per producer, rejects an already accepted work/configuration fingerprint—including a
concurrent identical request—and applies the ordinary scope, depth, concurrency, dependency, and run
budget checks. An unchanged/full weak range is not an attenuation for ordinary causes and is rejected
before scheduling. The overlap exception changes only range selection; caps, producer, configuration,
normalization, work fingerprint, reservation, and dedupe remain identical.

The registered `padded_audio_window` producer is unavailable for `speaker_overlap`. For another
cause, it requires exact prior current-run speech over the complete weak range, adds context on at
least one side and no more than 2,000 ms on either side, stays inside the root audio scope, and stays
within the speech-operation duration ceiling. The declared padding must exactly match the derived
execution range. It uses the distinct
`runtime_injected_current_run_recognizer_bounded_padding_v1` configuration scope, the same pass caps,
and one `speech.transcribe` plus `report.submit` child. Broader-context text is retained as structural
operation/report lineage only. It cannot upgrade support, compare semantic statements, or change the
prior weak class.

`studio.study-range-pass-terminal.receipt.v1` retains the scheduler task identity, complete optional
report/admission/read lineage, cited/new/disagreement citation sets, executor active time, capability
call count, available model usage or its closed absence, terminal outcome, and exhaustion bit.
`studio.owned-media-study.v3` stores every admitted report and every accepted terminal pass in
deterministic order. An attenuated weak cell becomes supported only for the exact executed subrange when one
range-closing child claim is supported entirely by pass-new current-run speech citations. Prior
conflict or statement disagreement cannot upgrade, and a padded pass always remains weak. Residual
and exhausted cells remain unknown,
withheld, or unavailable; unrelated supported ranges continue. `studio.study-readiness.receipt.v4`
retains pass receipt identities and terminal weak coverage without treating one exhausted range as a
global blocker, while unresolved conflict or stored-integrity failure still withholds. Caption
causality v4 authorizes text only on supported cells and retains `passIds`/preserved states; weak cells
remain locally null/withheld. Pass count, tokens, agents, labels, citation closure, and scheduler
success are not understanding, correctness, accuracy, quality, improvement, or publication evidence.

U5 adds `media.frames.ocr` without changing the U2 receipt or the speech/caption authorization
rules. The scheduler issues it only with `media.frames.sample` over the same single owned-source/
video-track/range. The task-private bridge accepts exactly `{ frameSamplingOperationId }`; the host
injects operation/task/agent/grant/source/track/range and requires that U2 operation to be completed
by the same task, agent, execution, and immutable scope. Duplicate work and calls beyond the single
grant call are rejected. The launcher requires a completed OCR operation before accepting output
from an OCR-granted child.

The producer seam is `OcrRecognizer`. Production uses Tesseract.js 7.0.0,
`tesseract.js-core` 7.0.0, and `wasm-feature-detect` 1.8.0, with vendored
`tessdata_fast` 4.1.0 `kor` and `eng` integer-LSTM data at commit
`65727574dfcd264acbb0c3e07860e4e9e9b22185` under Apache-2.0. The fixed configuration is
LSTM-only, automatic page segmentation, preserved inter-word spaces, NFC plus whitespace-collapse
normalization, local language data, no network fetch, and no trained-data cache. The receipt hashes
the package/core/feature files actually eligible for execution plus both model files and records the
Node platform. Cold audit recomputes those identities and reopens the source, U2 manifest/receipt,
every input PNG, the canonical OCR observations, and the OCR receipt; content, runtime, model,
configuration, or frame-lineage drift fails closed.

The fixed envelope is one call, at most 4 frames, 64 boxes/frame, 128 boxes total, 2 MiB/frame,
8 MiB aggregate input, 256 Unicode code points/box, 4,096 code points total, 256 KiB each for
observations and receipt, and 45,000 ms wall, with a minimum confidence of 70. Available hypotheses
store exact frame id/content/timestamp, a frame-bounded box, normalized text, integer confidence,
state, and reason. Below-threshold text and overlapping different hypotheses store
`normalizedText: null` as unknown; output-limit overflow stores a truncated frame with no partial
observations. Missing grant/frame/model, out-of-range U2 requests, oversized input, timeout,
recognizer failure, runtime drift, and artifact overflow create no usable output/receipt authority.

`ocr_span` is admitted only as `cite_only` `media_context` with `media_point` locators. The worker
must echo exact authenticated OCR artifact/content/receipt/observation identities; the host rebuilds
the citation and adds only its observation/receipt artifacts to report-v2 source lineage. OCR
citations never enter coverage or claim citation ids. The existing claim-support validator and every
caption causality version continue to accept only range-closing `current_run_speech`, so OCR cannot
replace or overwrite spoken evidence or authorize Korean/English caption text. Scene/shot
boundaries, script/language inference, subtitle-perfect aggregation, root-selected visual
specialists, U4 denser-frame/specialist deltas, UI, face/biometric/person identification, and frame
publication are not implemented by this slice.

U5.1 adds `media.visual-transitions.analyze` as a separate one-call grant over the same exact
owned-source video track and range as completed same-task U2 frame sampling and U5 OCR. The
task-private bridge accepts exactly `{ frameSamplingOperationId, ocrOperationId }`. The scheduler,
authorization host, and projection require 2 to 4 ordered frames, the U5 operation bound to that
exact U2 operation, and one active same-task, same-agent, same-executor launch lineage. Duplicate
canonical work, cross-task inputs, exhausted task calls, and grant reuse fail before production.

The deterministic producer decodes the cold-audited 8-bit RGB PNG bytes, samples the nearest cell
center on a fixed 32 by 32 grid, and computes the adjacent-frame mean absolute RGB channel
difference in integer parts per million. A score at or above 250,000 ppm is stored only as
`visual_change_candidate`; lower scores are `below_visual_change_threshold`. Available OCR
hypothesis sets are deduplicated, sorted, and fingerprinted per frame. Their changed, unchanged, or
unavailable comparison is secondary lineage only and cannot change the pixel threshold.

The envelope is one call, 2 to 4 frames, 2 MiB per frame, 8 MiB aggregate input, 256 KiB each for
observations and receipt, and 5,000 ms wall. Separate private content-addressed observation and
receipt artifacts retain exact U2 manifest/receipt/PNG identities, U5 observation/receipt
identities, frame timestamps and dimensions, producer configuration, scores, classifications,
interval ids, and nonclaims. Cold audit reopens all U2/U5 content and reruns the RGB-grid analyzer.
Byte, lineage, score, classification, threshold, interval, receipt, or runtime drift fails closed.

`visual_transition` enters U3 only as `cite_only` `media_context` with exact temporal-range
locators. It never enters claim or coverage citation ids and grants no scene, shot, cut, semantic,
identity, OCR-truth, dialogue, caption, quality, or publication authority. The default audio-study
root still requests no frames, OCR, or visual transitions. Scene/shot production, denser-frame U4
wiring, automatic visual-specialist routing, UI projection, and semantic visual understanding remain
outside this slice.

U6 adds `media.speakers.analyze` without changing speech or caption claim authority. The scheduler
issues it only over one owned-source audio-track range of at most 120,000 ms and one call. The
task-private bridge accepts exactly `{}` and injects operation/task/agent/grant/source/track/range;
the launcher requires a completed operation, cold-audits it, and requires the worker to echo only
the exact authenticated observation/content/receipt identities. A worker cannot choose paths,
ranges, models, speaker count, individual turns, or favorable accounting cells.

The replaceable producer seam is `SpeakerDiarizer`. Production in this slice uses the official
native `sherpa-onnx-node` 1.13.4 package and pinned darwin-arm64 addon at git revision
`142807252687d81b40d6315f23470a1512a00de3`, CPU provider with one configured inference thread and
no runtime network. Models are vendored pyannote segmentation 3.0 (`MIT`, SHA-256
`220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079`) and 3D-Speaker ERes2Net
base 16 kHz (`Apache-2.0`, SHA-256
`1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b`). The fixed configuration
uses mono 16 kHz normalized float inference, automatic cluster count (`-1`), threshold 0.5,
minimum-on 0.3 s, minimum-off 0.5 s, and integer half-open millisecond output. Current pinned
production support is darwin-arm64 only; another platform needs its own reviewed native package
hashes behind the same seam rather than an unpinned fallback.

The host re-hashes the registered source, decodes only the granted range to sealed s16le PCM, then
maps producer cluster integers by first appearance to `anon_cluster_N`. Labels are scoped to the
run, source artifact, and operation and have no identity meaning. The observation artifact contains
raw turn intervals with unquantified model score uncertainty plus a sorted, gap-free,
non-overlapping partition of the entire granted range: one-label cells are `available` anonymous
turns unless shorter than the 500 ms reliability floor; multi-label cells are `conflicting`
overlap; rapid cells and no-hypothesis cells are `unknown`; output-count overflow replaces the
whole result with one `truncated` cell rather than retaining a favorable partial result. Empty means
no cluster hypothesis, not proof of non-speech. The receipt retains source/normalized-audio content,
authorization/execution/launch lineage, producer/runtime/model/configuration hashes, limits,
measured counts, conservative full-grant wall accounting, output identity, and explicit person,
biometric, cross-run, named-speaker, transcript, translation, dialogue, and perfect-diarization
non-claims.

Hard limits are 512 MiB registered source, 120,000 ms/1,920,000 decoded samples/3,840,000 normalized
PCM bytes, 256 raw turns, 512 accounting cells, 16 local clusters, 512 KiB observations, 256 KiB
receipt, 60,000 ms wall, and one call. Missing grant/source/audio/model, runtime drift, decoder or
producer failure/timeout, oversize input, artifact overflow, duplicate work, or exhausted budgets
produce no usable output/receipt authority. Cold audit reopens source and both canonical artifacts,
re-derives receipt/artifact ids and authorization/source/range/output relationships, and re-hashes
the current native/model lineage without rerunning inference; content or lineage drift fails closed.

U3 admits `speaker_turn` only as `coverage_qualification` with temporal-range observations and a
stored receipt artifact. The target must stay inside the audited grant and align with accounting
cell boundaries; the host reconstructs every cell needed to tile it. Overlap remains conflicting,
rapid/no-hypothesis remains unknown, and truncation remains truncated under existing precedence.
`claim_support` validation and every caption-causality version still accept only range-closing
`current_run_speech`, so speaker labels, turn splits, and overlap cannot create, replace, or upgrade
Korean/English text. U6.1 adds the closed `speaker_overlap` U4 cause and exact range rule described
above. It can schedule one bounded speech restudy but does not resolve the preserved conflict, create
transcript truth, or authorize captions. Named/cross-run identity, a fit-for-purpose diarization
quality bench, alternate models, non-darwin native platform pins, ambient always-diarize policy, U7
separation, and all UI work remain outside this slice.

U7 adds `study.separate` to the default restudied root without mutating the U3 admission or U4 study
schemas. The root tool is `study_separation_request`; its request is exactly `{ inputId, triggerId }`.
The request host cold-audits completed U6 operations and exposes only cells whose stored accounting
state is `conflicting`, kind is `overlap`, and uncertainty reason is
`overlap_hypothesis_requires_speech_restudy`. The special scheduler path copies that cell's exact
owned-source content id, audio track, and half-open range into one `media.audio.separate` grant.
Ordinary model-authored spawn cannot request that capability, and the child-facing separation tool
accepts exactly `{}`. Missing root grant, model-authored range/model/path fields, a changed U6
identity, widening or narrowing, duplicate work, or a non-triggered range fails closed. U7.1 adds a
second closed eligible cause on the same tool and the same one grant/producer/comparison path: the
request host also reopens and content-verifies the preflight `acoustic_ranges` observations and their
producer receipt (via `reopenAcousticCitationSource`) and exposes only cells classified `mixed`,
which by the U1 acoustic contract necessarily means strong certainty with both speech and music above
the support threshold, i.e. a `u1_acoustic_mixed` trigger over that exact cell's owned-source content
id, audio track, and half-open range. The trigger kind is an additive discriminated union beside
`u6_speaker_overlap`; no other acoustic class or VAD/policy state grants separation, a forged
class/range/observation id fails the closed `{ inputId, triggerId }` echo, and identical U1 and U6
ranges dedupe to one work item. Because SepFormer is a two-speaker wsj0-2mix model, a speech-plus-music
`mixed` cell runs it out of domain and the receipt still carries null semantic preference and
`not_granted` caption/semantic authority.

The replaceable producer seam is `SourceSeparator`. The qualified local implementation is
`speechbrain-sepformer-wsj02mix` version 1 on macOS arm64, Python 3.14, SpeechBrain 1.1.0, Torch and
torchaudio 2.11.0, CPU/one-thread execution, and a network-denied subprocess. It uses
`speechbrain/sepformer-wsj02mix` at revision
`3a2826343a10e2d2e8a75f79aeab5ff3a2473531`; the executable YAML/encoder/decoder/mask-network files
are checked against the four content ids in `SEPARATION_METHOD` before HyperPyYAML parsing and again
inside the runner. Installation is explicit through
`python3 scripts/bootstrap-u7-separation.py --accept-model-card-license`; model/runtime bytes live
under ignored `.studio/separation-runtime`,
not Git or the artifact publication surface. Missing files are typed `model_unavailable`; changed
model, package, adapter, or configuration lineage is `runtime_drift`. There is no unpinned or fake-
stem fallback.

Immediately before inference the host repeats the U6 cold audit, resolves and re-hashes the owned raw
artifact from the content-addressed store, seals a private snapshot, and decodes only the grant to
mono 8 kHz PCM16 WAV. The host leaves the raw artifact intact. It stores exactly two anonymous
ordered estimates as private derived `studio.separated-audio-stem.v1` artifacts. Each stem origin
directly binds the raw artifact/content/audio track/range, trigger operation/observation, receipt,
method, four model content ids, and configuration content id. Canonical private non-media artifacts
`studio.conditional-separation.receipt.v1`, `studio.raw-stem-comparison.v1`, and
`studio.raw-stem-comparison.receipt.v1` close authorization, launch/execution, normalization,
runtime/model/configuration, output, recognizer, and non-claim identities.

The fixed grant permits one call, one range no longer than 10,000 ms, 80,000 decoded samples, two
stems, 512 MiB raw source, 160,128 bytes each for normalized audio and each stem, 256 KiB separation
receipt, 512 KiB comparison, 256 KiB comparison receipt, 256 recognizer segments per input, and
60,000 ms wall time. Source, decoder, separator, recognizer-lineage, timeout, oversize, or artifact
failure records a closed typed failure and creates no completed stem/comparison authority.

One `CurrentRunSpeechRecognizer` descriptor is used over the raw grant and both selected estimates.
Raw timestamps remain absolute; stem-relative segments are rebased to the same exact source range.
If all three results are available, NFC/trimmed/whitespace-collapsed text comparison deterministically
returns `agreement` or `disagreement`; otherwise it returns `abstention` with
`recognizer_unavailable_or_incomplete`. The comparison gate establishes verified lineage,
same-recognizer use, exact-range association, and structural comparability only. Its
`semanticPreference` is always null, while semantic and caption authority are always `not_granted`.
Stem results are not U3 citation inputs and cannot become `claim_support`, study claims, or caption
text through this contract.

Cold `auditConditionalSeparation` starts from the completed journal operation and reopens the raw
artifact, both private stems, separation receipt, comparison, comparison receipt, the exact audited
trigger cause for its kind (the U6 overlap cell or the U1 `mixed` acoustic cell), and current producer
lineage by content identity; caller paths are not authority and separation is not rerun. Derivable artifact/receipt ids, canonical bytes, authorization, source/range/trigger,
method/model/configuration, recognizer, and explicit non-claims must all agree. A clean-sounding
estimate, same-recognizer agreement on related audio, or successful separation is not independent
truth, transcription/translation correctness, speaker/source identity, quality, improvement,
caption authority, publication, or public availability. Independent evidence or human review is
required before any semantic preference, and inconclusive comparison remains abstention/withheld.

The evaluation-only `studio.bench.u7-follow-through.v1` audit closes the registered minimum capture
grid without creating captures or scores. It derives three repetitions for every frozen clip and
both ordered anonymous stem roles, for 9 required pairs and 18 capture slots in the current pack.
Every slot remains exactly `pending`, `captured_unscored`, or `scored`; any capture must arrive as a
complete same-operation pair, and any score must bind one exact capture with `judge: null`. Extra
positive repetitions are retained separately rather than selected or discarded. The report and its
current state are content-addressed, while result, preference, and judge authority remain null.

`npm run u7:check` validates the portable registration, inputs, packaging, minimum grid, and
hostile-state matrix. `npm run separation:check` adds portable negative producer checks;
`npm run separation:local` runs the complete positive producer matrix plus local readiness only when
the ignored qualified runtime is installed. `npm run u7:readiness` separately checks the ignored
local source bytes and existing pinned separator lineage. Missing source files, byte drift,
unsupported platforms, missing model bytes, runtime drift, and timeout remain typed local readiness
states. Local readiness is not a repository-wide platform pin and is not capture completion. The
current repository has zero U7 capture pairs and zero U7 score receipts, so actual execution and
exact-byte-bound blinded human scoring remain required before any semantic result exists.

The R1 bounded research contract is wired trigger-gated on the same shape as conditional
separation, across a root capability `study.research` and a child capability
`research.investigate`. The retained v1 `ResearchRequestHost` derives one content-addressed trigger
per unresolved conflict of a completed, byte-verified v1 study. On the default v3 spine,
`RestudiedResearchRequestHost` instead cold-reopens the pre-synthesis v3 inspection after at least
two admitted reads. It records `studio.research-request-input.v2` through
`research.request_input_recorded`, closing the input over the active root executor, every ordered
admission/read identity, every accepted terminal pass identity, and exact conflicting coverage
states, raw states, claims, citations, and pass ids. `researchRequestInputs` is durable candidate
state, not grant authority; non-conflicting inspection records an empty trigger list.

The admitted-read result exposes that exact `researchInput`, and `study_research_request` accepts
only its `{ inputId, triggerId }` echo. `scheduler.requestResearch` re-derives v1 triggers or, for
v2, requires the projected candidate and synchronously checks that its admission/read/pass basis is
still current without repeating the asynchronous byte audit. It also requires the recorded
`orchestrator.tool_called` entry plus the root `study.research` grant and byte-compares the
host-fixed child contract (workload key
`research:<triggerId>`, one `studio.study-report.v2` output, capabilities exactly
`research.investigate` plus `report.submit`, budget pinned to `RESEARCH_LIMITS`), rejects consumed
triggers as `research_duplicate_work`, and mints the grant scope from host policy only: limits are
`RESEARCH_LIMITS` verbatim and the domain allowlist is scheduler composition policy that defaults
to empty, meaning no egress. Nothing model-authored enters the scope, and ordinary
`task_spawn_request` can never acquire `research.investigate`. Ambient codex `web_search` stays
disabled; the only egress path is the task-private research bridge.

The launcher constructs one `BoundedResearchHost` per research-granted launch, bound to the real
`executor.started` lineage, with the fixture search provider as the default seam, and mounts
`research_search` and `research_document_snapshot` through the authenticated loopback bridge only
under that grant. Ledger-bound operations journal `research.operation_started`,
`research.operation_completed`, and `research.operation_failed` events from producer
`research_host`; the `researchOperations` projection fold re-enforces the registry rules (per-grant
fingerprint dedupe, call/query/document budgets that keep charging failed operations, and
snapshot-requires-completed-same-grant-search), records artifacts under the
`research_search_receipt`, `research_document_snapshot`, `research_extraction`, and
`research_snapshot_receipt` origins, and pins receipt authorization to
`{ grantId, taskId, agentId, executionId, launchClaimId }`. Unbound fixture receipts keep the
narrow three-field authorization and never invent execution identities. Search snippets stay
`routing_hint_not_citation`; snapshot receipts keep
`dnsRebindingWindow: "checked_before_fetch_not_pinned"` (the destination address is re-resolved
between the policy check and the fetch because no pinned dialer exists yet) and
`speechEvidenceAuthority: "not_granted"`. Admission binds an `external_document_span` citation to
its projected research operation's task, agent, and execution, admits it `cite_only` as media
context only, and the closed citation validator keeps `claim_support` structurally reserved for
current-run speech.

`ResearchExhaustionHost` owns the first typed R1 terminal cause. It accepts no caller-authored task,
grant, gap, operation, or reason. It can record
`studio.research-exhaustion.receipt.v1` only when the bound active executor used the complete
registered query budget and every query completed with an empty, cold-audited search receipt. The
receipt binds the run, grant, task, agent, executor, launch, exact gap, ordered search receipt
identities, and limits. `research.exhaustion_recorded` projects it into `researchExhaustions` under a
private content-addressed artifact. Replay rechecks the complete empty-query basis and artifact
lineage; cold audit reopens every search receipt. The outcome is `r1_insufficient` only in this
structural sense. Its non-claims keep semantic insufficiency, source truth, entity match, speech,
claim-support, and caption authority closed; `r2Authorization: "cause_only"` makes it a future
authorization input, not an R2 grant. Unused query budget or failed operations cannot produce the
cause. The default v3 root now holds dormant request authority and can mint one child only from a
current projected conflict; research is never automatic.

The production worker-to-v2-report path now retains each cold-audited snapshot through worker-result
validation. A research-granted worker may return only a closed `researchEvidenceInputs` list naming
the exact snapshot receipt artifact/content and extraction artifact/content identities plus sorted,
non-overlapping UTF-8 byte spans. The list may select a subset of completed snapshots or stay empty;
search operations, snippets, URLs, document text, and caller-authored targets are never accepted.
The launcher rejects identity or executor drift before report construction. The v2 builder then uses
the existing `externalDocumentSpanCitation` constructor over the retained audit object and the
grant-owned media target. These citations enter only the report-level evidence list as `cite_only`;
they never enter claim or supported-coverage citation ids and grant no speech, caption, source-truth,
entity-match, freshness, or quality authority.

The R2 producer core now has an optional production-runtime path. `computer.use.readonly` is a
global child capability, while `study.computer-use` is a distinct dormant root request capability.
Neither appears on the default root grant. A composed scheduler must also receive a sealed offline
surface and driver policy, so the default runtime cannot request or execute R2 work. Ordinary
model-authored spawn rejects `computer.use.readonly`; only the dedicated recorded
`study_computer_use_request` root tool can enter `scheduler.requestComputerUse`.

The request tool exposes only `{ inputId, candidateId }` from a host-derived candidate. Admission
cold-reopens the projected `studio.research-exhaustion.receipt.v1`, then the scheduler re-derives the
same current v3 research basis and requires the exact exhausted gap and current root executor. The
child contract is fixed by the host, including workload key, output kind, capability set, limits,
and `computerUseScope`. Duplicate work fails closed. `BoundedComputerUseHost` still accepts only the
injected task/agent/grant view and a closed four-identity request. Its scope fixes the exact
owned-media gap, exact R1 cause, one lowercase HTTPS origin and entry surface, one driver identity,
all limits, and disabled cookies, credentials, uploads, downloads, mutations, and egress. The
request has no URL, action, selector, coordinate, script, credential, cookie, path, or free-form
objective field. An operation and its grant fingerprint are charged before cause audit or driver
work, so failed attempts cannot retry around the one-call budget.

The only current driver is `offline_fixture`. It exposes one deterministic in-memory state graph and
a host-owned script of declared `follow_readonly_transition` actions. It has no network, filesystem,
cookie, credential, download, upload, or mutation interface, and its accounting must keep all egress
and download counters at zero. The host validates the complete trace before storage and enforces the
fixed action, step, screenshot, dimension, pixel, byte, visible-content, wall, call, session, egress,
and download ceilings. The registered wall ceiling, or a stricter host-composition ceiling, forms one
effective deadline across R1 cause audit, driver execution, all storage, final cold audit, and normal
temporary cleanup. Failed work stays charged. A shared bounded RGB PNG verifier checks signature,
chunks, CRCs, dimensions, bounded decompression, RGB24 size, and scanline filters while the existing
frame wrapper retains its own failure vocabulary.

Before writing output, the host hashes and validates the complete trace against a canonical sealed
fixture manifest and precomputes every JSON byte size and aggregate. Each state then produces a
private content-addressed screenshot and canonical visible-content snapshot. Each transition
produces a canonical action receipt, and the terminal canonical session receipt binds the exact
cause, gap, surface, stored fixture manifest, driver, offline isolation declaration, ordered
states/actions, stop reason, limits, accounting, and non-claims. Artifact identifiers include run,
session, kind, ordinal, and content identity, so identical screenshot bytes at distinct states stay
distinct contextual objects. Cold audit reruns no driver. It reopens and re-hashes the R1 cause,
fixture manifest, session receipt, every screenshot, visible-content snapshot, and action receipt,
rechecks PNG bounds, reconstructs the session id from run/operation/grant, verifies every cumulative
action prefix, and reconstructs all contextual identities and ordering.

The launcher mounts exactly one task-private `computer_use_readonly` tool with an empty-object
request. Its loopback bridge binds the grant, task, execution, and launch claim; validates the
canonical session receipt, screenshot bytes and dimensions, visible content, actions, state
envelopes, identities, and ordered lineage; and requires exactly one same-grant completed operation.
The runtime wrapper journals `computer_use.operation_started`, `computer_use.operation_completed`,
or `computer_use.operation_failed` with producer `computer_use_host`. Completion is atomic with the
five private runtime artifact origins: fixture manifest, screenshot, visible content, action
receipt, and session receipt. Projection and cold replay preserve the operation and its executor and
launch lineage, while Studio output projection excludes these host-private artifacts.

A worker may select only bounded region identities from the completed offline session. The v2
report builder emits them as `external_screen_region` citations with locator `screen_region`, and
admission requires the same task, agent, executor, session, and screenshot. They are report-level
`cite_only` media context only: they cannot enter claims or supported coverage and grant no source
truth, entity match, currency, visual understanding, speech, caption, quality, or readiness
authority.

This configured path proves deterministic policy enforcement, runtime authorization, immutable
fixture lineage, and cite-only external-screen admission. It does not observe live external state or
prove browser process isolation, DNS containment, credential isolation, source freshness, or any
semantic conclusion. There is no live browser, network, cookie, credential, download, upload, or
mutation path. A real isolated read-only driver remains future R2 work.

The production event union now includes
`analysis.evidence.assessment_started`, `analysis.evidence.assessment_completed`, and
`analysis.evidence.assessment_failed`. A completed event binds its operation to the private
assessment artifact and `studio.evidence-assessment.receipt.v1` content identity; failed events
carry only the closed runtime failure shape. These events stay in the production journal and never
enter legacy replay.

`GET /v1/runtimes/:runtimeId/assessment-audits` is a separate path-free read contract rather than a
new runtime event. Its `studio.local-runtime-assessment-audits.v1` response names the command,
runtime, validated journal head, and zero or more fully reopened audits. Each audit contains only
the assessment operation/artifact/receipt/task/agent identities and structured claims with exact
range, value, preserved states, cited read operation/receipt/content/evidence-artifact identities,
and returned-fact indexes. Any missing object, changed byte, non-canonical content, swapped identity,
out-of-lineage read, invalid index/range/state, or disagreement between stored receipt, artifact,
completion event, and full projection rejects the whole response as `stored_content_inconsistent`.
An empty response is valid when no completed assessment exists, including V1. The audit certifies
receipt integrity and citation closure only; it does not certify media truth or semantic quality.

The production event union also includes `analysis.evidence.decision_started`,
`analysis.evidence.decision_completed`, and `analysis.evidence.decision_failed`. The start binds
exact audited assessment identities and grant bounds; completion binds the deterministic receipt,
private artifact, outcome, reasons, and audited counts. `GET
/v1/runtimes/:runtimeId/decision-receipts` returns
`studio.local-runtime-decision-receipts.v1` only after stored decision bytes, every input audit, and
the re-derived policy agree with the full journal. `proceed_to_publish_review` means only that the
separate host intake producer may place the receipt in the human-review queue. No review, caption,
upload, or publication follows.

The production event union also includes `publish.review.intake_started`,
`publish.review.intake_completed`, and `publish.review.intake_failed`. These are application-host
events, not child events: the start binds one exact decision operation/artifact/receipt/content
identity, and completion binds one private `studio.publish-review-intake.receipt.v1` artifact. The
producer first runs the complete decision-receipt verification. A verified
`proceed_to_publish_review` decision yields `queued`; a verified `withheld` decision yields
`rejected` with the unchanged decision reason codes. The closed request rejects raw decision bytes,
paths, caller-authored captions or prose, caller-selected outcomes, and publication controls.

`GET /v1/runtimes/:runtimeId/publish-review-intakes` returns
`studio.local-runtime-publish-review-intakes.v1` only after re-hashing each stored intake receipt,
checking its artifact and journal lineage, and repeating the full decision, assessment, and read
verification. Any tamper or policy drift rejects the whole response as
`stored_content_inconsistent`; no partial intake lineage is returned. V1 and runtimes without a
completed decision return an honest empty list. `queued` means awaiting human review only, while
`rejected` means the verified decision did not permit queue entry. Neither outcome means reviewed,
captioned, uploaded, published, public, media-true, or English-correct.

The production event union also includes `publish.review.decision_started`,
`publish.review.decision_completed`, `publish.review.decision_failed`,
`publish.review.revocation_started`, `publish.review.revocation_completed`, and
`publish.review.revocation_failed`. These are host events, not child events. A decision start binds
one exact queued intake identity, reviewer id, required attestation, closed outcome/reasons, and
bounded optional note; completion binds the host-supplied reviewer label and private
`studio.publish-review-decision.receipt.v1` artifact. Revocation similarly binds one exact verified
unrevoked approval and a private `studio.publish-review-revocation.receipt.v1`. There is one decision
per intake, rejection cannot become approval without new intake, and there is at most one revocation.

`GET /v1/runtimes/:runtimeId/publish-review-decisions` returns
`studio.local-runtime-publish-review-decisions.v1` only after every stored review and revocation is
re-hashed and its complete intake/decision/assessment/read lineage agrees with the journal. The same
resource accepts closed decision POSTs; `POST
/v1/runtimes/:runtimeId/publish-review-revocations` accepts closed revocations. The host exposes its
single local reviewer id/label and exact attestations in the GET response; the caller cannot supply
the label. Raw receipt bytes, paths, captions, prose-as-output, open fields, rejected intake, forged
reviewer identity, tamper/drift, and illegal transitions fail closed. V1 and absent review lineage
return an honest empty list. These review endpoints generate no captions, translation, study output,
upload, or publication; caption production requires its own explicit endpoint and re-verification.

The production event union also includes `caption.production_started`,
`caption.production_completed`, and `caption.production_failed`. These are application-host events,
not child events. Start binds one exact approval identity plus the host-derived ingest artifact,
content id, analysis request/range, fixed KO/EN pair, executor descriptor, and exact
`CAPTION_PRODUCTION_LIMITS`: 120,000 ms, 64 lines, 32 KiB source text, 32 KiB target text, 128 KiB
canonical artifact, and 60,000 ms wall time. Completion binds a private
`studio.caption-production.artifact.v1`, a private `studio.caption-production.receipt.v1`, exact
content-addressed artifact/receipt identities, closed `completed|partial|withheld|unavailable`
status, and line/source-available/target-available/withheld/unavailable counts. Timed lines are
ordered, non-overlapping, inside the approved half-open range, fixed to KO source and EN target, and
carry available/withheld/unavailable state with closed reasons. An unavailable or withheld target
has null text; the host never invents fluent EN to close a gap.

`GET /v1/runtimes/:runtimeId/caption-productions` returns
`studio.local-runtime-caption-productions.v1`; the same resource accepts POST with exactly one
`PublishReviewDecisionReceiptIdentity`. The host first reopens the stored approval through the full
review/intake/decision/assessment/read verification and requires no revocation before the start
event. Caller review bytes, reject receipts, revoked approvals, paths, source/range/executor fields,
caption prose, and open fields fail closed. The authenticated GET re-hashes the stored caption and
receipt, rechecks artifact/journal/count/executor/source/range bindings, and recursively repeats the
approval audit. Revocation before or during the job invalidates the start/read. A revocation whose
start follows caption completion leaves immutable prior artifacts visible with
`revoked_after_completion`; it prevents any new start and deletes nothing. V1 and no-approval runs
return an honest empty list. The default executor is classified
`recorded_real_pipeline_fixture` because it adapts the existing run-clip output; the opt-in live
executor is `real_recognizer_translator`. Neither classification claims English quality, upload,
publication, public bytes, or Studio completeness.

`GET /v1/runtimes/:runtimeId/caption-production-results` returns
`studio.local-runtime-caption-production-results.v1`. It repeats the same complete caption,
receipt, approval, and revocation audit and, only after that audit closes, includes the validated
`studio.caption-production.artifact.v1` timed KO/EN projection beside its verification identities.
No completed job, including V1-only and revoked-before-start paths, returns an empty list. Stored
tamper rejects the whole read as `stored_content_inconsistent`; the browser never resolves a
fixture or object-store path. This authenticated private read adds no replay identity, upload, CDN,
publication, English-quality claim, or score.

The production event union also includes `language.explanation_started`,
`language.explanation_completed`, and `language.explanation_failed`. This is a private post-caption
Apply producer, not a child capability and not a new `OutputDepth`. Its closed request contains only
one exact verified caption job/artifact/content/receipt identity, one caption line id, one selected
source or target span using Unicode code-point offsets plus exact text, and an ordered subset of the
closed v1 facet kinds: `meaning`, `word`, `phrase`, `grammar`, and `translation_choice`. The host
reopens the complete caption and approval lineage, requires authority to remain unrevoked, checks
the span against stored caption text, derives at most five stored caption-context lines, and mints
the private grant. Caller captions, explanation prose, prompts, evidence claims, citations, model
configuration, paths, export controls, and open fields are rejected.

Completion stores private content-addressed `studio.language-explanation.artifact.v1` and
`studio.language-explanation.receipt.v1` objects with exact source, study, readiness, approval,
caption, selected-line, timing, availability, executor, prompt-contract, configuration, result, and
rights lineage. Each requested facet is `available`, `withheld`, or `unavailable` with a closed
reason. Available prose is `host_receipted`, `not_reviewed`, and
`caption_context_inference`; external citation ids remain empty because caption context is input,
not proof of explanation correctness. Output is private and export eligibility is unavailable.
Fixed bounds are five context lines, five requested facets, three attempts per exact request, 256
selected code points, 32 KiB per caption snapshot, 8 KiB per explanation text field, 64 KiB
generator output, 128 KiB provider envelopes and canonical artifacts, 4,000 completion tokens, and
60 seconds.

`GET /v1/runtimes/:runtimeId/language-explanations` returns
`studio.local-runtime-language-explanations.v1`; the same resource accepts the closed POST. The GET
re-hashes both stored objects, reopens the exact production caption recursively, repeats the
selection/context/authority checks, and rejects the whole response on tamper or mixed identity. It
returns every immutable attempt as `started`, `completed`, or `failed` plus the artifact and receipt
body for each completed result. A failed provider attempt remains visible and an identical retry
receives the next host-derived attempt number up to the fixed three-attempt ceiling; an active or
completed request cannot execute again. Explicit host recovery closes a process-interrupted
`started` attempt as failed without inventing output, after which the bounded retry policy applies.
The strict client re-hashes both bodies and closes attempt, grant, artifact, receipt, caption, span,
facet, and result identities one-to-one. The
default executor is explicitly unavailable. The optional OpenAI Responses API executor requires an
explicit model id and real-execution flag in `scripts/run-runtime-host.ts`; no model id is selected
by the browser. Follow-up answering, listening diagnosis, culture/reference claims, semantic
grading, learner persistence, mastery, SRS, and export remain unavailable.

The production event union also includes `learning.prep_started`, `learning.prep_completed`, and
`learning.prep_failed`. This is a second private post-caption Apply producer for optional learner
fine-tuning, not a child capability, caption authority, or course generator. Its closed request
contains only one exact verified caption job/artifact/content/receipt identity plus a typed
`studio.learning-fine-tune.v1` value: an ordered non-empty subset of the closed lens vocabulary
`word_order`, `grammar_salience`, `situating`, `culture_reference`, and `historical_reference`,
plus one closed temperature `low`, `medium`, or `high`. The host reopens the complete caption and
approval lineage, requires authority to remain unrevoked, snapshots every stored caption line, and
mints the private grant. Caller beats, candidates, prompts, prose, citations, model configuration,
paths, and open fields are rejected.

Completion stores private content-addressed `studio.learning-prep.artifact.v1` and
`studio.learning-prep.receipt.v1` objects with exact source, study, readiness, approval, caption,
line-snapshot, fine-tune, segmentation, candidate, executor, and rights lineage. Segmentation is
either an ordered contiguous complete beat partition of the caption lines with host-derived beat
identities and times or an explicit `watch_through` reason. Every candidate anchors one exact
caption line with stored media times and is `available`, `withheld`, or `unavailable` with a closed
reason; every armed lens without candidates records a closed lens abstention. Available notes are
`host_receipted`, `not_reviewed`, and `caption_context_inference`; external citation ids remain
empty because no external grounding contract exists, and caption context is never culture or
history authority. Temperature maps only to fixed surfaced-candidate ceilings and can never turn a
withheld or unavailable candidate into an available one. Output is private and export eligibility
is unavailable. Fixed bounds are 64 caption lines, 12 beats, 24 candidates, 2 KiB per candidate
text field, three attempts per exact request, 64 KiB generator output, 128 KiB provider envelopes,
256 KiB canonical artifacts, 4,000 completion tokens, and 60 seconds.

`GET /v1/runtimes/:runtimeId/learning-preps` returns `studio.local-runtime-learning-preps.v1`; the
same resource accepts the closed POST. The GET re-hashes both stored objects, reopens the exact
production caption recursively, re-derives line snapshots, segmentation, anchors, lens outcomes,
and ceilings, and rejects the whole response on tamper or mixed identity. Every immutable attempt
remains visible as `started`, `completed`, or `failed`; an identical retry receives the next
host-derived attempt number up to the fixed three-attempt ceiling, and explicit host recovery
closes a process-interrupted `started` attempt as failed without inventing output. The default
executor is explicitly unavailable. The optional OpenAI Responses API executor requires an explicit
model id and real-execution flag in `scripts/run-runtime-host.ts`; no model id is selected by the
browser, and deterministic executors remain injected only through in-process service options in
tests. The guarded real-OpenAI learning-prep proof requires `STUDIO_RUN_REAL_LEARNING_PREP=1`, an
explicit `STUDIO_LEARNING_PREP_MODEL`, and a real `OPENAI_API_KEY`; by default it retains its
runtime journal and content-addressed prep artifact and receipt under
`.studio/learning-prep-proofs`. A successful live call proves execution and stored lineage, not
semantic quality, culture or history truth, or ranking truth. The strict browser client re-hashes both stored objects and closes
attempt, grant, artifact, receipt, caption, fine-tune, lens, and result identities one-to-one, and
the production Customize learning face plus the watch-first Moments overlay project only
host-derived states over that verified read. Prep availability never claims verified culture truth,
alignment evidence, semantic quality, learner persistence, mastery, SRS, or export.

The “producer” column below names the component this fixture shape originally required. Some now
have equivalents in the separate production protocol described above, but none can make a
`fixtureOnly` event production evidence. The “projection / surface” column remains future UI work
unless stated otherwise.

## Fixture envelope

| Field | Why current data cannot express it | Required real producer | Future projection / surface |
|---|---|---|---|
| `RuntimeContractFixture.id` | Existing run ids cannot identify an isolated policy contract. | Development fixture registry only; no production producer | Build diagnostics only |
| `fixtureOnly` | Current bundles have no hard guard against contract examples becoming evidence. | Development fixture registry only | Ingestion guard only |
| `note` | A fixture needs an explicit non-evidence disclaimer. | Development fixture registry only | Build diagnostics only |
| `limits` | Current runs contain no scheduler policy envelope. | Run scheduler, missing | Run policy projection / limits inspector |
| `seedTasks` | Contract validation needs an exact pre-existing task registry. | Live task store, missing | Task registry / graph |
| `seedArtifacts` | Contract validation needs exact pre-existing provenance. | Artifact store, missing | Artifact registry / lineage view |
| `events` | Current traces cannot carry the proposed structured runtime lifecycle. | Live event log, missing | Future runtime reducer / event inspector |

## Budget and scheduler limits

| Field | Why current data cannot express it | Required real producer | Future projection / surface |
|---|---|---|---|
| `RuntimeBudget.wallMs` | `run.wall_s` records elapsed time after a replay; it is not a pre-run ceiling. | Scheduler budget allocator, missing | Task budget ledger / task inspector |
| `RuntimeBudget.toolCalls` | Traces record actions but no enforceable tool-call allowance. | Scheduler and tool host, missing | Task budget ledger / task inspector |
| `RuntimeBudget.tokens` | Bundles carry no model token allowance or usage reservation. | Scheduler and model gateway, missing | Task budget ledger / task inspector |
| `RuntimeLimits.maxDepth` | Manifest parentage has no recursive-spawn limit. | Run scheduler, missing | Scheduler decision projection / run limits inspector |
| `RuntimeLimits.maxActiveWorkers` | The recorded manifest is static and cannot enforce concurrency. | Run scheduler and registry, missing | Active registry / run limits inspector |
| `RuntimeLimits.runBudget` | A completed wall time cannot bound future delegated work. | Run scheduler, missing | Run budget ledger / run limits inspector |

## Task definition

| Field | Why current data cannot express it | Required real producer | Future projection / surface |
|---|---|---|---|
| `TaskDefinition.id` | Agent ids identify workers, not the units of work they own. | Scheduler task store, missing | Task registry / graph and worker panel |
| `runId` | A task needs an explicit run boundary independent of a loaded bundle. | Scheduler task store, missing | Task registry / task inspector |
| `dedupeKey` | Objectives in trace prose cannot be compared reliably for duplicate ownership. | Task planner, missing | Scheduler decision projection / rejection receipt |
| `objective` | Trace details describe actions after the fact, not a required question. | Parent task or orchestrator, missing | Task registry / worker purpose |
| `parentTaskId` | Manifest parentage links agents only. | Scheduler, missing | Task tree / graph parentage |
| `parentAgentId` | A dynamic child may not exist in the initial manifest. | Scheduler and live registry, missing | Task tree / graph parentage |
| `ownerAgentId` | Static manifest membership does not prove task ownership. | Live registry, missing | Task ownership projection / graph and panel |
| `depth` | Current parent links do not carry a scheduler-checked recursion depth. | Scheduler, missing | Scheduler policy / rejection receipt |
| `mediaScope` | `AgentSpec.window` has only a time pair and no artifact or track identity. | Parent task and media artifact store, missing | Scoped workspace / media tools |
| `inputArtifacts` | `run.artifacts` is a flat completed-run list without task inputs. | Task planner and artifact store, missing | Task inputs / worker panel |
| `requiredOutputs` | Traces do not define what a child must return before it runs. | Parent task or orchestrator, missing | Output checklist / task inspector |
| `requiredCapabilities` | Current roles are descriptive and do not authorize tools. | Task planner, missing | Requested privilege list / task inspector |
| `dependencies` | Trace order is evidence order, not a task dependency graph. | Scheduler task store, missing | Dependency state / task inspector |
| `budget` | Current run metrics are retrospective and run-wide. | Scheduler budget allocator, missing | Task budget ledger / task inspector |
| `status` | `AgentStatus` describes a worker, not task completion, failure, or withholding. | Scheduler task store, missing | Task lifecycle projection / graph and panel |

## Scope, outputs, and grants

| Field | Why current data cannot express it | Required real producer | Future projection / surface |
|---|---|---|---|
| `MediaScope.artifactId` | A time alone cannot distinguish raw media from a derived stem. | Artifact store, missing | Authorized media selector / workspace |
| `trackId` | Current clip metadata has no stable raw-track or stem identity. | Media probe and artifact store, missing | Track selector / workspace |
| `range` | `clip_t` is one observed point, not an enforceable interval. | Parent task and tool host, missing | Range overlay / workspace |
| `RequiredOutput.name` | Existing artifacts do not declare the child’s promised output slot. | Parent task, missing | Output checklist / task inspector |
| `artifactKind` | Filename strings do not provide a required artifact contract. | Parent task and artifact registry, missing | Output checklist and report validation |
| `required` | Current bundles cannot distinguish mandatory and optional child output. | Parent task, missing | Output checklist / task inspector |
| `CapabilityGrant.capability` | Roles do not enforce which tool operations are allowed. | Scheduler and capability host, missing | Granted privilege list / worker panel |
| `CapabilityGrant.mediaScope` | A displayed window does not constrain a tool invocation. | Scheduler and capability host, missing | Scoped privilege list / worker panel |

The fixture validator requires grants to match the requested capability set exactly and every
granted media range to be contained by the task scope. This is a contract check, not a tool-host
enforcement claim.

## Artifact lineage

| Field | Why current data cannot express it | Required real producer | Future projection / surface |
|---|---|---|---|
| `RuntimeArtifact.id` | `run.artifacts` contains paths, not stable runtime artifact identities. | Artifact store, missing | Artifact ledger / results and worker panel |
| `kind` | Current filenames do not enforce semantic output types. | Producing tool and artifact store, missing | Artifact ledger / output checklist |
| `mediaClass` | Raw and derived media are not distinguished structurally. | Media tool host, missing | Provenance view / workspace and results |
| `producerTaskId` | Current artifacts do not name the task that created them. | Artifact store, missing | Lineage graph / task inspector |
| `producerAgentId` | Current artifacts do not name their live producer. | Live registry and artifact store, missing | Lineage graph / worker panel |
| `sourceArtifactIds` | Derived media has no machine-checkable upstream lineage. | Media tool host and artifact store, missing | Lineage graph / results |
| `receiptId` | Current traces do not bind an artifact to a receipted tool operation. | Capability-enforcing tool host, missing | Operation receipt / workspace and results |
| `artifact_recorded.artifact` | Current trace targets cannot carry a validated artifact and its lineage as one event. | Artifact store, missing | Artifact ledger / lineage view |

## Event identity

Every proposed event carries:

| Field | Why current data cannot express it | Required real producer | Future projection / surface |
|---|---|---|---|
| `seq` | Recorded `t` values can be equal and are not a live monotonic event identity. | Live event log, missing | Ordered runtime reducer / raw event inspector |
| `fixtureOnly` | Current traces have no guard separating contract fixtures from evidence. | Fixture registry today; live event log must emit `false` through a different validated wire contract | Ingestion guard only; never displayed as evidence |
| `type` | Current action strings do not provide a closed discriminant for runtime policy events. | The event-specific producer, missing | Future runtime reducer dispatch / event inspector |

## Spawn and registration events

| Field | Why current data cannot express it | Required real producer | Future projection / surface |
|---|---|---|---|
| `spawn_requested.requestId` | A `spawn` trace has no decision-correlating identity. | Parent worker through scheduler API, missing | Scheduler decision projection / event inspector |
| `requestedByTaskId` | Current spawn prose cannot identify the requesting task. | Parent worker, missing | Task tree / graph |
| `requestedByAgentId` | Trace agent identity does not bind a request to task ownership. | Parent worker and registry, missing | Task tree / graph |
| `task` | Current spawn traces carry no bounded child contract. | Parent worker and task planner, missing | Pending task / scheduler inspector |
| `spawn_decided.requestId` | No structured decision can correlate to a request. | Scheduler, missing | Scheduler decision / event inspector |
| `schedulerId` | Current data cannot identify the authority enforcing limits. | Scheduler, missing | Decision receipt / event inspector |
| `accepted` | A spawn trace implies existence without an explicit approval outcome. | Scheduler, missing | Pending/accepted/rejected task state / graph |
| `rejection` | Current traces have no structured max-depth, budget, duplicate, output, or privilege rejection. | Scheduler, missing | Rejection receipt / graph and task inspector |
| `grants` | A role label cannot carry least-privilege grants. | Scheduler, missing | Granted privilege list / worker panel |
| `agent_registered.agentId` | Initial manifests cannot register a post-load child. | Live registry, missing | Dynamic agent registry / graph |
| `taskId` | Current agent lifecycle is not attached to task ownership. | Live registry, missing | Dynamic agent registry / graph and panel |
| `parentTaskId` | Manifest agent parentage omits the parent task. | Live registry, missing | Task tree / graph |
| `parentAgentId` | A dynamic parent cannot be resolved solely from the initial manifest. | Live registry, missing | Agent tree / graph |
| `grants` | Registration cannot prove what the scheduler actually granted. | Scheduler and registry, missing | Granted privilege list / worker panel |

## Task lifecycle and report-up

| Field | Why current data cannot express it | Required real producer | Future projection / surface |
|---|---|---|---|
| `task_transition.taskId` | Agent effects update workers only. | Task owner through scheduler API, missing | Task lifecycle / graph and panel |
| `agentId` | A task transition needs an ownership check. | Live registry, missing | Task lifecycle / event inspector |
| `status` | `AgentStatus` has no task failure or withholding terminal. | Scheduler task store, missing | Task lifecycle / graph and panel |
| `reason` | Trace detail is not a structured terminal reason. | Task owner or scheduler, missing | Task receipt / panel |
| `report_submitted.reportId` | Current `report` actions have no handoff identity. | Child task, missing | Report ledger / task inspector |
| `taskId` | Current report prose cannot identify its source task. | Child task, missing | Report ledger / task inspector |
| `agentId` | Current report prose cannot prove the task owner submitted it. | Live registry, missing | Report ledger / event inspector |
| `parentTaskId` | Current reports do not name the accepting task. | Child task, missing | Report-up edge / task graph |
| `parentAgentId` | Current reports do not name the accepting agent. | Child task, missing | Report-up edge / agent graph |
| `outputArtifactIds` | Current reports cannot prove required artifacts exist. | Child task and artifact store, missing | Output handoff / task inspector |
| `summary` | Trace detail is freeform action prose, not a structured handoff body. | Child task, missing | Report detail / task inspector |
| `report_decided.reportId` | Current merge traces do not correlate to a child report. | Parent task, missing | Report decision / task inspector |
| `decidedByTaskId` | A merge action cannot prove task authority. | Parent task and scheduler, missing | Report decision / event inspector |
| `decidedByAgentId` | A merge action cannot prove agent ownership. | Live registry, missing | Report decision / event inspector |
| `accepted` | Current reports have no explicit accepted/rejected outcome. | Parent task, missing | Handoff state / task inspector |
| `reason` | Acceptance or rejection needs a reviewable basis. | Parent task, missing | Handoff receipt / task inspector |

## Live control acknowledgement

| Field | Why current data cannot express it | Required real producer | Future projection / surface |
|---|---|---|---|
| `control_requested.requestId` | Client pause today has no live correlation id. | Live transport client, missing | Pending control state / dock |
| `action` | Current live transport message is not an event in evidence. | Live transport client, missing | Pending control state / dock |
| `requestedBy` | Current request does not record the control authority. | Live transport client, missing | Control receipt / event inspector |
| `control_acknowledged.requestId` | No runtime response can correlate to the client request. | Live orchestrator, missing | Acknowledged control state / dock |
| `runtimeId` | Current UI cannot identify which runtime accepted control. | Live orchestrator, missing | Control receipt / event inspector |
| `accepted` | The UI cannot honestly claim pause from a sent message alone. | Live orchestrator, missing | Paused or rejected state / dock |
| `reason` | A live rejection or delayed acceptance needs an explicit basis. | Live orchestrator, missing | Control receipt / dock and inspector |

## Memory proposal decisions

| Field | Why current data cannot express it | Required real producer | Future projection / surface |
|---|---|---|---|
| `memory_proposed.proposalId` | Current glossary/corrections appear as completed files without proposal identity. | Authorized task, missing | Memory proposal ledger / results |
| `taskId` | Current memory rows do not name the proposing task. | Authorized task, missing | Proposal provenance / results |
| `agentId` | Current memory rows do not name the live proposing agent. | Live registry, missing | Proposal provenance / results |
| `kind` | Existing files separate forms but not a shared promotion workflow. | Authorized task, missing | Proposal type / memory ledger |
| `evidenceArtifactIds` | Existing promotion fields do not bind every proposal to evidence artifacts. | Authorized task and artifact store, missing | Evidence links / memory ledger |
| `memory_decided.proposalId` | Current promotion has no structured review correlation. | Memory gate, missing | Memory decision / results |
| `decidedBy` | Current data cannot identify the promotion authority. | Memory gate, missing | Memory decision receipt / results |
| `accepted` | Existing rows cannot represent an explicit rejection. | Memory gate, missing | Accepted/rejected proposal state / results |
| `reason` | A memory decision needs an inspectable basis and rollback context. | Memory gate, missing | Decision receipt / memory ledger |

## Exact fixtures and enforced bounds

`bounded-child-report` exercises scheduler approval, exact capability grants, a scoped dynamic agent,
raw-to-derived lineage, a required report-up handoff, memory rejection, and live pause
acknowledgement. `duplicate-owner-rejection` proves a second active owner for the same `dedupeKey`
is rejected without registration or grants.

`validateRuntimeContractFixture` also enforces maximum depth, maximum active workers, aggregate run
budget, positive task budgets, required outputs, task ownership, contained media ranges,
least-privilege grants, legal task transitions, artifact receipts and lineage, parent-only report
decisions, correlated control acknowledgement, and memory proposal decisions.

These checks validate the proposed wire discipline only. They do not make the missing producers or
UI projections real.
