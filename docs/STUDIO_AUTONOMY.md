# Studio Autonomous Media Runtime

Status: living implementation ledger for the Studio, media runtime, and development lab
Last updated: 2026-07-15

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
| Transport seam | Replay pause/step/seek/speed, single-trace legacy live validation, and a separate validated production-journal adapter | Acknowledged production live control; never route production events through legacy traces |
| Source and run start | A loopback runtime-start host accepts explicitly attested bounded owned bytes or operator-selected preflight directories, invokes the existing ingest/ffprobe/V1-seal chain for browser media, revalidates every indexed byte, hot-registers and resolves stable session/revision identities, exposes a read-only exact plan, durably claims `commandId`, writes an immutable adjacent `studio.runtime-start.v1`, and launches one bounded child at most once. Default Studio can ingest, select, plan, start, and poll without entering replay state | Hosted/link ingest, speech/language detection for browser V1 ingest, a separately versioned production start event if later required, and scheduler task propagation of the accepted language context |
| Agent topology | Legacy parent/divided-from projection plus a separate production scheduler, dynamic registry, bounded Codex launcher, and an atomic production-only task/worker/grant/report projection streamed by the owned-source host poll | Add spawn-decision, operation, artifact, and richer lineage views without altering recorded bundles or claiming a complete swarm |
| Workspaces | Role-specific legacy trace projections | Production task, capability, media scope, artifact, and operation views |
| Media evidence | Playhead, marks, waveform, real ffprobe, pinned VAD speech/non-speech receipts, pinned speech-window language receipts, post-run evidence index, a receipted ffmpeg range extraction host, and a bounded receipted seek observation host | Additional individually implemented media operations and detector-backed acoustic/overlap tracks or stems |
| Coordination | Legacy trace prose plus real bounded Codex child execution, worker-output artifacts, structured report-up, and a separate validated report projection in the owned-source product path | Parent/orchestrator execution beyond the one-child launcher proof; never retrofit legacy prose into handoffs |
| Accuracy | Cross-recognizer agreement, gates, honest nulls | Additional independent checks for separated or overlapping sources |
| Results | Captions, comparison, scores, raw receipts, hashed artifacts, and terminal cue-decision index | Original live worker lineage and per-operation evidence from future runtime runs |
| Learning | Immutable proposal/decision/revocation/materialization lifecycle; legacy memory marked unreviewed | Reviewer UX and recording the exact accepted snapshot consumed by a future run |
| Observability | Append-only production journal plus a deterministic content-addressed post-run index, normalized task/agent/operation/execution/handoff/failure facts, structured in-memory filters and aggregations, source identity links, and the separate local Run Explorer | Queue/dependency/reporting spans, critical-path semantics, model-adapter identity and provider units where available, persistent multi-run storage, and retention/access policy |
| Forecasting | Versioned, content-addressed forecast and run-start freeze artifacts derive a deterministic workload floor from the measured media envelope, selected range, and explicit operation ranges. Default Studio validates and shows the exact pre-start floor and assumptions while rendering elapsed, usage, amount, and currency unavailable | Operation/tier selection, price-book adapter, model-usage estimate producer, elapsed-time and historical calibration, interactive comparison, and separate forecast evaluation |

The URL/demo branch of normal Studio visualizes recorded legacy runs. Its separate owned-source
branch can start and poll the bounded production proof and now projects validated task, worker,
grant, and report facts through a dedicated adapter, but never inserts those production events into
the recorded canvas. The separate `/studio/runtime/` inspector can
validate an operator-selected production NDJSON journal, build its immutable observability index,
query normalized facts, resolve source event/receipt/artifact identities, and project dynamic
workers. It does not start the runtime, search raw journal text, insert events into `run-005` or
`run-006`, or claim that local smoke activity is a recorded demo run.

## Implementation ledger — 2026-07-15

| Phase | Status | Honest boundary |
|---|---|---|
| 0 — evidence shell | Implemented | Build/runtime assertions and exact negative mutations are present. One targeted desktop Playwright case exercised the host-backed production projection on 2026-07-15; the in-app browser surface and full desktop/mobile matrix were unavailable for this slice. |
| 1 — Studio lab | Implemented | Replay controls, cursor reconstruction, checkpoints, and inspector use the production reducer. Scenario breadth still grows only when recorded evidence exists. |
| 2 — preflight | Partially implemented | Owned/local ingest, explicit rights, SHA-256 identity, real ffprobe metadata, and immutable V1/V2/V3 preflight indexes are real. Default Studio now sends explicitly attested owned bytes to the development host, which composes the existing ingest and V1 seal producers and hot-registers the validated source. This browser path does not run speech or language detection, so those findings remain honestly unavailable. Pinned Silero VAD and Whisper language producers remain available to the CLI preflight chain. Hosted/link submission, acoustic/overlap/visual detectors, and measured recommendation remain absent. |
| 3 — tasks and agents | Local vertical slice implemented | `scripts/run-local-worker.ts` no longer reads a fixed `run-005` path internally: it requires an explicit owned-preflight directory and language/output inputs, writes the validated run-start receipt, then uses the existing bounded `codex exec` launcher. The launcher consumes a scheduler permit, registers one isolated child, journals its lifecycle, stores its structured output, and reports through the handoff host. `run-005` remains only the explicit npm smoke/test input. The static Studio is not a runtime service and no live socket/control path is claimed. |
| 4 — scoped media | Two operations implemented | `media.extract` emits a derived audio artifact and `media.seek` decodes a granted audio interval to a null sink, storing the receipt itself as a content-addressed observation artifact with source lineage. Both re-hash the source and enforce exact grants. The Codex child cannot invoke either operation; step, loop, mark, track selection, frames, waveform/spectrogram/OCR tools are not claimed. |
| 5 — hardest audio | Blocked on producers | No pinned deterministic music/noise classifier, overlap detector, separation system, or quality gate exists. Raw media remains preserved and all such findings stay withheld. |
| 6 — provenance | Partially implemented | Recorded artifacts and terminal cue decisions have a deterministic post-run index; the production runtime receipts real derived-media lineage, worker-output content, executor identity, and structured handoff. Legacy report/merge prose is not recast as provenance. |
| 7 — memory | Production foundation implemented | Future run output becomes immutable evidence-bound proposals; separate decisions, supersession, revocation, and materialization are enforced. Current legacy memory remains unreviewed and current bench data cannot promote a rule. |
| 8 — verification | Partially implemented | Build, bench, receipt policy, deterministic launcher/runtime tests, opt-in real Codex smoke, memory policy, and browser-test discovery are automated. The targeted desktop host-backed task/worker/grant/report case passed; the full desktop/mobile browser matrix was not run, the in-app browser surface was unavailable, and no live control producer exists. |
| 9 — observability | First production query path implemented | A deterministic post-run indexer rejects malformed production journals, hashes the exact journal and canonical event/receipt sources, cross-checks stored receipt links, and emits only currently produced task, agent, `media.extract`/`media.seek`, handoff, active-span, measured-token, and failure facts. The typed query store supports structured filters and aggregations across immutable indexes; `/studio/runtime/` uses one operator-selected local index and links results to source identities without raw-log search. CLI-default model identity, provider units, billing, queue/dependency/reporting spans, critical path, persistent cross-run storage, and retention/access policy remain unavailable. |
| 10 — forecasting | Deterministic floor plus product forecast surface implemented | `studio.forecast.v1` sums only explicit requested operation ranges inside a content-identified `studio.media-probe.v1` duration envelope. Baseline is labeled as a workload floor; expected, conservative, elapsed time, model usage, pricing, currency, and API cost remain null/unavailable. `POST /v1/runtime-plans` returns the exact forecast without creating a command or runtime directory. Default Studio validates it, shows its range/floor/operation/assumptions, and leaves unavailable values unavailable. Start freezes that same content into `run-start.json`; no pricing, calibration, operation-choice, or evaluation producer is claimed. |
| 11 — local runtime-start host | Local product fragment implemented | A transport-independent service plus Node HTTP adapter accepts bounded owned bytes through authenticated create/upload/status endpoints, uses only host-chosen ignored paths and fixed producer arguments, hot-registers the sealed V1 source, then preserves the stable-identity plan/start/poll path. Default Studio provides explicit file/rights/progress/select/plan/start/poll controls and atomically projects validated task/worker/grant/report facts through a dedicated production adapter; the lab remains available. Restart recovery never relaunches ambiguous work. `/studio/runtime/` remains a manual journal inspector and production events never enter replay topology. |

## Local runtime-start host

The implemented host is local control-plane infrastructure, not a hosted service. It binds to
`127.0.0.1` by default, rejects non-loopback binding unless the operator supplies the explicit
unsafe-development flag, requires a per-process random bearer token, and returns CORS headers only
for exact configured Studio origins. Request bodies are bounded and every request/query shape is
closed. API responses contain stable source, command, runtime, journal, request, forecast, receipt,
and event identities; they do not contain registered source directories, runtime paths, artifact
storage keys, subprocess arguments, environment variables, or the bearer token.

Source registration can occur at host startup or after a browser-owned ingest. Startup directories
remain an operator escape hatch and are fully loaded by the existing owned-source session loader.
For browser ingest, the client creates metadata with an original basename, byte count, explicit
label, explicit rights holder, fixed `local_processing` scope, and a required ownership/control
attestation. It then PUTs the exact bounded bytes. The host chooses a private path beneath
`.studio/owned-sources`, invokes the existing owned ingest/ffprobe producer, seals V1 with the
existing preflight producer, revalidates every indexed byte, and hot-registers the resulting
session/revision. Sealed directories are rediscovered and revalidated when the host restarts.
Browser status responses contain only job state, safe failure detail, and the path-free validated
source summary. The browser cannot submit a source path, output root, public/redistribution flag,
journal path, artifact-store path, runtime identity, task/agent identity, sequence, scheduler state,
or executable argument.

`commandId` is the idempotency key. A deterministic host allocator derives the runtime identity
from that command so a read-only plan can name the exact runtime-bound source artifact and forecast
without creating filesystem state. The command record is installed only on start as one complete
create-only filesystem claim, so concurrent processes select one accepted identity. Journal id,
accepted/start timestamp, analysis-request identity, and request content identity are recorded in
that claim. A separate complete create-only launch claim is written before the background
executor is scheduled. Its durable existence permanently prevents an automatic second child. A
retry returns the original runtime identity, immutable `run-start.json` content identity, and frozen
forecast; it does not create another runtime directory, rewrite the receipt, or append another root,
task, or agent sequence.

The host lifecycle is `accepted`, `initializing`, `running`, `terminal`, `failed`, or `interrupted`.
Acceptance and creation of a background promise do not imply running. `running` requires a validated
`executor.started` event. Terminal and failure states are reconciled from the complete journal
projection. Safe closed reason codes are stored for initialization failure, executor failure,
interruption, and each ambiguous recovery stage; raw exceptions and subprocess output are not API
evidence.

On restart the host validates the original start receipt and the entire journal without rewriting
either. A claim without a receipt, a receipt without a journal, an empty journal before launch, a
launch claim without execution evidence, or a nonterminal journal becomes an inspectable
`interrupted` state. The first version does not recreate an in-memory scheduler permit and never
relaunches such a child. A terminal journal repairs stale lifecycle metadata. Inconsistent command,
receipt, runtime, or journal identities fail closed.

Cursor polling uses `0` as the initial sentinel. `after` is the last consumed event sequence and is
exclusive. Every poll validates every line and projects the complete prefix before returning a
strictly increasing bounded batch. `nextCursor` is the last returned sequence, or the requested
cursor for an empty batch. A cursor past the current head is an error. Empty journals are valid;
negative/malformed cursors, excessive limits, non-newline-terminated final bytes, malformed events,
gaps, duplicates, cross-run events, and projection-invariant failures are rejected. Returned values
are validated events, never raw log text or legacy traces.

Deterministic execution is the default host script mode. Its receipts identify
`studio.deterministic-test-executor`, record no model usage, and remain in ignored local runtime
directories. It can pause before executor evidence or mid-run and can complete, fail, time out, or
interrupt for tests. Real `codex exec` remains a separate `runtime:host:codex` command guarded by
`--allow-real-codex`; it preserves the existing read-only sandbox, ephemeral session, bounded
output, fixed arguments, no-inherited-shell policy, timeout, structured output, and report-up
contract. Real execution was not run for this host slice.

Implemented HTTP endpoints are:

```text
POST /v1/owned-media-ingests
PUT  /v1/owned-media-ingests/:ingestId/media
GET  /v1/owned-media-ingests/:ingestId
GET  /v1/source-sessions
POST /v1/runtime-plans
POST /v1/runtime-starts
GET  /v1/runtime-starts/:commandId
GET  /v1/runtimes/:runtimeId
GET  /v1/runtimes/:runtimeId/events?after=<cursor>&limit=<n>
```

Owned ingest state is `queued`, `probing`, `sealing`, `registered`, or `failed`. These are host
transitions around actual upload acceptance, the existing ingest/ffprobe process, immutable V1
sealing, and registry validation; there is no animated percentage. Upload length must match the
declared byte count and the configured `--maximum-owned-media-bytes` bound. Redistribution and
publication are not available through this endpoint.

The planning endpoint accepts the same closed product request as start. It revalidates the source,
derives the exact analysis request, work plan, runtime-bound source-artifact identity, and
`studio.forecast.v1`, and returns `not_started` with a null frozen-forecast id. It creates no command,
runtime directory, journal, receipt, or executor. The start endpoint recomputes and freezes that
exact forecast; the product client fails closed if command, runtime, analysis-request, or forecast
content identities differ from review.

There is no pause/resume/cancel endpoint. The host does not link-ingest or host remote sources. It starts
only the existing one-child proof objective: no child media tools, media inspection, transcription,
translation, captions, study output, parent/orchestrator model execution, or multi-worker swarm.
Default `/studio/` now offers an explicit **Use owned local source** path that lists registered
sessions, shows validated source facts, reviews the exact floor, starts, reads lifecycle, and polls
validated events. The product poll sends complete validated batches through the production-only
adapter and renders separate task, registered-worker, capability-grant, and structured-report facts.
A rejected batch leaves the last completely accepted projection in place and stops polling. The
URL/demo path remains recorded replay. `/studio/?lab=1` retains its lower-level proof controls.
Neither path inserts production events into `RunBundle`, legacy traces, or the recorded graph.

### Deterministic operator path

For a new owned source, start the host with browser ingest enabled by default:

```text
node scripts/run-runtime-host.ts --executor deterministic
```

The host prints a random token and accepts only the exact default development origins
`http://127.0.0.1:4321` and `http://localhost:4321`. Open Studio at either origin, choose **Use owned
local source**, keep the default host origin, paste the token, and connect. Choose **Owned media
file**, enter **Source label** and **Rights holder**, check the ownership/control attestation, then
choose **Confirm ownership and ingest**. Studio shows real producer state and auto-selects the
registered V1 session. Enter explicit product language inputs and choose **Review local plan**.
Review the range, workload floor, operation, assumptions, and unavailable values, then choose
**Accept forecast and start local runtime**. The lab's **Repeat
identical start** still confirms the same
command/runtime/journal/receipt/forecast identities. The UI polls from `after=0` until
`reachedHead` and `terminal` are true and shows the validated production task, worker, grant, and
report facts below the runtime identities. Stop and restart the same command with
the same ignored `.studio/runtime-host` root, query its command/runtime status, and continue from the
prior cursor. The emitted `events.ndjson` remains directly loadable through the existing manual
`/studio/runtime/` file picker. `npm run runtime:host:codex` is the separately guarded real-executor
path and must be invoked only with explicit authorization.

The prior CLI remains valid as an escape hatch: run `scripts/preflight-owned-media.mjs` with all
explicit rights fields and `--attest-rights`, then add its sealed directory with
`--source-directory`. `--owned-ingest-root` changes only the host-owned private ingest root;
`--maximum-owned-media-bytes` changes the exact upload bound. Neither flag is accepted from the
browser.

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

Add these concepts only with the named producer. Several now have production foundations; the rows
whose producers remain unavailable are still architectural requirements, not implemented fields.

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
- Project the receipted speech/non-speech and language ranges (implemented for the pinned VAD and
  speech-window language paths), then add music and overlap summaries only when their independent
  producers exist.
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

1. Implemented 2026-07-14: pinned MIT-licensed Silero VAD 6.2.1 and ONNX Runtime 1.27.0 CPU,
   including binary/model hashes, preserved fixed audio normalization, exact sample-range receipts,
   raw frame scores, immutable V2 lineage, Studio projection, and fail-closed mutation fixtures.
2. Implemented 2026-07-14: pinned `Xenova/whisper-tiny` q8 language identification over validated
   `studio.speech-activity.v1` windows, with exact model/runtime/configuration identities, all
   99-language logits and softmax scores, classified/unknown/withheld decisions, immutable V3
   lineage, Studio projection, and fail-closed mutation fixtures. Job and pack language remain
   declarations outside the detector/runtime.
3. Implemented 2026-07-14: bounded local `codex exec` worker launcher, one-use scheduler permit
   consumption, dynamic registration, content-addressed worker output, structured report-up, and a
   separate production-journal Studio adapter/inspector. Fixture-only events and legacy traces remain
   disconnected.
4. Implemented 2026-07-14 for the available producer: the launcher receipts monotonic active spans
   and exact `turn.completed` token usage with a content-addressed raw receipt. Model identity when
   the CLI default is used, provider units, billing, and non-active span phases stay null/unavailable.
5. Implemented 2026-07-14: bounded `media.seek` observation re-hashes the source, invokes ffmpeg with
   fixed host arguments to seek and decode only the exact granted audio interval to a null sink,
   stores its receipt as a content-addressed non-media artifact with raw-source lineage, and journals
   it through the production projection. It is scheduler/host-only: the Codex child still exposes
   only `report.submit`, and no UI playhead, step/loop/mark, frame, or other media operation is claimed.
6. Implemented 2026-07-14: deterministic immutable observability index over validated real
   production journals, exact journal and canonical source hashes, stored-receipt cross-checks,
   normalized task/agent/media-operation/handoff/active-span/measured-token/failure facts, typed
   multi-index filters and aggregations, and a local structured Run Explorer with source identity
   links. No journal prose or provider payload is indexed; unsupported timing phases, critical
   path, CLI-default model identity, provider units, and billing remain null/unavailable.
7. Implemented 2026-07-14 for the available inputs: versioned, content-addressed
   `studio.forecast.v1` records bind the input artifact, measured `studio.media-probe.v1` duration
   receipt, selected range, explicit work-plan operation ranges, estimator version, assumptions,
   and uncertainty. The baseline sums requested media milliseconds as a deterministic workload
   floor, not elapsed time or usage; expected and conservative workloads, elapsed time, model
   usage, calibration, price-book snapshot, currency, and API cost stay null/unavailable. A
   separate `studio.forecast-freeze.v1` binds acceptance to a run start by forecast content id and
   leaves future receipted-actual evaluation separate. Implemented 2026-07-15: default Studio
   validates and displays the exact read-only plan plus workload floor and keeps unsupported values
   unavailable. Pricing, calibration, operation-choice, and evaluation producers are not claimed.
8. Implemented 2026-07-15 for the local owned-source product path: a strict loader revalidates
   the registered rights/source/probe receipts, highest sealed V1/V2/V3 preflight, and every indexed
   byte; derives stable source-session and revision identities; preserves detector receipt content
   ids as evidence; accepts declared, automatic, mixed, unknown, or withheld source-language policy
   separately from one explicit target and optional pack; validates the selected range; creates the
   proof-only work plan and deterministic forecast; and writes a frozen `studio.runtime-start.v1`
   receipt before the existing one-child launcher. Default Studio can now select the registered
   session, submit those fields, review the exact floor, and start/poll the bounded proof. The receipt
   is not yet a production journal event, scheduler tasks do not yet carry this language context,
   and production events do not enter the replay graph.
9. Implemented 2026-07-14: the dedicated memory review inspector validates an operator-selected
   set of proposal, decision, revocation, legacy, materialization, and consumption receipts; derives
   supersession and rollback from those receipts; and exposes both the accepted snapshot content id
   and the full materialization receipt content id. The run-input boundary returns no entries until
   its exact run/snapshot consumption receipt has been recorded. No production run calls that
   boundary yet, so current consumption remains unavailable; the browser view is not repository
   discovery and displays, but does not re-read, externally referenced evidence bytes.
10. Run the authored browser matrix in an environment with an available in-app browser, then add only
   evidence-backed difficult-media scenarios produced by the new detectors.
11. Implemented 2026-07-15: registered-source runtime-start host, read-only exact planning, atomic
    durable command and launch claims, explicit lifecycle records, restart interruption/terminal
    reconciliation, bounded validated cursor polling, deterministic executor controls, authenticated
    loopback HTTP adapter, shared CLI/host application composition, and default-Studio owned-source
    start wiring. The default owned-source path now folds polled events atomically into dedicated
    task/worker/grant/report view-models and renders them outside legacy replay state. No child media,
    caption, study, swarm completeness, or hosted-runtime capability is implied.

Acoustic classification, overlap detection, source separation, and separation-quality gates follow
the same rule: choose a real deterministic producer first, then add the contract, fixture, policy,
and UI projection together.
