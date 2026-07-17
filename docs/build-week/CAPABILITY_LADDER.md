# Capability ladder: media understanding

Status: living **post–Build Week / post-UI-freeze** capability plan
Last updated: 2026-07-16

This document owns the next media-understanding plan. It does not replace the living Build Week
status in [`STATUS.md`](./STATUS.md), reopen owned-path v2, or define UI work. The completed v2 spine
is a dependency: bounded orchestration → current-run semantic evidence → coverage-aware report
admission → gap-directed study planning/synthesis/readiness → study-causal private captions and
structural QC.

The product goal is:

```text
owned video
  → bounded agent team studies the file across as many justified passes as budgets allow
  → evidence-complete study with explicit gaps and abstentions
  → Korean transcript / English translation / captions appended from that study
```

This is preprocess-first, not live or low-latency. It is acceptable to spend more time on a hard
range when each additional pass has a reason, a different evidence request, a budget, and a receipt.
It is not acceptable to turn a weak first pass into fluent dialogue or translation.

## Executive decision

The primary climb is **understanding the owned media end to end**. The next product claim should not
be “more agents” or “faster captions.” It should be more of the source duration truthfully accounted
for by evidence that a bounded specialist actually inspected, with weak regions restudied or
abstained rather than guessed.

The first implementation slice after the UI demo freeze should be a fail-closed **acoustic triage
and non-dialogue coverage boundary**. It should partition an authorized audio range into bounded
speech-candidate, music, noise, mixed, and unknown hypotheses; reconcile those observations with the
existing speech-activity evidence; and make it structurally impossible for a confidently excluded
noise/non-speech range to acquire invented dialogue. Conflicting or weak evidence must become
`unknown`, `withheld`, or `unavailable`, not prose.

Frames remain the next media-native tool because agents cannot understand a video from audio alone.
Web research follows frame/audio understanding when names, history, or cultural context are outside
the file. General computer-use is allowed later as a separately granted, isolated, receipted
capability for dynamic external context; it is not a substitute for decoding and citing the owned
video.

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
2. **U2 — bounded frame sampling and inspection:** give a granted specialist actual frame pixels
   with source/range/decoder receipts.
3. **U3 — multimodal admission and generalized abstention:** carry acoustic, visual, and later
   external evidence through typed citations without upgrading weak/conflicting states.
4. **U4 — budgeted multi-pass re-study:** request denser evidence, attenuated subranges, changed
   producer configurations, or follow-up specialists for exact gaps within pass/run budgets.
5. **U5 — OCR and scene context:** derive and cite provisional on-screen text/scene evidence from U2
   frames.
6. **U6 — speaker/overlap evidence:** preserve anonymous turn/overlap hypotheses and use them to
   trigger scoped re-study.
7. **U7 — conditional separation and comparison:** preserve raw media, receipt derived stems, and
   compare raw/stem evidence only for triggered ranges.
8. **R1 — bounded web research:** add safe search plus document snapshot/span citations for exact
   unresolved context gaps.
9. **R2 — optional bounded computer-use:** after media senses and R1, inspect dynamic external
   context in an isolated read-only session with action/screenshot receipts.
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
| Owned ingest and preflight | Content-addressed owned bytes, rights receipt, `ffprobe`, pinned VAD speech windows, pinned speech-window language ranges, and additive preflight V4 with separately sealed acoustic observations/receipt | Acoustic accuracy evaluation, speaker/overlap, scene, OCR, frames, and visual context | [`ARCHITECTURE.md` — source ingest boundary](../ARCHITECTURE.md#source-ingest-boundary) and [`STATUS.md` — backlog boundary](./STATUS.md#post-freeze-backlog-boundary) |
| Orchestration | A model-executed root can request bounded children; the scheduler derives task/agent/grant identities and enforces scope, depth, concurrency, budgets, dependencies, and required outputs. The study root can disposition/read reports, record exact gaps/conflicts, request a causally linked follow-up, and synthesize | Typed requests for denser evidence, pass ceilings/configuration deltas, the new producers below, and unlimited/distributed execution | [`model/tasks.ts`](../../src/studio/runtime/production/model/tasks.ts), [`orchestratorContract.ts`](../../src/studio/runtime/production/executor/orchestratorContract.ts), and the closed v2 exit in [`STATUS.md`](./STATUS.md#done) |
| Granted media/evidence tools | `media.extract`, bounded `media.seek` audio activity, `speech.transcribe`, exact reads of pinned VAD/language receipts and U1 acoustic observations, evidence assessment/decision, typed report-up, parent admission/read, study planning, and study synthesis | Frames, OCR, scene/shot evidence, speakers/overlap, stems, web research, and computer-use | The exact capability union is in [`model/tasks.ts`](../../src/studio/runtime/production/model/tasks.ts); current semantic evidence is a timed recognizer-hypothesis artifact in [`model/semanticEvidence.ts`](../../src/studio/runtime/production/model/semanticEvidence.ts) |
| Current-run speech evidence | A scoped host and bridge exist. With an explicitly enabled recognizer they can produce current-run timed hypotheses; the default unconfigured recognizer honestly returns unavailable | Semantic accuracy/calibration, a guarantee that every run has a live recognizer, alternative segmentation/recognizer passes, and semantic translation QC | [`currentRunSpeechRecognizer.ts`](../../src/studio/runtime/production/semantic/currentRunSpeechRecognizer.ts) and [`run-runtime-host.ts`](../../scripts/run-runtime-host.ts) |
| Coverage and abstention | Typed study reports partition assigned ranges into supported, withheld, unknown, or failed; U1 readiness adds a separately accounted `not_in_requested_dialogue_scope` policy partition and keeps mixed/weak/conflicting evidence abstained | A generalized weak-evidence/admission rule across future modalities and U4 re-study | [`dialogueScopePolicy.ts`](../../src/studio/acoustic/dialogueScopePolicy.ts), [`model/studyReports.ts`](../../src/studio/runtime/production/model/studyReports.ts), and [`model/studies.ts`](../../src/studio/runtime/production/model/studies.ts) |
| Tool boundary | The launcher exposes only required task-private MCP tools. Ambient web, shell, apps, memories, remote plugins, and built-in multi-agent tools are disabled | Receipted research, frames/vision, and isolated computer-use. These are permitted future capabilities only through new explicit grants | [`codexInvocation.ts`](../../src/studio/runtime/production/executor/codexInvocation.ts) and [`RUNTIME_CONTRACTS.md`](../RUNTIME_CONTRACTS.md#durable-agent-directed-orchestration-kernel) |
| Owned study spine | Typed coverage/citations, parent admission/read, gap/conflict planning, follow-up causation, model-root synthesis, deterministic readiness, and study-causal caption/QC lineage | Evidence types beyond timed speech hypotheses and semantic correctness/truth arbitration | [`model/studyReports.ts`](../../src/studio/runtime/production/model/studyReports.ts), [`model/studies.ts`](../../src/studio/runtime/production/model/studies.ts), and [`STATUS.md`](./STATUS.md#honesty-non-claims) |
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
  clip-level “has music” label.
- **Fake-claim risk:** A VAD or acoustic class is a fallible hypothesis. “Non-speech” does not prove
  silence, and “music” does not prove there are no lyrics. The safe outcome of disagreement is
  abstention or re-study, not fake dialogue.
- **Existing-spine dependency:** Preflight extension pattern, evidence registration/read, coverage
  partitions, job `includeLyrics`/speech-scope policy, and gap-directed planning. This adds evidence
  and a state; it does not reopen v2 orchestration.

### U2. Bounded frames that an agent can actually inspect

- **Real:** The source is content-addressed; video track dimensions are probed; task media scopes,
  artifact storage, media-host authorization, launcher bridges, and receipts already exist.
- **Missing:** No grant samples frames, no child receives frame pixels, and no frame observation can
  be cited. “Frames” in a prompt or UI is not vision.
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
  journal/projection, and tool budgets. U3 is required before a visual finding affects a study.

### U3. Multimodal admission and generalized abstention

- **Real:** `studio.study-report.v1` closes supported ranges and claims to exact current-run speech
  observations; parent disposition/admission/read and study/readiness audits are implemented. The
  existing availability and coverage states already demonstrate fail-closed abstention patterns.
- **Missing:** The citation shape is speech-specific. There is no cross-modal evidence-strength rule,
  no typed conflict between modalities/passes, and no way for frames, OCR, acoustic observations,
  speaker turns, stems, or documents to become first-class study inputs.
- **Done when:** An additive evidence-citation envelope and report/study versions identify evidence
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
- **Existing-spine dependency:** The completed report → admission/read → plan/synthesize → readiness →
  caption lineage. This is additive input and abstention semantics, not a new swarm campaign.

### U4. Budgeted multi-pass re-study

- **Real:** Tasks have media scopes and tool/wall budgets; the model root receives exact coverage
  gaps/conflicts, may request causally linked follow-up tasks, and the scheduler enforces scope,
  depth, concurrency, run budget, dependencies, and deduplication.
- **Missing:** No typed “evidence density” request, per-range pass ledger, required configuration
  delta, or policy for smaller overlapping windows, denser frames, alternate segmentation/recognizer,
  and specialist escalation. A fluent one-shot report can still hide that it made no new observation.
- **Done when:** A report or planning decision can identify an exact weak range and request one bounded
  next pass: attenuated subranges, overlapping/padded audio windows, denser frame timestamps, an
  alternate receipted segmentation/recognizer configuration, or a relevant acoustic/visual/speaker/
  context specialist. The host records prior evidence, cause, requested delta, pass number, reserved
  and measured spend, and terminal outcome. The scheduler caps passes per range and per producer,
  rejects identical work/configurations, and prevents scope broadening. Synthesis retains every pass
  and disagreement rather than silently replacing history. The range becomes supported only through
  new citations; otherwise it terminates unknown/withheld/unavailable when the budget is exhausted.
  “Hard/rapid” must be tied to evidence such as overlap, dense turns, truncation, recognizer
  disagreement, or an exact failed range—not a role label.
- **Non-goals:** Unlimited retries, transparent model-turn continuation, best-of-K cherry-picking,
  repeatedly asking the same model, or blocking the whole run because one range remains unknown.
- **Fake-claim risk:** More passes, more tokens, or more agents do not equal better understanding.
  Without an exact evidence/configuration delta, multi-pass is repeated guessing.
- **Existing-spine dependency:** Existing gap/conflict planning and follow-up causation, scheduler
  limits, task context attenuation, typed reports, observability, and U3 abstention. It exercises the
  closed spine with new evidence requests rather than rewriting it.

### U5. OCR and scene/on-screen context

- **Real:** U2 will provide exact frame bytes; media probe already identifies video tracks and
  dimensions.
- **Missing:** No shot/scene boundary producer, OCR producer, text boxes, script/language confidence,
  or specialist able to cite on-screen evidence.
- **Done when:** A pinned scene/OCR producer emits time-bound hypotheses with frame identities,
  bounding boxes, normalized text, model/runtime/configuration identity, confidence/state, and hard
  limits. A visual-context specialist receives real frames/OCR observations and may report provisional
  displayed names, places, title cards, signs, or scene changes through U3. Low-confidence,
  conflicting, truncated, or off-range text triggers U4 or remains abstained. The root requests the
  specialist only when the source and exact study gap make visual context relevant.
- **Non-goals:** Perfect subtitle extraction, face recognition, biometric/person identity,
  copyrighted frame publication, or silently replacing speech evidence with OCR.
- **Fake-claim risk:** OCR text is a hypothesis, not the identity, spelling, translation, or cultural
  meaning of the thing shown.
- **Existing-spine dependency:** U2 frames, U3 citations, U4 re-study, specialist routing, and study
  conflict/limitation handling.

### U6. Speakers, overlap, and anonymous turns

- **Real:** Exact media tracks/ranges, current-run speech hypotheses, coverage gaps, and conflict-
  driven follow-up spawning exist.
- **Missing:** No diarization/overlap producer, anonymous speaker-turn evidence, or overlap-specific
  re-study trigger exists.
- **Done when:** A pinned producer emits time-ranged anonymous speaker/overlap hypotheses with
  uncertainty, source/configuration identity, and complete range accounting. It may trigger smaller
  ranges or a specialist through U4. Speaker labels remain run/artifact local and cannot imply a
  person. Overlap, uncertainty, and rapid turn-taking survive into U3 coverage and conflicts.
- **Non-goals:** Naming people, cross-video biometric identity, perfect diarization, or treating a
  speaker-count estimate as transcript correctness.
- **Fake-claim risk:** Stable-looking labels such as `speaker_1` are clustering hypotheses, not
  identities; splitting turns does not mean the words were recognized correctly.
- **Existing-spine dependency:** U1 acoustic scope, U3 evidence/abstention, U4 pass requests, and the
  existing semantic evidence/report path.

### U7. Conditional separation and raw-versus-stem comparison

- **Real:** Raw artifacts are preserved; derived-media lineage, exact ranges, current-run recognizer
  receipts, and conflict-aware study planning exist.
- **Missing:** No source-separation host, stem quality gate, or raw/stem comparison report exists.
- **Done when:** Only exact U1/U6-triggered ranges may receive a separation grant. The host preserves
  raw media and stores each stem as a derived artifact with method/model/configuration/source lineage.
  A specialist can run the same recognizer contract over raw and selected stems and report agreement,
  disagreement, or abstention. A deterministic gate checks lineage and comparability; semantic
  preference requires independent evidence or human review. Inconclusive separation stays withheld.
- **Non-goals:** Default separation of every clip, publishing stems, “cleaner sounds better” as a
  metric, or treating same-recognizer agreement on related audio as independent truth.
- **Fake-claim risk:** Separation can create artifacts. A clean-sounding stem may delete speech or
  invent recognizer confidence without improving meaning.
- **Existing-spine dependency:** U1/U6 triggers, U3 citations, U4 pass history, derived artifact
  origins, raw-source preservation, and Bet G raw-versus-stem ablation.

## External context rungs

### R1. Bounded, receipted web research

- **Real:** The root can identify a gap and request a scoped specialist. The runtime budgets tool
  calls and stores/audits content-addressed artifacts. Ambient web is intentionally disabled.
- **Missing:** No research search/fetch/snapshot grant, safe egress host, source-span citation,
  freshness record, or research report admitted to the study.
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

### R2. Optional bounded computer-use when the world is not in the file

- **Real:** General computer-use is not currently granted; ambient apps and built-in computer/agent
  tool families are closed. R1 will handle normal search and static document evidence more safely.
- **Missing:** No isolated read-only browser/desktop capability for dynamic maps, interactive pages,
  app-only reference material, or other external context that cannot be captured through R1.
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
2. **Receipted frame sample + inspect.** Add one bounded source/video-track operation and one
   task-private tool that gives an authorized child actual image content. Prove source/range/frame
   lineage, limits, replay, tamper rejection, and an honest unavailable path. Stop before OCR,
   visual claims, computer-use, or UI work.
3. **Multimodal admission + abstention v2.** Add typed evidence citations and one visual/acoustic
   report through disposition, admission/read, synthesis, readiness, and cold replay. Preserve every
   weak/conflicting state and all v1 artifacts. Stop before claiming observations are correct.
4. **Budgeted multi-pass re-study.** Add one exact gap-to-next-pass contract, per-range pass ledger,
   configuration-delta/dedupe rule, and terminal abstention on budget exhaustion. Prove one hard range
   can narrow into subranges or denser evidence without widening scope or repeating identical work.
5. **OCR/scene evidence.** Add a pinned bounded producer over U2 frames and route one genuinely visual
   gap to one granted specialist. Admit provisional findings through U3; use U4 or abstain when weak.
6. **Speaker/overlap evidence.** Add anonymous diarization/overlap hypotheses and one overlap-driven
   re-study path. No person identity and no automatic transcript truth from speaker labels.
7. **Conditional separation + comparison.** Grant separation only for exact U1/U6-triggered ranges;
   preserve raw audio, receipt stems, compare raw/stem evidence, and withhold when inconclusive. Run
   a registered Bet G ablation before any improvement claim.
8. **Receipted web research.** Add safe bounded search + snapshot/read tools, typed span citations,
   freshness/provenance, and one exact gap-triggered context specialist. No ambient web or fixed
   research-worker count.
9. **Optional bounded computer-use.** Only after media senses and R1, add an isolated read-only
   session for one dynamic external-context gap with action/screenshot budgets and citations. It may
   not replace file decoding or perform external mutations.
10. **Semantic evaluation expansion.** Register and score the acoustic, frame, research, separation,
    and multi-pass ablations against frozen Bet G evidence; add repeated captures/variance and later
    packs. Keep production structural QC separate and keep humans—not a model judge—as semantic
    authority.

Every implementation slice includes negative authorization/tamper/limit tests, an observability
record, and an explicit abstention path. UI projection is a later consumer and is not part of this
checklist.

## What Build Week may honestly say

Recommended README/demo language this week:

> 1321 has a bounded, local study-first path for owned Korean media. An explicitly configured model
> root can request scoped coverage workers, and the scheduler grants only the tools and media ranges
> each task needs. When the current-run recognizer is explicitly enabled, workers can cite its timed
> hypotheses in typed coverage reports; the root can admit reports, plan exact gap/conflict follow-up,
> and synthesize a study whose verified readiness and human approval gate appended private caption
> candidates and structural QC. Every stage preserves source, task, evidence, report, study,
> approval, caption, and QC lineage. This is preprocessing, not a live-caption path.

It is also honest to say:

- the owned-path v2 runtime campaign is implemented and closed;
- the orchestrator chooses bounded decomposition and gap-driven follow-up within the currently
  grantable tool set;
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
- acoustic music/noise/mixed classification, honest non-dialogue coverage, dense budgeted re-study,
  frames/vision, OCR, scene context, speaker/overlap understanding, or source separation;
- web research, historical/cultural grounding, live source citations, or bounded computer-use;
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

Short version: **the demo may claim a real bounded study spine, gap-directed orchestration within its
current grants, receipted tools, private post-study captions, structural QC, and an existing human-
labeled Bet G baseline. It may not yet claim full media understanding or semantic quality.**

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
