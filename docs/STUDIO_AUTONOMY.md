# Studio Autonomous Media Runtime

Status: living implementation ledger for the Studio, media runtime, and development lab
Last updated: 2026-07-13

## Purpose

1321 should study real media before translating it. The difficult case is not one clean speaker.
It is dialogue mixed with music, overlapping speakers, background voices, noise, cuts, unknown
names, incomplete sentences, and evidence that disagrees.

The Studio must make an autonomous swarm legible without pretending that activity happened. The
runtime must give workers real, scoped media tools; the event stream must preserve what they did;
and the UI must be able to reconstruct the run live or afterward from the same events and
artifacts.

## Decisions

1. Perform a lightweight media preflight before starting the expensive swarm.
2. Use deterministic detectors for measurable facts and agents for interpretation and planning.
3. Allow workers to request subagents, subject to scheduler limits and explicit tasks.
4. Grant capabilities per task. Capabilities do not automatically inherit to children.
5. Give every worker a scoped media handle instead of unrestricted access to the whole run.
6. Coordinate primarily through structured report-up handoffs, not an all-to-all agent chat.
7. Keep raw media, derived media, recognizer output, and final decisions linked by provenance.
8. Treat source separation as a fallible derived artifact, never as invisible cleanup.
9. Require review and evidence before a run can promote a correction, glossary entry, or rule.
10. Keep the normal Studio deterministic while the runtime develops. Put inspection controls in a
    development-only lab.
11. Query normalized runtime events and receipts, not raw logs or reconstructed prose.
12. Keep forecasts versioned and auditable. Never present reserved budgets or estimated cost as
    measured usage or provider billing.

## Optimize the media before spawning the full swarm

The first interaction with a link should be a probe, not a full translation run. The probe should
be fast, bounded, and honest about what it measured.

### Preflight pipeline

| Step | Producer | Output | Decision it supports |
|---|---|---|---|
| Source check | Ingest service | Access, source kind, licence, duration | Whether the source may be processed or hosted |
| Container probe | Media tooling | Tracks, codecs, channels, sample rate, dimensions | Which media tools are available |
| Speech activity | VAD | Speech and non-speech windows | Which ranges need language work |
| Language scan | Language detector | Language distribution by time range | Whether Korean is present and where |
| Acoustic scan | Audio classifier | Music, speech, mixed speech/music, noise | Whether specialist analysis is needed |
| Speaker scan | Diarization and overlap detector | Speaker estimates, turns, overlap windows | How to divide segmentation and attribution work |
| Visual scan | Shot/scene detector when video exists | Scene boundaries and on-screen text candidates | Whether visual context can resolve names or speaker identity |
| Complexity estimate | Orchestrator over measured outputs | Suggested range, worker plan, rough processing class | What the user should confirm before the run |

The probe should emit real events and artifacts through the transport. The UI should not animate a
fictional scout. If an inspect agent interprets ambiguous probe results, its inputs and report must
be visible like every other worker's.

### Music is a time-ranged finding, not one clip-level label

The system should distinguish at least these cases:

- Music under dialogue in a show or interview
- A musical performance where lyrics are the primary content
- An intro, outro, bumper, or transition
- Diegetic music playing inside a scene
- Speech, crowd noise, or tonal noise that a detector may confuse with music
- A mixed window where music and several speakers overlap

A detector should first mark the relevant windows. A music or acoustic specialist should be
spawned only when the classification affects the job. That specialist can decide whether to:

- Leave the raw mix intact
- Extract a dialogue-focused stem
- Extract a vocal or lyric-focused stem
- Compare raw and separated recognition
- Ask the user whether song lyrics are in scope
- Withhold a window because separation did not produce trustworthy evidence

The final decision must retain the raw window, any derived stem, the separation method, the
recognizers that consumed each version, and the gate result. Separation can create artifacts, so a
cleaner-sounding stem is not automatically better evidence.

## Autonomous swarm structure

### Hierarchy

```text
Run
  Orchestrator
    Task: inspect and plan
    Task: segment media
      Worker: foreground speech
      Child request: overlapping speech window
        Worker: source separation
        Worker: diarization cross-check
    Task: resolve context
    Task: translate scoped cues
      Child request: song lyrics or difficult register
    Task: quality control
    Task: merge and publish
```

An agent is an executor of a task. Its role alone is not enough to explain why it exists.

Every task should define:

- Objective
- Parent task
- Media scope
- Input artifacts
- Required output type
- Allowed tools and capabilities
- Time, token, and spawn budget
- Dependencies
- Completion, failure, or withholding condition

### Bounded delegation

A worker may request a child when it can name the missing expertise or independent check. The
scheduler decides whether to grant the request.

The scheduler should enforce:

- Maximum spawn depth
- Maximum active workers
- Run and task budgets
- No duplicate task that already has an owner
- A required output contract for every child
- Least-privilege capabilities
- A path for rejection when spawning would not improve the evidence

This preserves meaningful autonomy without allowing recursive spawning to become unbounded cost or
unreadable activity.

### Capabilities and privileges

Capabilities must be enforced by the runtime, not merely displayed by the UI. Example capability
classes include:

- Read a source or derived media artifact
- Seek, play, loop, or scrub within an assigned window
- Extract an audio/video range
- Request waveform, spectrogram, frames, or OCR
- Run a named recognizer or detector
- Write a draft artifact
- Request a child task
- Submit a report to a parent
- Propose a correction or memory item
- Gate, withhold, or publish output

A translation worker should not be able to publish memory. A separation worker should not be able
to publish captions. A QC worker may withhold a line but should not silently rewrite source
evidence.

### Media interaction

Workers need real tools behind a stable interface. At minimum:

- Seek to an exact media time
- Play or inspect a bounded range
- Move forward or backward by a fixed interval
- Loop a region
- Mark a point or time range
- Extract a clip
- Select an audio track or derived stem
- Request frames around a time range
- Attach an observation to a cue, speaker, track, or artifact

Every operation that affects a conclusion should leave a structured receipt in the trace or
artifact lineage. The Studio can then show what the worker actually inspected rather than a generic
activity label.

## Coordination and evidence

### Report-up model

Children should report structured outputs to their parent. Parents merge or reject those outputs.
Peer-to-peer communication is optional and should not become the primary coordination model.

A useful lifecycle is:

```text
task created
spawn requested
spawn granted or rejected
agent registered
media operation performed
artifact created
finding reported
gate passed or failed
task completed, failed, or withheld
agent retired
artifact merged or rejected
memory proposed
memory accepted or rejected
```

### What the Studio must answer

At the swarm level:

- Who exists?
- Why was each worker spawned?
- Which worker divided or delegated work?
- What is blocked, uncertain, or complete?

At the task level:

- What exact question is this worker answering?
- Which media range and artifacts can it access?
- Which capabilities were granted?
- What output must it return?

At the evidence level:

- What did it play, scrub, extract, or compare?
- Which recognizers agreed or disagreed?
- Did the conclusion use raw media or a derived stem?
- What was withheld, corrected, or dropped?
- Which later task consumed the result?

At the learning level:

- What correction or rule was proposed?
- Which run and evidence support it?
- Who or what accepted it?
- Can it be evaluated or rolled back?

## Observability, search, and forecasting

Observability is part of the runtime evidence model, not a secondary log viewer. Raw logs remain
useful for diagnostics, but they are not a stable query contract and may contain private prompts,
media paths, provider payloads, or implementation-specific prose. Cross-run search should consume
validated events and immutable receipts, retain links back to their sources, and expose unknown
values when a real producer did not record them.

The query layer should be able to answer:

- How many agents, tasks, child requests, and media operations participated in a run or range?
- Which worker sought backward, replayed media, retried work, or reprocessed a scene?
- Which task spent the longest queued, actively executing, waiting on dependencies, or reporting?
- Which task or operation occupied the critical path rather than merely accumulating worker time?
- Which agents consumed the most measured tokens, tool calls, media seconds, or provider units?
- Which operations failed, retried, produced withheld evidence, or created accepted artifacts?
- How did the frozen pre-run forecast compare with the completed run?

These questions require explicit semantics. A media seek is not a task retry; a deterministic
Studio replay is not production re-execution; summed worker duration is not elapsed run time; a
reserved token budget is not measured usage. Executors should receipt monotonic active duration
where possible, while the journal preserves event time for ordering and wall-clock analysis.
Provider-specific model and billing payloads stay behind model-execution adapters. A normalized
usage receipt may expose common measured units and an opaque raw receipt reference, but must leave
unsupported fields null.

The first production query path should be:

```text
append-only runtime events + execution, tool, and model-usage receipts
  -> validated immutable observability index
  -> structured filters, aggregations, and source links
  -> Run Explorer and forecast calibration
```

Do not search all raw JSONL in the browser or expand the Studio store into an analytics database.
Keep event validation, indexing, query planning, aggregation, and UI projection in separate
modules. The initial local index may be built after a run, as recorded evidence is today, while the
production query-store interface remains independent of a particular database.

### Forecast planner

The planner should let a user drag a media range and vary analysis operations, model or quality
tier, agent limits, and concurrency. It should show deterministic workload floors plus expected and
conservative ranges for elapsed time and cost. Media duration establishes input volume and some
billing floors, but does not by itself establish wall time because operations can run concurrently
or faster than real time.

Every saved forecast must identify its input artifact and range, requested work plan, estimator
version, calibration evidence, pricing snapshot, currency, assumptions, and uncertainty. Pricing
must come from a versioned price-book adapter rather than hard-coded UI copy. The original forecast
is frozen when a run begins; a separate evaluation compares it with receipted actual usage without
rewriting either record. Until model usage and prices have real producers, the UI may show known
media and operation floors but must leave token and API-cost predictions unavailable.

The primary visualization should combine a draggable range selector, parallel task lanes, critical
path, and cost breakdown. It should label baseline, expected, conservative, measured, and billed
values distinctly and explain which assumptions dominate the estimate.

## Current foundation and gaps

| Area | Current foundation | Required next layer |
|---|---|---|
| Event replay | Ordered typed traces, pure reducer, cursor reconstruction, fixture validation, and checkpoints | Keep exact scenario coverage current as producers grow |
| Transport seam | Replay pause/step/seek/speed and single-trace live validation | Production-runtime adapter and acknowledged live control |
| Agent topology | Legacy parent/divided-from projection plus a separate production scheduler and dynamic registry | Real worker launcher and production-event projection into the graph |
| Workspaces | Role-specific legacy trace projections | Production task, capability, media scope, artifact, and operation views |
| Media evidence | Playhead, marks, waveform, real ffprobe, post-run evidence index, and a receipted ffmpeg range extraction host | Additional individually implemented media operations and detector-backed tracks/stems |
| Coordination | Legacy trace prose plus production bounded tasks and structured report-up | Real worker execution and live projection; never retrofit legacy prose into handoffs |
| Accuracy | Cross-recognizer agreement, gates, honest nulls | Additional independent checks for separated or overlapping sources |
| Results | Captions, comparison, scores, raw receipts, hashed artifacts, and terminal cue-decision index | Original live worker lineage and per-operation evidence from future runtime runs |
| Learning | Immutable proposal/decision/revocation/materialization lifecycle; legacy memory marked unreviewed | Reviewer UX and recording the exact accepted snapshot consumed by a future run |
| Observability | Append-only production journal with task, agent, operation, artifact, and handoff events | Real executor spans, model-usage receipts, immutable cross-run index, and structured query service |
| Forecasting | Preflight has measured media duration and explicit user-selected range | Versioned work planner, price-book adapter, historical calibration, interactive comparison, and forecast evaluation |

The Studio visualizes recorded legacy runs. A production runtime library now exists separately, but
the static Studio is not its host and does not claim that local smoke-test activity happened in a
recorded run.

## Implementation ledger — 2026-07-13

| Phase | Status | Honest boundary |
|---|---|---|
| 0 — evidence shell | Implemented | Build/runtime assertions and exact negative mutations are present. Browser automation is authored but interactive execution is unavailable in the current in-app browser environment. |
| 1 — Studio lab | Implemented | Replay controls, cursor reconstruction, checkpoints, and inspector use the production reducer. Scenario breadth still grows only when recorded evidence exists. |
| 2 — preflight | Partially implemented | Owned/local ingest, explicit rights, SHA-256 identity, real ffprobe metadata, standalone immutable preflight index, range policy, and fail-closed fixtures are real. Hosted submission, deterministic VAD, time-ranged language, acoustic/overlap/visual detectors, and measured recommendation are absent. |
| 3 — tasks and agents | Production foundation implemented | Bounded scheduling, dynamic registration, journal replay, and report-up are real local modules. No real Codex worker launcher or Studio adapter exists, so a live child is not shown in the product. |
| 4 — scoped media | One operation implemented | `media.extract` executes ffmpeg under exact grants and emits content-addressed receipt/lineage. Seek, step, loop, mark, track selection, frames, waveform/spectrogram/OCR tools are not claimed. |
| 5 — hardest audio | Blocked on producers | No pinned deterministic music/noise classifier, overlap detector, separation system, or quality gate exists. Raw media remains preserved and all such findings stay withheld. |
| 6 — provenance | Partially implemented | Recorded artifacts and terminal cue decisions have a deterministic post-run index; the production runtime receipts real derived-media lineage and structured handoff. Legacy report/merge prose is not recast as provenance. |
| 7 — memory | Production foundation implemented | Future run output becomes immutable evidence-bound proposals; separate decisions, supersession, revocation, and materialization are enforced. Current legacy memory remains unreviewed and current bench data cannot promote a rule. |
| 8 — verification | Partially implemented | Build, bench, receipt policy, runtime smoke, memory policy, and browser-test discovery are automated. Interactive desktop/mobile browser execution remains unavailable and no live control producer exists. |
| 9 — observability | Planned, producer-blocked | The journal can support future indexing, but there are no real worker execution spans, model-usage receipts, or cross-run query index. Legacy labels must not be presented as production worker analytics. |
| 10 — forecasting | Planned, partially unblocked | Measured media duration and selected range can support workload floors. Token, cost, and calibrated time ranges remain unavailable until real worker, usage, price-book, and historical producers exist. |

## Submission and customization UX

### Recommended flow

```text
Add source
  -> validate access and rights
  -> probe media
  -> show measured source summary
  -> confirm range and desired output
  -> show the planned analysis
  -> start the full swarm
```

Do not begin an expensive whole-video run immediately after a link is pasted.

### Primary choices

Keep the first confirmation small:

- Suggested Korean speech range, whole detected section, or custom start/end
- Target language
- Captions only or captions plus evidence/breakdown

### Advanced choices

Reveal these only when relevant or explicitly opened:

- Foreground speakers only or include background speech
- Include song lyrics
- Focus on one detected speaker
- Preserve or naturalize honorifics and address forms
- Literal or natural target style
- Caption density or reading speed preference
- Allow a longer, slower analysis

The preflight should populate choices from measured data. Do not ask the user to configure music
handling if no music was detected.

### Source summary example

> Korean speech detected across 0:42-2:18. Approximately three speakers. Music overlaps 26 seconds,
> with two possible multi-speaker regions. Suggested first analysis: 0:42-1:42.

The UI should distinguish measurements from estimates and make uncertain findings inspectable.

### Duration policy for the first version

- Default suggested selection: 30 to 60 seconds
- Hosted hard limit: 120 seconds
- Longer source: probe it, then require a range selection
- Local development: allow longer ranges behind a processing-time warning

Duration is an initial proxy for cost. Later, limits should account for speech seconds, overlap,
music, speaker count, and requested output depth.

### Failure and mixed-language behavior

- Inaccessible or disallowed source: stop before analysis and explain why.
- No Korean detected: fail closed, show the measured language result, and allow an explicit retry or
  range change.
- Mixed language: show language ranges and let the user choose scope.
- Detector uncertainty: do not convert it into a definitive language or speaker claim.
- Excessive duration: retain the probe result and ask for a smaller range.

## Development-only Studio lab

Enable the lab only when the build is in development and the URL contains an explicit lab query.
The normal submission experience must remain unchanged.

The lab should use exact `RunBundle` and trace-compatible fixtures and the same reducer/selectors as
normal replay.

Required controls:

- Pause and resume
- Advance one trace
- Seek to a trace cursor
- Jump to phase checkpoints derived from replay
- Change replay speed while running
- Restart the scenario
- Choose a curated scenario
- Inspect the exact current trace and referenced artifact/cue

Required scenario coverage:

- Bundle loading
- Invalid source
- Load failure
- Ready and empty data
- Spawning
- Listening and context gathering
- Translation and gating
- Pause
- Withheld output
- Regression
- Unscored completion
- Scored completion
- Cancellation
- Music under dialogue
- Main-content music or lyrics
- Overlapping speakers
- Background speech/noise
- Failed or inconclusive source separation

Seeking must reconstruct state by seeding the run and folding traces through the pure reducer. Lab
components must never write desired worker, cue, or score state directly.

## Minimal append-only contract additions

Do not add these until the named producer exists. These are the smallest concepts the autonomous
runtime cannot represent honestly today.

| Concept | Why it is needed | Real producer |
|---|---|---|
| Dynamic agent registration | A child absent from the initial manifest needs role, parent, task, scope, and label | Scheduler after a spawn grant |
| Task definition and lifecycle | Role and status do not describe objective, dependencies, or required output | Orchestrator and scheduler |
| Capability grant | The UI and audit trail must reflect privileges actually enforced | Scheduler/tool host |
| Media-operation receipt | Scrubbing, looping, extraction, and stem selection need structured evidence | Media tool host |
| Artifact lineage | Raw inputs, derived stems, drafts, and merged outputs must remain connected | Worker runtime and artifact store |
| Structured handoff | A parent must know what a child reported and whether it was accepted | Parent worker/orchestrator |
| Control acknowledgement | Live pause or cancellation cannot be claimed before the runtime accepts it | Live orchestrator transport |
| Memory proposal decision | Learning needs evidence, review, and rollback provenance | QC/memory promotion gate |
| Execution span receipt | Queue, active, dependency-wait, and report time need distinct measured intervals | Worker executor using a monotonic clock |
| Model-usage receipt | Token and provider-unit analytics cannot come from budgets or text length | Model-execution adapter retaining the raw provider receipt |
| Pricing snapshot | Cost estimates must remain reproducible after provider prices change | Versioned price-book adapter |
| Observability index | Cross-run queries need validated dimensions, measures, and source links | Deterministic post-run indexer over production receipts |
| Forecast scenario | Interactive estimates need frozen inputs, assumptions, and estimator identity | Forecast engine over measured preflight and explicit work-plan inputs |
| Forecast evaluation | Calibration must compare estimates with actuals without rewriting history | Post-run evaluator over a frozen forecast and receipted usage |

Loading, cancellation display, and lab selection are client/session state. They do not require new
`RunBundle` fields.

## Ordered implementation backlog

### Phase 0: Stabilize the evidence shell

- Add build-time validation for every recorded run bundle and trace file.
- Add a small runtime bundle assertion so malformed data fails during loading.
- Make unscored copy conditional and remove claims that require gold.
- Ensure completion retires the orchestrator and stops all live motion.
- Handle zero traces, zero cues, missing paths, and empty artifacts explicitly.
- Fix orchestrator keyboard activation, waveform keyboard seeking, mobile graph positioning, and
  reduced-motion behavior.

Done when malformed or empty data cannot become a plausible-looking result.

### Phase 1: Build the smallest Studio lab slice

- Gate the lab behind development plus an explicit query parameter.
- Add pure cursor reconstruction.
- Add pause, step, seek, restart, speed, and phase jumps for the current run.
- Add an exact trace/cue inspector.
- Add scenario validation to the production check pipeline.

Done when every current stable phase can be deliberately inspected without component state
injection.

### Phase 2: Design and build preflight UX

- Introduce explicit loading, probing, ready-to-confirm, failed, and cancelled session states.
- Implement source/access and media metadata probing.
- Add time-ranged language, speech, music, and overlap summaries.
- Add range selection with a 30 to 60 second recommendation and 120 second hosted cap.
- Add primary and advanced analysis choices.
- Create exact scenarios for no Korean, mixed language, music, overlap, and excessive duration.

Done when pasting a long or difficult source leads to an evidence-backed scope confirmation instead
of an immediate expensive run.

### Phase 3: Introduce task and dynamic-agent primitives

- Add tasks with objectives, parents, media scope, inputs, outputs, dependencies, and budgets.
- Add scheduler-approved spawn requests and dynamic agent registration.
- Project the live agent registry through the reducer instead of relying only on the initial
  manifest.
- Display task purpose and parentage in the graph and agent panel.

Done when a child agent created during a live run can appear, work, report, and retire without being
predeclared in the bundle.

### Phase 4: Add scoped media tools and privileges

- Implement seek, step, loop, region mark, extract, track/stem select, and frame requests.
- Enforce capability grants in the tool host.
- Record media operations and derived artifacts.
- Display media scope, granted capabilities, and recent operations in the worker panel.

Done when every displayed media interaction corresponds to a real authorized operation.

### Phase 5: Exercise the hardest audio case

- Add music/speech/noise classification by time range.
- Add overlap detection and targeted source separation.
- Preserve raw and derived media side by side.
- Run independent recognition over appropriate inputs.
- Gate on disagreement and separation uncertainty.
- Add scenarios for dialogue under music, performances/lyrics, crowd speech, and separation failure.

Done when the system can withhold or explain a mixed-source decision without hiding the limitations
of the separation process.

### Phase 6: Make coordination and provenance visible

- Add structured handoff and merge receipts.
- Add an in-run cue/evidence ledger for committed, withheld, corrected, and dropped output.
- Add artifact lineage to the agent panel and completed results.
- Link every final cue to the workers, inputs, gates, and artifacts that produced it.

Done when a user can answer why a final line exists without reading an unstructured log.

### Phase 7: Gate learning and memory

- Treat glossary entries, corrections, and rules as proposals until accepted.
- Preserve supporting run, cue, evidence, and producer references.
- Show accepted, rejected, and superseded learning.
- Re-run the relevant bench before promoting a behavioral rule.

Done when the system can improve without silently converting one uncertain run into permanent
truth.

### Phase 8: Verify the complete experience

- Check all lab scenarios on desktop and mobile.
- Verify keyboard-only navigation and focus behavior.
- Verify reduced motion.
- Verify pause freezes the replay clock and live pause waits for acknowledgement.
- Run production build, fixture validation, and bench checks.
- Commit implementation in focused batches.

Done when the deterministic replay, difficult-media scenarios, and future live transport all drive
the same reducer and user-visible evidence model.

### Phase 9: Index and query runtime observability

- Add executor-produced queue, active, dependency-wait, and reporting spans.
- Add model-adapter usage receipts with normalized measured units and raw receipt references.
- Record media seek, replay, retry, and reprocessing as distinct operations with exact scopes.
- Build an immutable post-run observability index with dimensions, measures, and source hashes.
- Add structured cross-run filters and aggregations before any free-text log search.
- Show critical path, parallel work, failures, retries, tool use, and measured usage in a separate
  Run Explorer module.
- Apply redaction, retention, and access policy before indexing user or provider text.

Done when a query result can be traced to real production events and receipts, and unavailable
measurements cannot silently become zero or estimates.

### Phase 10: Forecast time and cost

- Convert the selected media range and explicit analysis plan into deterministic work units.
- Add a versioned estimator and price-book adapter with reproducible snapshots.
- Keep baseline, expected, conservative, measured, and billed values distinct.
- Add an interactive range and scenario planner with task lanes, concurrency, and critical path.
- Freeze the accepted forecast at run start and evaluate it against receipted actual usage.
- Calibrate only from compatible producer, model, configuration, and workload cohorts.
- Fail closed when historical evidence, usage, or pricing is missing or stale.

Done when a user can change range and work-plan inputs, understand the resulting time and cost
range, inspect every assumption, and later compare the prediction with immutable actual evidence.

## Near-term sequence

The next production slices, in dependency order:

1. Select and pin a licensed deterministic VAD producer, including binary/model hashes, fixed audio
   normalization, exact range receipts, and fail-closed mutation fixtures.
2. Add time-ranged language detection only after it can consume receipted speech windows and record
   its model/version/configuration and unknown results. Keep pack policy outside the detector/runtime.
3. Implement a real local worker launcher and adapt production runtime events into a separate Studio
   projection. Do not connect or translate the fixture-only contract events.
4. Have the launcher receipt executor spans and model usage from the start so observability does not
   depend on reconstructing metrics from logs later.
5. Add the next media capability one operation at a time, starting with a real frame request or
   bounded seek observation, and require the same authorization/receipt standard as extraction.
6. Build the immutable observability index and structured Run Explorer after the launcher has
   produced real events; keep raw diagnostic log search separate and access-controlled.
7. Add the deterministic forecast floor from measured media range and explicit work-plan inputs,
   then add token, cost, and historical calibration only when their producers exist.
8. Add reviewer-facing memory proposal and rollback inspection before any accepted snapshot is fed
   into a new run; record the exact snapshot content id when that first happens.
9. Run the authored browser matrix in an environment with an available in-app browser, then add only
   evidence-backed difficult-media scenarios produced by the new detectors.

Acoustic classification, overlap detection, source separation, and separation-quality gates follow
the same rule: choose a real deterministic producer first, then add the contract, fixture, policy,
and UI projection together.
