# Capability ladder: media understanding

Status: living **post–Build Week / post-UI-freeze** capability plan
Last updated: 2026-07-18

This document owns the next media-understanding plan. It does not replace the living Build Week
status in [`STATUS.md`](./STATUS.md), reopen owned-path v2, or define UI work. The completed v2 spine
is a dependency: bounded orchestration → current-run semantic evidence → coverage-aware report
admission → gap-directed study planning/synthesis/readiness → study-causal private captions and
structural QC.

The product is **language intelligence / media understanding**, not a caption product. See
[`PRODUCT.md`](../PRODUCT.md). Captions and timed KO/EN text are downstream artifacts that may be
appended from a study; they are not the product category.

The understanding goal is:

```text
owned video
  → bounded agent team studies the file across as many justified passes as budgets allow
  → evidence-complete study with explicit gaps and abstentions
  → beachhead meaning (Korean → English) scored from that understanding
  → optional private transcript / translation / caption artifacts derived from the study
```

This is preprocess-first, not live or low-latency. It is acceptable to spend more time on a hard
range when each additional pass has a reason, a different evidence request, a budget, and a receipt.
It is not acceptable to turn a weak first pass into fluent dialogue or translation.

## Executive decision

The primary climb is **understanding the owned media end to end**. The next product claim should not
be “more agents,” “faster captions,” or “we are a caption app.” It should be more of the source
duration truthfully accounted for by evidence that a bounded specialist actually inspected, with weak
regions restudied or abstained rather than guessed.

The first six implementation slices after the UI demo freeze now include: the fail-closed
**acoustic triage and non-dialogue coverage boundary**, bounded **frame sampling with real child
image delivery**, additive **multimodal admission with generalized abstention**, and one
**attenuated current-run speech re-study** vertical slice, a thin **on-screen OCR citation** slice,
and bounded **anonymous speaker/overlap coverage plus an exact overlap-to-U4 trigger**. Their receipts prove bounded execution, exact byte lineage, citation association, state
preservation, and pass accounting; they do not prove producer accuracy, visual/scene understanding,
improvement, or semantic quality.

U4's first vertical slice is implemented; padded/overlapping audio, denser frames, alternate
receipted configurations, and granted specialists remain closed until their producers land. U3
deliberately keeps U2 frame
identities cite-only, so no visual finding can affect a study until a later receipted producer exists.
U5 now has one OCR-only vertical slice; scene/shot boundaries, visual-context specialist routing,
and denser-frame U4 wiring remain the next parts of that rung. U6 now has one anonymous
speaker/overlap producer, U3 coverage-qualification slice, and closed `speaker_overlap` U4 cause: one
audited overlap cell may trigger an exact attenuated-speech pass without being mislabeled as recognizer
disagreement. Web research follows admitted frame/audio evidence
when names, history, or cultural context are outside the file. General computer-use is allowed later
as a separately granted, isolated, receipted capability for dynamic external context; it is not a
substitute for decoding and citing the owned video.

The strategy is:

1. **Account for the media before translating it.** Preserve speech, music, noise, mixed, unknown,
   withheld, unavailable, and failed ranges rather than forcing every timestamp into dialogue.
2. **Give specialists real media tools.** Actual audio ranges, frames, OCR observations, speaker/
   overlap evidence, and derived stems must sit behind scheduler grants and host receipts.
3. **Restudy exact gaps.** Hard or rapid ranges can request smaller subranges, denser samples,
   alternative producer configurations, or follow-up specialists within explicit pass and run
   budgets. Repeating the same call is not a new pass.
4. **Abstain after the budget is spent.** A terminal unknown/withheld/unavailable result is better
   than an unsupported transcript or translation.
5. **Use the world only after the file.** Receipted web research, then optional bounded computer-use,
   may add context to an exact unresolved media hypothesis; neither may overwrite media evidence.
6. **Keep quality authorities separate.** Structural/lineage QC exists. Semantic transcription and
   translation quality still require frozen human evidence and independent evaluation. A model judge
   is not truth.
7. **Park the Learning OS.** Anki, Quizlet, Feather, canonical learning packs, and in-app tutors stay
   in the later appendix until the media-understanding stack is substantially stronger.

## Backlog boundary

### Sequenced next — active understanding backlog

These are planned, dependency-ordered rungs, not indefinite deferrals. Their order matches the thin
checklist below:

1. **U1 — acoustic triage and non-dialogue coverage (implemented 2026-07-17):** prevent noise/
   non-speech from becoming fake dialogue while preserving music/lyrics policy and weak-evidence
   abstention. Accuracy evaluation remains separate.
2. **U2 — bounded frame sampling and inspection (implemented 2026-07-17):** give a granted
   specialist actual frame pixels with source/range/decoder receipts. Sampling and byte delivery are
   implemented; visual interpretation remains a later producer rung.
3. **U3 — multimodal admission and generalized abstention (implemented 2026-07-17):** carry speech,
   acoustic coverage, frame sample identities, and later typed evidence slots through exact citations
   without upgrading weak/conflicting states. Frames remain cite-only.
4. **U4 — budgeted multi-pass re-study (attenuated-speech + U6.1 trigger slices implemented 2026-07-17):**
   the default root can request one strict current-run speech subrange for an exact weak range/cause,
   or copy one exact host-derived `speaker_overlap` cell inside prior broader speech work; other typed
   delta producers fail closed.
5. **U5 — OCR and scene context (OCR citation slice implemented 2026-07-17):** derive and cite
   provisional on-screen text from U2 frames; scene boundaries and specialist routing remain.
6. **U6 — speaker/overlap evidence (coverage + typed U4 trigger slices implemented 2026-07-17):**
   preserve anonymous turn/overlap hypotheses in U3 coverage/conflicts and let one exact audited
   overlap cell request bounded attenuated speech without granting transcript truth.
7. **U7 — conditional separation and comparison (U6.1 slice + U7.1 U1-`mixed` trigger implemented
   2026-07-17):** preserve raw media, receipt private derived stems, and compare raw/stem hypotheses
   only for one exact audited overlap range or one cold-audited acoustic `mixed` cell. Semantic
   preference and Bet G ablation remain closed.
8. **R1 — bounded web research (first wired slice implemented 2026-07-17):** add safe search plus
   document snapshot/span citations for exact unresolved context gaps. The trigger-gated
   grant/host/citation path is wired offline with a fixture provider and an empty default domain
   allowlist. The default v3 root now projects exact pre-synthesis conflict candidates, but an
   exact model echo is optional and non-conflicting runs grant nothing. The production v2 report
   path admits only bounded spans from cold-audited snapshots as cite-only context.
9. **R2 - optional bounded computer-use (offline runtime slice implemented 2026-07-18):** after
   media senses and exact R1 exhaustion, admit one explicitly composed offline fixture session with
   action/screenshot receipts and cite-only screen regions. A real isolated driver remains.
10. **G1 — semantic evaluation expansion:** score registered capability ablations, repeated captures,
    variance, and later packs while keeping structural QC separate from human semantic authority.

This is a multi-slice backlog, not a one-day or one-release implementation claim. Each rung retains
its own done-when and stop conditions; a dependent slice starts only when its required producer,
artifact, grant, and audit boundaries are real.

### Parked / out of this climb

- **Learning OS:** canonical learning packs, Anki/Quizlet/Feather exports, in-app tutors, learner
  state, mastery, and SRS behavior remain in the later appendix.
- **Live/low-latency work:** live captions, latency optimization, and always-on media/screen capture
  are not goals of this preprocess-first climb.
- **Unrestricted computer-use or external mutations:** ambient desktop/browser access, credentials,
  signed-in sessions, messages, purchases, uploads, publication, and account changes are outside R2.
- **Unbounded/distributed autonomy:** unlimited recursion, transparent model-turn continuation,
  distributed scheduling, elastic workers, and unconstrained remote execution remain outside this
  climb.
- **UI and product infrastructure:** UI redesign/projection work is owned elsewhere; hosted/link
  ingest, accounts, retention/access policy, public upload/CDN/publication, and production topology
  are not media-understanding rungs.

## Evidence pass: what exists now

| Area | Real now | Not available today | Evidence |
|---|---|---|---|
| Owned ingest and preflight | Content-addressed owned bytes, rights receipt, `ffprobe`, pinned VAD speech windows, pinned speech-window language ranges, and additive preflight V4 with separately sealed acoustic observations/receipt | Acoustic/diarization accuracy evaluation, scene, and visual context | [`ARCHITECTURE.md` — source ingest boundary](../ARCHITECTURE.md#source-ingest-boundary) and [`STATUS.md` — backlog boundary](./STATUS.md#post-freeze-backlog-boundary) |
| Orchestration | A model-executed default root can request bounded children and one host-normalized attenuated-speech re-study for an exact weak range/cause, including an exact receipt-backed U6 `speaker_overlap` cell. The scheduler derives identities, attenuates context, enforces scope/budgets/pass caps, and dedupes completed work/configuration | Padded audio, denser frames, alternate recognizer/segmentation configurations, specialist re-study, and unlimited/distributed execution | [`rangePassHost.ts`](../../src/studio/runtime/production/study/rangePassHost.ts), [`scheduler.ts`](../../src/studio/runtime/production/scheduler.ts), and [`orchestratorContract.ts`](../../src/studio/runtime/production/executor/orchestratorContract.ts) |
| Granted media/evidence tools | `media.extract`, bounded `media.seek` audio activity, `media.frames.sample`, `media.frames.ocr`, one path-free `media.speakers.analyze` call over an injected audio range, one exact-conflict-gated `research.investigate` grant with path-free search/snapshot tools and cite-only snapshot-span report inputs, one explicitly composed `computer.use.readonly` offline-fixture grant with cite-only screen-region report inputs, `speech.transcribe`, exact reads of pinned VAD/language/U1 evidence, evidence assessment/decision, typed report-up, parent admission/read, study planning, and study synthesis | Scene/shot interpretation, default visual-specialist routing, named/cross-run speakers, stems, unrestricted or automatic live web research, real-provider/freshness authority, and live computer-use | The exact capability union is in [`model/tasks.ts`](../../src/studio/runtime/production/model/tasks.ts); U6 lives in [`model/speakers.ts`](../../src/studio/runtime/production/model/speakers.ts) and [`speakerHost.ts`](../../src/studio/runtime/production/speakerHost.ts) |
| Current-run speech evidence | A scoped host and bridge exist. With an explicitly enabled recognizer they can produce current-run timed hypotheses; the default unconfigured recognizer honestly returns unavailable | Semantic accuracy/calibration, a guarantee that every run has a live recognizer, alternative segmentation/recognizer passes, and semantic translation QC | [`currentRunSpeechRecognizer.ts`](../../src/studio/runtime/production/semantic/currentRunSpeechRecognizer.ts) and [`run-runtime-host.ts`](../../scripts/run-runtime-host.ts) |
| Coverage and abstention | Additive report/study contracts preserve supported, unknown, withheld, unavailable, truncated, conflicting, failed, and not-in-scope states. U4 study v3 retains ordered pass history/disagreement; only pass-new exact speech citations support the executed subrange, and exhaustion stays weak without globally blocking unrelated ranges | Semantic correctness/truth arbitration and additional re-study producers | [`rangePassHost.ts`](../../src/studio/runtime/production/study/rangePassHost.ts), [`restudiedStudySynthesisHost.ts`](../../src/studio/runtime/production/study/restudiedStudySynthesisHost.ts), and [`restudiedStudyReadinessHost.ts`](../../src/studio/runtime/production/study/restudiedStudyReadinessHost.ts) |
| Tool boundary | The launcher exposes only required task-private MCP tools, including U2 PNG image blocks, U5 OCR over completed frame identities, U6 anonymous speaker/overlap analysis whose request is exactly `{}`, R1 `research_search`/`research_document_snapshot`, and the R2 empty-object `computer_use_readonly` tool. R1 and R2 mount only under their exact trigger-gated grants. Only cold-audited snapshot spans and offline screen-region identities can enter a v2 report, both as cite-only context. Ambient web, shell, apps, memories, remote plugins, and built-in multi-agent tools are disabled | Scene/shot interpretation, default visual-specialist routing, unrestricted or automatic research, real-provider/freshness authority, and any live isolated computer-use driver | [`codexInvocation.ts`](../../src/studio/runtime/production/executor/codexInvocation.ts), [`computerUseMcpServer.ts`](../../src/studio/runtime/production/executor/computerUseMcpServer.ts), and [`RUNTIME_CONTRACTS.md`](../RUNTIME_CONTRACTS.md#durable-agent-directed-orchestration-kernel) |
| Owned study spine | New owned runs default to evidence-citation v1, report/admission/read v2, the eight-tool U4 root, owned-media-study v3, readiness v4, and approval-gated caption/caption-causality v4. The dormant research tool requires a projected current conflict. Closed v1 planning remains an explicit non-default compatibility selector | Studio UI projection, semantic correctness/truth arbitration, and later evidence producers | [`runtimeApplication.ts`](../../src/studio/runtime/production/runtimeHost/runtimeApplication.ts), [`orchestratorBridge.ts`](../../src/studio/runtime/production/executor/orchestratorBridge.ts), and [`restudiedStudyRuntime.ts`](../../src/studio/runtime/production/study/restudiedStudyRuntime.ts) |
| Structural versus semantic quality | Caption QC recursively checks current-run lineage, study/readiness causality, availability, and structural completeness. Separately, `hard-ko-v1` is frozen and the human-labeled `run-007` Bet G score exists with `judge: null` | Runtime semantic QC, calibrated transcription/translation confidence, additional scored runs and registered ablations, variance/generalization evidence, and an independent semantic review path | [`hard-ko-v1/pack.json`](../../bench/packs/hard-ko-v1/pack.json), [`run-007/score.json`](../../bench/scores/run-007/score.json), and [`STATUS.md`](./STATUS.md#honesty-non-claims) |
| Learning/export | A private owned-media study artifact exists; recorded paths contain partial glossary/correction material | A canonical learner-item artifact, Anki/Quizlet/Feather export, learning sessions, and in-app learning agents | [`STUDIO_PRODUCT_CONTRACT.md` — Results](../STUDIO_PRODUCT_CONTRACT.md#7-results-captions-study-and-evidence--studio); parked in the appendix below |

The Bet G score is the content-addressed receipt under `bench/scores/`, not the legacy
`public/demo/runs/run-007/score.json` run-local placeholder, which remains explicitly unscored. The
bench receipt records 5 correct, 2 wrong, and 6 withheld critical units for the prepped subject out
of 13, with a critical-meaning delta of -0.3846 versus the cold control and no model judge. It is a
real, useful baseline—and evidence that the current prep path is not yet a general “better” claim.

Two distinctions govern every rung:

- A producer receipt proves which bounded operation ran over which bytes. It does not prove the
  producer was right.
- An orchestrator spawn proves a scheduler accepted a model-authored task. It does not give that task
  hearing, vision, web, shell, or computer-use unless the matching host tool was granted and used.

## Contract for every new rung

Every producer, research tool, or later computer-use tool should satisfy the same minimum contract:

- **Request:** path-free; exact task, agent, source/artifact, track/range or external-context scope is
  host-injected; caller input is closed and bounded.
- **Grant:** independently scheduler-issued, least privilege, non-inherited, and charged to explicit
  call/wall/item/byte/action budgets.
- **Execution:** the host owns decoder/model/provider arguments, isolation, safe egress, timeouts,
  normalization, and byte limits.
- **Artifact:** private, content-addressed, immutable, source-linked, and honest about empty,
  non-dialogue, unavailable, unknown, withheld, truncated, conflicting, or failed states.
- **Receipt and audit:** producer/runtime/configuration identities plus request, output, limits, and
  content identities can be recursively reopened; drift or partial lineage fails closed.
- **Consumption:** a worker receives the actual authorized result and cites exact observation
  identities in a versioned typed report. A filename, URL, hash in prose, or spawn label is not a
  citation.
- **Restudy:** a later pass names the exact prior gap/conflict, narrows or preserves its scope, states
  what evidence/configuration changes, and consumes remaining budget. Identical duplicate work is
  rejected.
- **Routing:** the model root may request a specialist because of an exact gap, conflict, or measured
  trigger. The scheduler may reject it; no fixed worker count is a product requirement.
- **Stopping:** success requires cited support. Budget exhaustion, persistent disagreement, or weak
  evidence terminates in an abstention state without fabricated dialogue or translation.
- **Evaluation:** producer integrity tests ship with the slice. Accuracy or product-quality claims
  wait for the appropriate independent evaluation lane.

Additive versions are preferred. Existing v1 evidence, study, readiness, caption, and QC artifacts
remain valid and closed; expanding evidence types or follow-up reasons is not permission to weaken
their audits.

## Media-understanding rungs

### U1. Acoustic triage and the non-dialogue truth boundary — implemented

- **Real:** The local bounded producer uses a pinned YAMNet-compatible ONNX export through the
  existing pinned CPU ONNX runtime, re-verifies source/VAD/normalized-PCM/model/runtime bytes, and
  emits a complete 960 ms-cell partition over the exact authorized range. The observation body and
  execution receipt are separate private content-addressed inputs in additive preflight V4. Exact
  grants expose the observation cells through evidence-read V3. Readiness V2 deterministically
  reconciles VAD, acoustic class/uncertainty, and `includeLyrics`, preserves full-duration and
  semantic-denominator accounting separately, and caption storage plus cold reopening strips text
  from every excluded overlap.
- **Still missing:** Fit-for-purpose labeled-window accuracy/calibration results, lyric
  understanding, and the U4 bounded re-study path for weak/conflicting cells. YAMNet scores are
  uncalibrated classifier output, not semantic understanding or proof that speech is absent.
- **Done when:** A bounded producer partitions the granted range into a closed acoustic vocabulary
  such as speech-candidate, music, noise, mixed, and unknown, with exact normalization/model/runtime,
  scores or explicit uncertainty, complete time accounting, and immutable receipts. An additive
  coverage state such as `not_in_requested_dialogue_scope` may be emitted only when the acoustic and
  speech-activity policy agree and the job policy excludes that content; it cannot carry dialogue or
  translation text. It remains visible in full-duration accounting and is reported separately from
  the semantic-coverage denominator, so the system cannot raise coverage by silently shrinking the
  job. Music remains eligible for lyric study when `includeLyrics` is true. Weak, conflicting,
  truncated, or unavailable evidence becomes unknown/withheld/unavailable and may trigger U4
  re-study. Caption production preserves those states rather than manufacturing lines.
- **Non-goals:** Lyric transcription, speaker identity, source separation, semantic quality, or one
  clip-level “has music” label. (U1 itself performs no separation; U7.1 lets a cold-audited `mixed`
  cell trigger the separate U7 grant/producer/comparison path, and U1 still makes no separation,
  quality, or preference claim.)
- **Fake-claim risk:** A VAD or acoustic class is a fallible hypothesis. “Non-speech” does not prove
  silence, and “music” does not prove there are no lyrics. The safe outcome of disagreement is
  abstention or re-study, not fake dialogue.
- **Existing-spine dependency:** Preflight extension pattern, evidence registration/read, coverage
  partitions, job `includeLyrics`/speech-scope policy, and gap-directed planning. This adds evidence
  and a state; it does not reopen v2 orchestration.

### U2. Bounded frames that an agent can actually inspect — implemented

- **Real:** `media.frames.sample` grants carry exactly one bounded owned-source/video-track scope and
  a fixed v1 limit envelope. The host seals and re-hashes a private source snapshot, owns
  ffprobe/ffmpeg selection from private executable snapshots and conditional-display-matrix/
  square-SAR/RGB24 PNG decoding, records requested and actual PTS, dimensions, transformations,
  executable binary/version/platform lineage, and atomically records private per-frame artifacts,
  a canonical manifest, and a canonical receipt. The task-private loopback bridge accepts only
  strictly increasing integer timestamps; its MCP tool returns verified PNG image blocks, not paths,
  filenames, or identities alone. Cold audit reopens the source, receipt, manifest, every PNG, and
  current decoder binaries. Tests cover duration, count, input/output dimensions, per-frame and
  aggregate bytes, wall timeout, absent/non-video tracks, out-of-range requests, duplicate actual
  PTS, pixel-identical frames at distinct PTS, ungranted calls, source/metadata/frame tamper,
  temporary-allocation failure, and decoder drift.
- **Still missing:** A child may receive authorized pixels and U3 may cite the cold-audited sample
  identity as media context, but no U2 receipt asserts what the pixels mean. There is no visual
  observation producer, so visual prose cannot affect study, readiness, captions, or QC.
- **Done when:** A scheduler-granted frame operation accepts only a source/video-track scope and a
  bounded sampling request; the host re-hashes the source, controls decoding, and enforces maximum
  duration, frame count, dimensions, bytes, and wall time. It stores requested/actual presentation
  timestamps, transformations, a frame manifest, and individual frame identities. A task-private
  tool delivers authorized image content to the child. Cold replay and tamper tests reopen every
  frame plus source/decoder lineage. Absent tracks, out-of-range, duplicate, oversized, and ungranted
  calls fail closed.
- **Non-goals:** OCR, face/person identification, scene understanding, UI playback/control,
  always-on screen capture, or a claim that sampling selected the right frame.
- **Fake-claim risk:** Returning hashes or filenames while the model never receives pixels is
  spawn-without-tools theater. A frame receipt proves sampling, not seeing or understanding.
- **Existing-spine dependency:** Scheduler grants, task media scope, artifact store, launcher bridge,
  journal/projection, and tool budgets. A later visual producer must use U3's typed admission seam
  before a visual finding can affect a study.

### U3. Multimodal admission and generalized abstention — implemented and default-runtime wired

- **Real:** `studio.evidence-citation.v1` binds evidence kind, use, exact claim/coverage/context
  target, artifact/content/receipt identities, observation ids, upstream/observation states, and
  temporal point/range or future document-span locators. Separate cold adapters reopen current-run
  speech, U1 acoustic observations/receipt, and U2 frame receipt/manifest/PNG/decoder lineage.
  Current-run speech is the only landed claim-support kind and must exactly tile its claimed range;
  acoustic facts qualify coverage only, while frames and landed U5 OCR hypotheses remain cite-only
  media context. Landed U6 `speaker_turn` citations qualify exact temporal coverage only and
  reconstruct all intersecting accounting cells; external-document spans now have an R1 producer
  adapter and admit cite-only media context from receipted research snapshots. Additive
  `studio.study-report.v2`, parent admission/read v2,
  `studio.owned-media-study.v2`, and readiness v3 store and cold-replay exact lineage;
  caption-causality v3 derives only from that reopened chain. Every weak/conflict/out-of-scope state
  is preserved. Readiness checks stored integrity, range coverage, and unresolved conflict only; it
  has no semantic-quality input or score. The owned-run contract selector now defaults to this v2
  report → admission/read → synthesis → readiness path, and approval-gated caption production stores
  the resulting line causality as v3. Worker, launcher, production-event projection, and artifact
  unions carry those identities end to end. Closed v1 fixtures opt into `studyContractVersion: "v1"`;
  historical v1 receipts are neither rewritten nor silently upgraded.
- **Still missing:** No scene/shot producer exists; the R1 research producer is trigger-gated and
  never runs on the default spine. Frame receipts make no semantic claim, and no truth or
  reliability arbitration is attempted. OCR is cite-only and grants no dialogue authority.
  Audio-only runs normally have no frame/OCR citation. Studio UI projection is still outside this
  runtime slice.
- **Implemented proof:** The additive evidence-citation envelope and report/study versions identify evidence
  kind, artifact/receipt/content identities, observation ids, temporal ranges when applicable, and
  document spans for external sources. Each kind has its own audit adapter. Supported media claims
  require observations that close the claimed range; non-temporal context must name the media entity/
  range it qualifies. Unknown, withheld, unavailable, truncated, conflicting, failed, and
  not-in-scope states survive admission, synthesis, readiness, and caption causality without being
  upgraded by prose or another modality. Readiness continues to check integrity/coverage policy only;
  it does not become semantic QC.
- **Non-goals:** Treating evidence kinds as equally reliable, automatic truth arbitration, mutating
  v1 receipts, or letting visual/web context overwrite what was spoken.
- **Fake-claim risk:** A generic `sourceIds[]` list can look multimodal while proving nothing about
  which observation supports which claim. “Several agents agree” is not independent evidence when
  they consumed the same hypothesis.
- **Existing-spine dependency:** The completed report → admission/read → synthesis → readiness →
  approval-gated caption lineage. U4 reuses report/admission v2 additively; it does not revive or
  mutate the non-default v1 planning/follow-up events.

### U4. Budgeted multi-pass re-study — attenuated speech + U6.1 trigger slices implemented

- **Real:** `study_restudy_request` is an additive sixth tool on the default generalized root. Its
  host-derived input contains exact weak coverage, prior report/admission/citation/speech identities,
  raw states, and an evidence-tied cause. The closed `speaker_overlap` cause is derived only from one
  cold-audited conflicting U6 overlap accounting cell inside the weak coverage; its exact temporal
  locator is the execution range, and the caller may only copy it. Other causes accept only a strict
  attenuated subrange. Both paths require prior broader current-run speech work; the host fixes pass 2, configuration
  scope, a 20 s/one-call reservation, and the v2 child contract. The scheduler caps accepted passes
  at one per range and four per producer, rejects a concurrent identical fingerprint, prevents scope
  changes, and attenuates task context. Request/terminal receipts and the projection retain prior
  evidence, cause, delta, pass number, reserved/measured spend, terminal outcome, and disagreement.
  `studio.owned-media-study.v3` retains every admitted report and accepted terminal pass in order.
  Only pass-new range-closing current-run speech citations may support the executed cell; residual or
  exhausted cells remain weak while unrelated supported coverage continues. Readiness v4 and
  caption/caption-causality v4 retain pass/terminal-weak identities. The default path exercises this;
  `studyContractVersion: "v1"` remains non-default.
- **Still missing:** Padded/overlapping audio, denser frame timestamps, alternate receipted
  segmentation/recognizer configurations, and acoustic/visual/context specialists have typed
  request members but no registered U4 producer/grant, so they fail closed. Pass 3+, semantic
  correctness arbitration, visual findings, and UI projection are not implemented.
- **Implemented proof:** Default-path tests cover exact cause/range selection, audited overlap-to-
  `speaker_overlap` classification, exact overlap-range echo, fake-recognizer-cause rejection, unregistered-delta and
  unchanged-range rejection, concurrent fingerprint dedupe, fixed reservation plus measured spend,
  citation-only subrange support with weak residuals, terminal exhaustion that does not block an
  unrelated supported range, ordered pass/report replay, and disagreement retained without support.
  “Hard/rapid” is represented only by evidence states such as truncation, disagreement, or an exact
  failed/weak range; worker labels create no authority.
- **Non-goals:** Unlimited retries, transparent model-turn continuation, best-of-K cherry-picking,
  repeatedly asking the same model, or blocking the whole run because one range remains unknown.
- **Fake-claim risk:** More passes, more tokens, or more agents do not equal better understanding.
  Without an exact evidence/configuration delta, multi-pass is repeated guessing.
- **Existing-spine dependency:** U3 report/admission/citation rules, scheduler limits, task-context
  attenuation, observability, and abstention. It extends the closed spine with new evidence requests
  and pass events rather than reusing v1 planning or replacing history.

### U5. OCR and scene/on-screen context — OCR citation slice implemented

- **Real:** `media.frames.ocr` is a scheduler grant and task-private bridge over one completed,
  same-task U2 frame-sampling operation; the child supplies only that operation identity. The host
  cold-audits source/manifest/receipt/PNG/decoder lineage before running pinned local
  Tesseract.js/core 7.0.0 with vendored `tessdata_fast` 4.1.0 Korean+English integer-LSTM models at
  commit `65727574dfcd264acbb0c3e07860e4e9e9b22185` under Apache-2.0. Network fetch and trained-data
  cache are disabled. A replaceable recognizer seam returns normalized-NFC text hypotheses, frame
  identities/timestamps, boxes, confidence/state, exact runtime/model/configuration file hashes,
  and separate private content-addressed observation/receipt artifacts. U3 cold-audits `ocr_span`
  citations as `cite_only` media points; report v2 can carry them in source lineage, but coverage and
  claim citation ids do not consume them. Caption causality remains current-run-speech-only.
- **Limits and abstention:** One call; at most 4 frames, 64 boxes/frame, 128 boxes total, 2 MiB/frame,
  8 MiB total input, 256 code points/box, 4,096 code points total, 256 KiB per observation/receipt,
  and 45 s wall. Confidence below 70 is withheld with null text; overlapping different hypotheses
  are conflicting and withheld; any count/text overflow truncates the affected frame with no partial
  text. Missing/ungranted/off-range/U2-lineage/model/runtime failures close without a usable receipt.
- **Still missing:** Shot/scene boundaries, script/language inference, subtitle-perfect aggregation,
  a default root/visual-context specialist policy, U4 `denser_frame_timestamps` or specialist-delta
  wiring, and scene prose claims. OCR is requested only by an explicitly granted child for an exact
  on-screen-text gap; it is not ambient or always-on.
- **Slice done-when:** The landed OCR producer, artifact receipt, cold replay/tamper checks, child
  bridge, U3 cite-only report/admission adapter, hard limits, and fail-closed weak/conflict/truncation
  behavior are implemented and tested. The full U5 rung remains open for scene/specialist work.
- **Non-goals:** Perfect subtitle extraction, face recognition, biometric/person identity,
  copyrighted frame publication, or silently replacing speech evidence with OCR.
- **Fake-claim risk:** OCR text is a hypothesis, not the identity, spelling, translation, or cultural
  meaning of the thing shown.
- **Existing-spine dependency:** U2 frames, U3 citations, U4 re-study, specialist routing, and study
  conflict/limitation handling.

### U6. Speakers, overlap, and anonymous turns — coverage + typed U4 trigger slices implemented

- **Real:** `media.speakers.analyze` is one exact audio-scope scheduler grant with one task-private
  child tool whose request is `{}`. The host seals mono-16 kHz PCM and uses a replaceable diarizer
  seam backed on this runtime by pinned local `sherpa-onnx-node` 1.13.4 native darwin-arm64 CPU,
  pyannote segmentation 3.0, and 3D-Speaker ERes2Net. Runtime, native library, model, configuration,
  source, normalized-audio, authorization, execution, and output identities are retained in separate
  private content-addressed observations and receipt artifacts. Host-assigned `anon_cluster_N`
  labels are run/artifact/operation-local. A gap-free partition preserves available anonymous turns,
  conflicting overlap, unknown rapid/no-hypothesis ranges, and whole-result truncation. Cold audit
  reopens source/artifacts, re-derives identities, and re-hashes current lineage without rerunning
  inference. U3 admits `speaker_turn` only as exact temporal `coverage_qualification`; it reconstructs
  every cell in the target range, so overlap/uncertainty cannot be cherry-picked away. Claim support
  and KO/EN caption authority remain exclusively current-run speech. U6.1 adds the closed
  `speaker_overlap` cause: one exact conflicting overlap cell, its citation/observation identities,
  and its baseline weak coverage are host-derived from cold-audited U3 evidence. If prior speech is
  strictly broader, that exact cell may request the existing attenuated-speech pass once. It is never
  relabeled `recognizer_disagreement`, and a completed pass does not itself resolve overlap.
- **Still missing:** Named/cross-run identity, a fit-for-purpose diarization quality/accuracy bench,
  alternate models, non-darwin native platform pins, ambient always-diarize policy, and U7 separation
  remain open.
- **Slice done-when:** The pinned producer, real owned-audio smoke, closed request/grant, immutable
  artifacts/receipts, complete accounting, local-label policy, cold replay/tamper checks, U3
  coverage/conflict adapter, typed U4 overlap trigger, exact-range/fake-cause rejection, and missing-
  grant/model/source/oversize failure boundaries are implemented and tested. The full U6 rung remains
  open for the quality/platform work above; U7 is a separate next rung.
- **Non-goals:** Naming people, cross-video biometric identity, perfect diarization, or treating a
  speaker-count estimate as transcript correctness.
- **Fake-claim risk:** Stable-looking labels such as `speaker_1` are clustering hypotheses, not
  identities; splitting turns does not mean the words were recognized correctly.
- **Existing-spine dependency:** U1 acoustic scope, U3 evidence/abstention, U4 pass requests, and the
  existing semantic evidence/report path.

### U7. Conditional separation and raw-versus-stem comparison — U6.1 and U7.1 U1-`mixed` triggers implemented

- **Real:** `study_separation_request` exposes only exact host-derived U6.1 conflicting overlap
  cells and U7.1 U1 acoustic `mixed` cells. The caller can copy only `inputId` and `triggerId`;
  ordinary spawn cannot acquire `media.audio.separate`. The scheduler fixes one exact
  source/content/audio-track/range grant, one-call limits, and the pinned producer policy. The
  replaceable `SourceSeparator` seam uses local offline SpeechBrain SepFormer WSJ02Mix on the
  qualified macOS-arm64 runtime. The host keeps the raw artifact unchanged and stores two anonymous
  private `studio.separated-audio-stem.v1` derived artifacts plus canonical separation and comparison
  receipts. Direct origin fields and receipts close method/model/configuration/raw source/range and
  trigger-kind lineage. The same current-run recognizer contract runs over raw and both stems;
  deterministic NFC/whitespace-normalized text yields only agreement, disagreement, or abstention.
  Cold audit reopens raw, stems, receipts, comparison, the audited trigger evidence, and current
  producer lineage without accepting caller paths or rerunning separation. The result has null
  semantic preference and no caption or semantic authority.
- **U7.1 U1 trigger:** A second eligible cause admits one cold-audited acoustic cell classified
  `mixed` — which by the U1 validator necessarily means strong certainty with both speech and music
  above the support threshold, i.e. two provably co-present source families in one exact range. The
  host reopens and content-verifies the preflight acoustic observations and producer receipt, copies
  the exact source/track/half-open cell range, and mints the same grant. No other acoustic class
  (music, noise, speech-candidate, unknown) and no VAD/policy state qualifies; identical U1 and U6
  ranges dedupe to one work item; and the receipt keeps null semantic preference and `not_granted`
  caption/semantic authority.
- **Still missing:** The only U1 separation-eligibility class is `mixed`; every other acoustic class
  and all VAD/policy states stay non-triggering. Non-darwin runtime pins, alternate models, a
  separation-quality bench, independent evidence or human semantic preference, UI projection, public
  delivery, and the registered Bet G raw-versus-stem ablation remain open. The default recognizer may
  honestly abstain when no live current-run recognizer is configured.
- **Slice done-when:** The landed U6.1 and U7.1 paths prove exact trigger/grant/range closure, raw
  preservation, private content-addressed stems, pinned replaceable execution, same-recognizer
  comparison, immutable receipts, cold audit/tamper rejection, hard limits, duplicate rejection, typed
  unavailable failure, and no caption-authority upgrade. The typed U1 `mixed` trigger policy has
  landed additively; the full U7 rung remains open for the quality/human-review and platform work
  above.
- **Non-goals:** Default separation of every clip, publishing stems, “cleaner sounds better” as a
  metric, or treating same-recognizer agreement on related audio as independent truth.
- **Fake-claim risk:** Separation can create artifacts. A clean-sounding stem may delete speech or
  invent recognizer confidence without improving meaning. `mixed` proves two co-present acoustic
  families, not two intelligible or separable streams, and the pinned two-speaker wsj0-2mix model is
  out of its training domain on speech-plus-music, so the U1 trigger may claim only comparability.
- **Existing-spine dependency:** This rung uses U6.1 audited overlap evidence, U1 cold-audited
  acoustic evidence, U4 pass/study context, derived artifact origins, and raw-source preservation.
  Bet G ablation is a later consumer, not evidence claimed by this slice.

## External context rungs

### R1. Bounded, receipted web research (first wired slice implemented 2026-07-17)

- **Real:** `research.investigate` is a scheduler-issued capability grant with a `researchScope`
  gap binding. `ResearchRequestHost` derives one content-addressed trigger per unresolved conflict
  of a reopened owned-media study, and `scheduler.requestResearch` admits the host-fixed child only
  through the recorded `study_research_request` root tool call under a root `study.research` grant,
  re-deriving the trigger list from live projection state and minting limits plus the domain
  allowlist from host policy alone. The launcher mounts `research_search` and
  `research_document_snapshot` per grant over the authenticated loopback bridge, journals
  `research.operation_*` events into a `researchOperations` projection with executor lineage on
  every receipt, records search/snapshot/extraction artifacts under registered research origins,
  and cold-audits completed operations. When both registered queries complete with zero results,
  `ResearchExhaustionHost` records a content-addressed
  `studio.research-exhaustion.receipt.v1` cause in `researchExhaustions`; the cause is exact-gap and
  executor bound, cold-auditable, and grants R2 cause identity only, never semantic authority.
  `external_document_span` citations from receipted snapshots
  admit as cite-only media context; snippets stay routing hints. Ambient codex web search stays
  disabled and the default provider is the offline fixture with an empty domain allowlist, so no
  egress happens without explicit composition policy. The default v3 root now holds dormant
  `study.research`; its admitted-read result exposes a journal-projected v2 candidate derived from
  a cold-reopened pre-synthesis inspection. The candidate closes the exact root,
  admission/read/pass basis and conflict evidence; stale, forged, duplicate, ungranted, and empty
  trigger requests fail closed. The production worker contract accepts only exact cold-audited
  snapshot receipt/extraction identities plus sorted, non-overlapping bounded UTF-8 byte spans. The
  launcher-owned v2 builder emits `external_document_span` only into the report-level evidence list
  as cite-only media context; search operations and snippets are ineligible, and external context
  never enters claim or supported-coverage citations.
- **Still missing:** There is no real search provider or allow-real flag, no pinned-socket dialer
  (the receipts keep disclosing
  `dnsRebindingWindow: "checked_before_fetch_not_pinned"`), no freshness UI or freshness authority,
  and no specialist depth beyond one gap-bound child. The only registered typed insufficiency cause
  is the structurally provable full empty-query case; other terminal cases remain closed.
- **Done when:** A dedicated host exposes bounded search and document snapshot/read operations under
  explicit grants. It limits queries, results, documents, MIME types, bytes, redirects, domains, and
  wall time; rejects local/private-network/file/authenticated destinations; carries no browser
  cookies; and records provider, query, result order, canonical URL, redirect chain, retrieval time,
  response identity, extraction method, document content id, and cited spans. Search snippets are
  routing hints, not citations. A context specialist connects each claim to the exact unresolved
  media range/entity hypothesis, distinguishes current from historical claims, and preserves source
  disagreement. Research may clarify context but cannot rewrite transcript evidence.
- **Non-goals:** Unrestricted browsing, signed-in/private research, arbitrary downloads,
  shell/network access, autonomous publication, or a research worker on every run.
- **Fake-claim risk:** A snapshot proves what a source said at retrieval time—not that it is true,
  current forever, or about the same entity. URL-only and snippet-only citations are not evidence.
- **Existing-spine dependency:** U3 document citations, U4 exact gap cause, scheduler budgets/grants,
  artifact store, report admission/read, and study limitations.

### R2. Optional bounded computer-use when the world is not in the file (offline runtime slice implemented 2026-07-18)

- **Real:** Ambient apps and built-in computer/agent tool families remain closed.
  `computer.use.readonly` is a global child capability behind a distinct dormant root
  `study.computer-use` capability, and neither is on the default root grant. The default scheduler
  has no R2 surface or driver policy. An explicitly composed runtime can admit the dedicated
  `study_computer_use_request` only from the same current v3 basis and a cold-audited R1 empty-query
  cause; ordinary spawn rejects the child capability. The scheduler fixes the exact child contract,
  and the launcher mounts one task-private empty-object `computer_use_readonly` tool bound to the
  grant, task, executor, and launch. Started, completed, and failed events project the operation.
  Five private runtime origins retain the fixture manifest, bounded RGB PNG screenshots, visible
  content, action receipts, and session receipt. The worker may select only bounded region
  identities into `external_screen_region` citations, which admission keeps report-level and
  `cite_only` under exact task, agent, executor, session, and screenshot lineage. The replaceable
  `offline_fixture` driver has no network, filesystem, cookie, credential, download, upload, or
  mutation API. Cold audit reopens the R1 cause and every stored object, reconstructs session and
  cumulative-action identities, and rejects fixture drift.
- **Missing:** No real isolated browser/desktop driver exists for dynamic maps, interactive pages,
  app-only reference material, or other live external context. The offline fixture's zero egress
  does not prove browser process isolation, DNS containment, credential isolation, source freshness,
  or semantic correctness.
- **Done when:** The root can request computer-use only for an exact unresolved context gap after the
  media-native and R1 routes are insufficient. The scheduler grants an ephemeral isolated session
  with allowlisted surfaces/origins, no ambient credentials or cookies, and hard step, screenshot,
  action, wall, download, and egress budgets. The host records the initial state, each action, visible
  result, screenshot/content identity, external source identity, and stop reason. Acquired evidence
  enters U3 through a distinct external-screen origin and exact visual citations. Read-only is the
  default; messages, purchases, publication, uploads, account changes, credential use, and other
  external mutations require a future separately authorized policy and are not part of this rung.
- **Non-goals:** Using a player UI instead of decoding the owned file, unrestricted desktop control,
  background surveillance, signed-in sessions, silent downloads, or a generic “computer-use agent”
  attached to every run.
- **Fake-claim risk:** Screenshots/actions prove that a session navigated somewhere, not that the
  source is authoritative, the entity matches the media, or the agent understood either. Computer-
  use access without a cited external artifact is activity theater.
- **Existing-spine dependency:** U2/U3 visual evidence shape, U4 gap causation, R1 exhaustion reason,
  scheduler budgets/grants, isolated host execution, and immutable action/screenshot receipts.

## Quality boundary and Bet G touchpoints

### G1. Structural/lineage QC is real; semantic QC is still missing

- **Real:** The current caption QC reopens exact current-run candidate, study, readiness, approval,
  and evidence lineage and checks structural availability/completeness. Separately, `hard-ko-v1` is
  frozen and `bench/scores/run-007/score.json` is a human-labeled score receipt with `judge: null`.
- **Missing:** Per-run semantic transcription/translation QC before output, calibrated confidence,
  independent semantic adjudication at product scale, repeated scored captures, registered producer
  ablations, run variance, and generalization to new packs/media classes.
- **Done when:** Keep the two lanes separate. Structural QC continues to answer “is this exact output
  complete, available, and causally supported?” Semantic evaluation answers “is the Korean/English
  meaning correct?” through frozen gold and independent human labels. New producer comparisons pin
  one content-addressed config change where possible: acoustic policy on/off, audio-only versus
  frames, research off/on, raw versus eligible stems, or single versus budgeted multi-pass. Score all
  eligible captures, retain correct/wrong/withheld/missing and catastrophic counts, measure variance,
  and require later packs before generalization claims. Perception producers also get fit-for-purpose
  component labels; those metrics do not become the caption headline. Any later model judge is at
  most an explicitly versioned advisory signal with human audit, never truth or sole authority.
- **Non-goals:** LLM-as-judge-as-truth, coverage/citation closure as accuracy, latency/agent count as
  quality, hiding wrong output behind abstention rate, or using one run-007 score as proof of a moat.
- **Fake-claim risk:** A valid receipt can bind a wrong answer. A structural accept is not a semantic
  accept. One scored capture is not calibration or generalization; the existing negative delta does
  not become an improvement story.
- **Existing-spine dependency:** Runtime outputs/config identities feed Bet G captures, while Bet G
  remains the independent quality authority. Existing clip-level contamination, pre-registration,
  score-everything, and frozen-pack rules remain in force.

## Thin ordered checklist after the UI demo freeze

This is an additive capability ladder, not `OWNED_SWARM_CHECKLIST_v3`. Each slice is independently
reviewable and stops at its stated proof. It is not a one-day or one-release implementation plan;
the ordering expresses dependencies, not a promise that every rung ships together.

1. **Acoustic triage + non-dialogue coverage.** Add one bounded time-ranged acoustic producer and an
   honest not-in-requested-dialogue-scope/unknown policy. Prove that noise/non-speech cannot acquire
   dialogue or translation text; conflict with VAD becomes unknown/withheld and lyrics policy remains
   explicit. Stop before separation or semantic-quality claims.
2. **Receipted frame sample + inspect — implemented 2026-07-17.** One bounded source/video-track
   operation and task-private tool give an authorized child actual PNG image content. Source/range/
   frame lineage, decoder/runtime identity, limits, replay, tamper rejection, and fail-closed errors
   are proved without OCR, visual claims, computer-use, or UI work.
3. **Multimodal admission + abstention v2 — implemented 2026-07-17.** Typed speech, acoustic, and
   cite-only frame identities pass through report admission/read, synthesis, readiness, caption
   causality, and cold replay. Every weak/conflicting/out-of-scope state and all v1 artifacts are
   preserved. No observation-correctness or visual-understanding claim is made.
4. **Budgeted multi-pass re-study — attenuated-speech slice implemented 2026-07-17.** One exact
   weak-range/cause contract, per-range pass ledger, fixed delta/configuration, scheduler caps/dedupe,
   citation-only support, disagreement retention, and terminal exhaustion are wired on the default
   path. Denser frames, padded audio, alternate configurations, and specialists remain closed.
5. **OCR/scene evidence — OCR citation slice implemented 2026-07-17.** A pinned bounded local OCR
   producer over U2 frames now enters U3 only as cite-only media context and abstains on weak,
   conflicting, truncated, or invalid input. Scene/shot production, one genuinely visual specialist
   route, and U4 denser-frame/specialist wiring remain.
6. **Speaker/overlap evidence — coverage + typed U4 trigger slices implemented 2026-07-17.** Pinned local anonymous
   diarization now has path-free grants, immutable complete-range artifacts/receipts, cold audit, and
   U3 coverage/conflict admission. One exact audited overlap cell can now request the existing bounded
   attenuated-speech pass under the closed `speaker_overlap` cause; no person identity and no automatic
   transcript truth comes from speaker labels.
7. **Conditional separation + comparison — U6.1 slice + U7.1 U1-`mixed` trigger implemented 2026-07-17.**
   One exact audited conflicting overlap cell, or one cold-audited acoustic `mixed` cell, may receive
   the pinned private separation grant; raw audio, anonymous stems, lineage receipts, cold audit, and
   same-recognizer comparability are closed. U1 `mixed`-acoustic triggers now reuse the same path
   additively; no other acoustic class qualifies. Run a registered Bet G ablation and require
   independent evidence or human review before any preference or improvement claim.
8. **Receipted web research.** Add safe bounded search + snapshot/read tools, typed span citations,
   freshness/provenance, and one exact gap-triggered context specialist. No ambient web or fixed
   research-worker count. The trigger-gated grant, scheduler admission, launcher tools, journaled
   operations, production cite-only span report/admission path, and default-v3 pre-synthesis conflict
   trigger are wired offline (2026-07-18); real provider, freshness, DNS pinning, and deeper
   context-specialist synthesis remain open.
9. **Optional bounded computer-use.** The configured offline runtime slice now admits one exact-gap,
   cold-audited R1 exhaustion into a task-private read-only fixture session with action/screenshot
   budgets and cite-only screen regions (2026-07-18). Add a real isolated driver only after its
   process, network, credential, and download containment are explicit. It may not replace file
   decoding or perform external mutations.
10. **Semantic evaluation expansion.** Register and score the acoustic, frame, research, separation,
    and multi-pass ablations against frozen Bet G evidence; add repeated captures/variance and later
    packs. Keep production structural QC separate and keep humans—not a model judge—as semantic
    authority.

Every implementation slice includes negative authorization/tamper/limit tests, an observability
record, and an explicit abstention path. UI projection is a later consumer and is not part of this
checklist.

## What Build Week may honestly say

**Product identity:** see [`PRODUCT.md`](../PRODUCT.md). Language intelligence / media understanding.
Korean→English is the proof case. Learning is a later Apply track. Captions and timed text are
downstream Apply outputs, not the product category.

**Runtime honesty (what is actually wired):**

> 1321 has a bounded, local study-first path for owned media on the Korean→English beachhead. An
> explicitly configured model root can request scoped coverage workers; the scheduler grants only the
> tools and media ranges each task needs. When the current-run recognizer is explicitly enabled,
> workers can cite its timed hypotheses in typed coverage reports; the default root can admit reports,
> request one bounded attenuated speech pass for an exact weak range/cause—including one exact
> receipt-backed `speaker_overlap` cell—and synthesize a study
> that retains pass history and terminal weakness. Verified readiness and human approval
> gate private post-study text artifacts and structural QC. Every stage preserves source, task,
> evidence, report, study, approval, artifact, and QC lineage. This is preprocess understanding, not
> a live-translate product.

It is also honest to say:

- the owned-path v2 runtime campaign is implemented and closed;
- the default orchestrator chooses bounded decomposition; the explicit v1 compatibility root retains
  its closed gap-driven follow-up path;
- the default root can request one host-normalized attenuated current-run speech pass; a
  `speaker_overlap` request must echo its exact host-derived cell, while identical work/configuration,
  invalid scope changes, forged causes, and unregistered delta producers fail closed;
- workers use real receipted operations when those operations are granted and configured;
- a missing/unconfigured recognizer is recorded as unavailable rather than replaced by fixture
  evidence;
- the study is structurally coverage/citation/readiness checked, and private captions append only
  after study and human approval;
- recorded fixture output is labeled test/demo-only, and structural QC is not semantic grading;
- `hard-ko-v1` is frozen and the human-labeled run-007 Bet G score exists with `judge: null`; that one
  score is a baseline, not runtime-wide semantic QC or a general improvement claim.

The following sequenced backlog items are not current product claims:

- end-to-end visual/audio understanding of the whole video;
- accuracy or semantic-understanding claims for acoustic classification, sampled frames, OCR
  hypotheses, or the U4 speech pass; padded/denser/alternate/specialist re-study, scene context,
  diarization quality, speaker/overlap understanding, non-darwin speaker runtime support, or source
  separation;
- unrestricted or automatic live web research, historical/cultural grounding, source truth or
  currency, real-provider source retrieval, or live computer-use; the wired R1 and R2 slices are
  offline, exact-trigger-gated, and cite-only;
- semantic per-run QC, calibrated quality, a model judge as truth, or a general “better than cold”
  claim.

The following are parked or outside this climb, not later rungs in the checklist:

- Anki, Quizlet, or Feather export; in-app tutors; learner mastery or measured learning;
- live/low-latency captions, always-on capture, or latency-optimization claims;
- unrestricted browsing/shell/vision/desktop access, credentials, or external mutations such as
  messages, purchases, uploads, publication, and account changes;
- unlimited recursion, transparent continuation, distributed/elastic execution, or unconstrained
  remote workers;
- UI redesign/projection and hosted product-infrastructure work owned elsewhere.

Short version: **the demo may claim a real bounded study / investigation spine for owned media,
gap-directed orchestration within its current grants, receipted tools, private post-study text
artifacts with structural QC, and an existing human-labeled Bet G baseline. The product category is
media understanding / language intelligence, not captions. It may not yet claim full media
understanding or semantic quality.**

## Later appendix: Learning OS and exports

Learning remains part of the long-term product thesis but is intentionally parked behind the
understanding stack above. It is not in the ordered checklist and does not exist today.

When resumed, first define a rights-aware, evidence-linked canonical learning pack derived only from
verified study/readiness/caption identities, with exact media ranges, source/target availability,
citations, limitations, and Bet G routing exclusions. Format adapters for Anki and Quizlet should be
derive-only and importer-conformance tested. A Feather adapter should exist only against a real
versioned Feather import contract; until then it is unavailable, not “Feather-ready.”

In-app learning agents come later still: pack-bound plan → attempt → grounded feedback receipts,
reversible learner state, and no automatic memory promotion. A completed lesson or agent response is
not retention, mastery, or measured learning, and 1321 should not rebuild Feather/SRS as a detour from
understanding the media.
