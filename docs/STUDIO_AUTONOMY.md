# Studio Autonomous Media Runtime

Status: living implementation ledger for the Studio, media runtime, and development lab
Last updated: 2026-07-16

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
13. Assess only completed evidence-read receipts. Every structured conclusion must remain range-
    bound, cite exact receipt/content identities and returned-fact indexes, and preserve upstream
    unknown, withheld, and truncated states.
14. Treat a journal-carried assessment receipt as unaudited until a read-only host path reopens the
    stored assessment and cited read receipts by content identity and closes them against the full
    journal projection. This proves integrity and citation closure, not truth or semantic quality.
15. Decide publish-review eligibility only over successfully audited assessment identities. The
    deterministic gate may emit `withheld` with stable preserved-gap reasons or
    `proceed_to_publish_review`; the latter is authority only for separate host intake to an
    unreviewed queue, never proof that captions exist, English is correct, media claims are true, or
    anything was published.
16. Admit work to publish review only through a separate host producer that re-verifies the exact
    stored decision identity and emits one private content-addressed `queued` or `rejected` receipt.
    `queued` is unreviewed intake; `rejected` preserves the decision reasons. Neither outcome creates
    captions, review completion, upload, publication, public bytes, or media/language truth.
17. Review only a host-verified `queued` intake through one host-configured, explicitly attested local
    operator identity. Record exactly one immutable `approve_for_caption_production` or
    `reject_with_reasons` receipt with closed reasons and an optional bounded note. Approval authorizes
    only the separate bounded caption producer to consume that verified receipt. If approval must be
    withdrawn, append one immutable revocation receipt; never delete or silently replace review history.
18. Produce captions only through a separate host authority whose request contains one exact approval
    identity and nothing else. Reopen the complete review/intake/decision/assessment/read chain and
    require the approval to be unrevoked immediately before the first caption journal mutation. Derive
    source and range from immutable run state; enforce hard duration, line, text-byte, artifact-byte,
    and wall ceilings; emit private content-addressed timed KO+EN artifact and receipt objects. Preserve
    withheld/unavailable instead of inventing target prose. A later revocation blocks new starts and
    marks already completed artifacts as pre-revocation; it does not delete them. Caption completion is
    not correctness, upload, publication, public availability, or permission to publish.

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
| Agent topology | Legacy parent/divided-from projection plus a separate production scheduler, dynamic registry, bounded Codex launcher, and an atomic production-only source-artifact/task/spawn-decision/worker/grant/operation/output-artifact/report projection streamed by the owned-source host poll | Add larger scheduler behavior without altering recorded bundles or claiming a complete swarm |
| Workspaces | Role-specific legacy trace projections plus boring production-only source-artifact, task, spawn-decision, grant, operation, output-lineage, and report regions with in-page links only to identities rendered in that projection | A production agent workspace remains separate work |
| Media evidence | Playhead, marks, waveform, real ffprobe, pinned VAD/language receipts, post-run evidence index, a receipted ffmpeg extract host, and one range-bound ffmpeg audio-activity observation that returns only `signal` or `digital_silence` with volume measurements. Task-private bridges expose granted `media_extract`/`media_seek`, `evidence_read`, `evidence_assess`, and `evidence_decide`; evidence reads are source/window-bound and return only intersecting facts clipped to the task window. The default run-005 proof executes one observation, two reads, one bounded assessment, then one deterministic decision over the audited assessment; V1 gets none of the evidence/assessment/decision grants | Additional individually implemented media operations and detector-backed speech/acoustic/overlap tracks or stems; audio activity is not speech or meaning |
| Coordination | Legacy trace prose plus real bounded Codex child execution, a receipted structured opinion over completed read receipts, a separate deterministic decision over audited assessment identities, a host-only queued/rejected publish-review intake producer, one host-authoritative attested human review/revocation producer, a separate bounded caption producer, worker-output artifacts, structured report-up, and separate validated assessment/decision/intake/review/caption/report projections in the owned-source product path | Parent/orchestrator execution and larger task coordination; never retrofit legacy prose into handoffs, caption input, or publication authority |
| Accuracy | Cross-recognizer agreement, gates, honest nulls | Additional independent checks for separated or overlapping sources |
| Results | Recorded Results remain separate. The owned-source path projects validated decisions, private queued/rejected intake, immutable human approve/reject/revoke receipts, and private caption job/artifact identities plus honest counts. It does not merge those artifacts into replay Results and has no upload or publication producer | Wire verified production captions into the Studio Results surface without replay identity; keep Bet G, study, upload, and publication separate |
| Learning | Immutable proposal/decision/revocation/materialization lifecycle; legacy memory marked unreviewed | Reviewer UX and recording the exact accepted snapshot consumed by a future run |
| Observability | Append-only production journal plus a deterministic content-addressed post-run index, normalized task/agent/operation/execution/handoff/failure facts, structured in-memory filters and aggregations, source identity links, and the separate local Run Explorer | Queue/dependency/reporting spans, critical-path semantics, model-adapter identity and provider units where available, persistent multi-run storage, and retention/access policy |
| Forecasting | Versioned, content-addressed forecast and run-start freeze artifacts derive a deterministic workload floor from the measured media envelope, selected range, and explicit operation ranges. Default Studio validates and shows the exact pre-start floor and assumptions while rendering elapsed, usage, amount, and currency unavailable | Operation/tier selection, price-book adapter, model-usage estimate producer, elapsed-time and historical calibration, interactive comparison, and separate forecast evaluation |

The URL/demo branch of normal Studio visualizes recorded legacy runs. Its separate owned-source
branch can start and poll the bounded production proof and now projects validated source-artifact,
task, spawn request/decision, worker, grant, operation, output-artifact lineage, and report facts through a
dedicated adapter, but never inserts those production events into the recorded canvas. The separate
`/studio/runtime/` inspector can
validate an operator-selected production NDJSON journal, build its immutable observability index,
query normalized facts, resolve source event/receipt/artifact identities, and project dynamic
workers. It does not start the runtime, search raw journal text, insert events into `run-005` or
`run-006`, or claim that local smoke activity is a recorded demo run.

## Implementation ledger — 2026-07-15

| Phase | Status | Honest boundary |
|---|---|---|
| 0 — evidence shell | Implemented | Build/runtime assertions and exact negative mutations are present. A targeted desktop Playwright case now asserts the host-backed non-empty operation and output lineage, but it was not browser-executed in this slice because the in-app browser exposed no target. |
| 1 — Studio lab | Implemented | Replay controls, cursor reconstruction, checkpoints, and inspector use the production reducer. Scenario breadth still grows only when recorded evidence exists. |
| 2 — preflight | Partially implemented | Owned/local ingest, explicit rights, SHA-256 identity, real ffprobe metadata, and immutable V1/V2/V3 preflight indexes are real. Default Studio now sends explicitly attested owned bytes to the development host, which composes the existing ingest and V1 seal producers and hot-registers the validated source. This browser path does not run speech or language detection, so those findings remain honestly unavailable. Pinned Silero VAD and Whisper language producers remain available to the CLI preflight chain. Hosted/link submission, acoustic/overlap/visual detectors, and measured recommendation remain absent. |
| 3 — tasks and agents | Local vertical slice implemented | `scripts/run-local-worker.ts` requires an explicit owned-preflight directory and language/output inputs, writes the validated run-start receipt, then uses the bounded `codex exec` launcher. The launcher consumes a scheduler permit, registers one isolated child, installs only granted media/evidence/assessment/decision MCP tools, and requires every granted media capability, evidence artifact scope, assessment grant, and decision grant to complete before accepting output. `run-005` remains only the explicit npm smoke/test input. One guarded real-Codex attempt on 2026-07-15 completed seek plus both reads but hit the 45-second wall limit before assess/decide; it is not a passed closed-chain verification. |
| 4 — scoped media/evidence | One perceptual operation plus extract, bounded read, assessment, and audited decision implemented | `media.extract` retains exact ffmpeg extraction authority. The granted `media.seek` path now emits a content-bound `studio.media-perception.receipt.v1` with one exact-range `audio_activity` value (`signal` or `digital_silence`) and volume measurements; it does not claim speech, words, speakers, music, or meaning. `evidence.read` v2 scopes each preflight artifact to its one source and task window and clips every intersecting returned fact to that window. `analysis.evidence.assess` and `analysis.evidence.decide` retain their prior hard bounds and audit-state policy. Separate bridges inject task/agent/operation identity and accept no paths, bytes, prose, caller outcome, or publication controls. Run-005 executes one observation, two reads, one assessment, and one decision; V1 runs only the observation. No new speech/language detector, caption, or publisher runs. |
| 5 — hardest audio | Blocked on producers | No pinned deterministic music/noise classifier, overlap detector, separation system, or quality gate exists. Raw media remains preserved and all such findings stay withheld. |
| 6 — provenance | Partially implemented | Assessment, decision, intake, human review, review-revocation, and caption-production started/completed/failed events retain exact inputs, private content-addressed artifacts, and terminal facts. Each authenticated read reopens its own bytes and recursively verifies the complete prior chain. Product regions expose queued/rejected intake, immutable approve/reject/revoke receipts, reviewer identity/attestation, caption executor/status/counts/artifact identities, and stable gap reasons. Reading is not an artifact producer; assessment is an opinion; decision is an audit-state gate; intake is unreviewed queue lineage; approval is eligibility only. Caption coverage is not quality, upload, or publication. |
| 7 — memory | Production foundation implemented | Future run output becomes immutable evidence-bound proposals; separate decisions, supersession, revocation, and materialization are enforced. Current legacy memory remains unreviewed and current bench data cannot promote a rule. |
| 8 — verification | Partially implemented | Runtime tests carry run-005 through grant → read → assessment → audit → deterministic decision → queued intake → attested approval → bounded caption production → full caption/receipt/upstream re-verification, as well as reject and revoke branches. The fixture produces 16 timed lines with 13 EN available, 2 withheld, and 1 unavailable; tests reject no approval, revoked approval, raw/path/prose/open input, duplicate starts, and artifact tamper, and prove V1 emptiness. Stdio MCP and fake-Codex seams execute the earlier gate; the optional real caption executor and real Codex are not required for seam acceptance. Browser assertions cover the new region when an external deterministic host is supplied. |
| 9 — observability | First production query path implemented | A deterministic post-run indexer rejects malformed production journals, hashes the exact journal and canonical event/receipt sources, cross-checks stored receipt links, and emits only currently produced task, agent, `media.extract`/`media.seek`, handoff, active-span, measured-token, and failure facts. The typed query store supports structured filters and aggregations across immutable indexes; `/studio/runtime/` uses one operator-selected local index and links results to source identities without raw-log search. CLI-default model identity, provider units, billing, queue/dependency/reporting spans, critical path, persistent cross-run storage, and retention/access policy remain unavailable. |
| 10 — forecasting | Deterministic floor plus product forecast surface implemented | `studio.forecast.v1` sums only explicit requested operation ranges inside a content-identified `studio.media-probe.v1` duration envelope. Baseline is labeled as a workload floor; expected, conservative, elapsed time, model usage, pricing, currency, and API cost remain null/unavailable. `POST /v1/runtime-plans` returns the exact forecast without creating a command or runtime directory. Default Studio validates it, shows its range/floor/operation/assumptions, and leaves unavailable values unavailable. Start freezes that same content into `run-start.json`; no pricing, calibration, operation-choice, or evaluation producer is claimed. |
| 11 — local runtime-start host | Local product fragment implemented | The plan/start/poll path registers V2/V3 evidence, derives paired optional read/assess/decide grants, requires one decision after verified assessment, then invokes host-only intake. Separate authenticated reads reopen assessment, decision, intake, immutable human decision/revocation, and caption artifact/receipt content plus full lineage. Closed review mutations bind the host-configured reviewer; caption mutation accepts only an exact approval identity and shares its serialization with revocation. Browser-ingested V1 remains empty through captions. The forecast remains the exact one-seek media workload floor; post-start gate, intake, review, and captions are not forecast work. Restart recovery never relaunches ambiguous work, and production events never enter replay topology. |

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
GET  /v1/runtimes/:runtimeId/assessment-audits
GET  /v1/runtimes/:runtimeId/decision-receipts
GET  /v1/runtimes/:runtimeId/publish-review-intakes
GET  /v1/runtimes/:runtimeId/publish-review-decisions
POST /v1/runtimes/:runtimeId/publish-review-decisions
POST /v1/runtimes/:runtimeId/publish-review-revocations
GET  /v1/runtimes/:runtimeId/caption-productions
POST /v1/runtimes/:runtimeId/caption-productions
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

There is no pause/resume/cancel endpoint. The host does not link-ingest or host remote sources. It
starts only the existing one-child proof objective with one exact scheduler-granted `media.seek`
audio-activity observation over the selected source and half-open window.
When the selected sealed preflight already contains V2/V3 evidence, initialization also registers
the existing speech/language receipt artifacts and the scheduler grants `evidence.read` with exact
artifact ids, source artifact id, task window, and 32 KiB/64-fact ceilings. Reads select only facts
that intersect the window and clip returned ranges to it. The scheduler also grants `analysis.evidence.assess` with
the same artifact allowlist and hard ceilings of one assessment, four completed read receipts,
eight claims, 32 cited returned-fact indexes, and 512 deterministic structured-token units. A
structured token is counted over canonical claim JSON as Unicode word runs or individual
non-whitespace punctuation; it is an authorization unit, not measured model/provider usage. The
paired `analysis.evidence.decide` grant permits one decision over at most four audited assessment
identities. Its host re-runs the assessment audit after the decision-start event and applies the
closed `withhold_on_preserved_gap_state` policy; the child cannot submit reasons or an outcome. The
child must complete every granted read, the assessment, and the decision. V1 receives none of
these grants. The child
receives no media path or bytes, and no transcription,
translation, captions, study output, new detector execution, parent/orchestrator model execution,
or multi-worker swarm is implied.
After a completed decision, the application-level host invokes a separate publish-review intake
producer; no new child capability or MCP tool is exposed. The intake producer accepts only the exact
decision operation/artifact/receipt/content identity, calls the same stored decision verification as
the read path, and journals a private content-addressed `queued` or `rejected` receipt. It queues only
`proceed_to_publish_review`; `withheld` becomes rejected with the same ordered reason codes. Raw
decision bytes, paths, caller outcomes, captions, and prose are outside the closed request. The GET
reopens the intake and repeats the full decision/assessment/read verification, failing the whole read
on tamper or drift.
The human-review mutation is application-host authority, not a child tool. The host exposes one
configured reviewer id/label suitable for local development; the client can submit only the id and
the exact required attestation, while the host supplies and receipts the label. It accepts only one
exact verified queued intake and appends one private content-addressed
`studio.publish-review-decision.receipt.v1` with closed `approve_for_caption_production` or
`reject_with_reasons` semantics, ordered closed reason codes, and a null or single-line 280-character
note. A rejected decision is final for that intake. An unrevoked approval may receive one separate
private `studio.publish-review-revocation.receipt.v1`; the approval remains immutable and visible.
The authenticated review GET re-hashes decision and revocation objects and recursively repeats the
intake/decision/assessment/read verification. Raw bytes, paths, captions, output prose, caller reviewer
labels, mismatched ids, rejected intake, tamper/drift, and duplicate or illegal transitions fail closed.
Caption production is a third application-host authority, not a child tool and not an extension of
review. `POST /caption-productions` accepts exactly `{ approval: { reviewId, artifactId, receiptId,
receiptContentId } }`. The host resolves the source from the runtime artifact store and the range from
`studio.runtime-start.v1`, reopens the complete approval lineage, and requires no revocation before
appending `caption.production_started`. Review/caption/revocation mutations share one per-runtime
serialization path. The fixed limits are 120,000 ms, 64 lines, 32 KiB KO text, 32 KiB EN text,
128 KiB per canonical artifact, and 60,000 ms wall time. Completion stores a private
`studio.caption-production.artifact.v1` with timed KO+EN lines and closed available/withheld/
unavailable reasons, then a private `studio.caption-production.receipt.v1` binding the exact
approval, source, range, executor classification, limits, result counts, and caption content id.
The default `recorded_real_pipeline_fixture` executor composes run-005's prior real recognizer/
translator output; `runtime:host:caption-real` explicitly opts into `real_recognizer_translator`
with ffmpeg plus the recognizer/translator APIs. Missing recognizer/translator output stays
unavailable. GET re-hashes both objects and recursively re-verifies approval/revocation and all
upstream receipts. Revocation before or during completion invalidates the start/read; later
revocation returns `revoked_after_completion` while retaining artifact identities. There is one job
per approval and no upload/publication action.
Default `/studio/` now offers an explicit **Use owned local source** path that lists registered
sessions, shows validated source facts, reviews the exact floor, starts, reads lifecycle, and polls
validated events. The product poll sends complete validated batches through the production-only
adapter and renders separate source/evidence artifacts, tasks, spawn request/decision, registered
workers, capability grants, media operations, evidence reads/assessments, assessment artifacts,
assessment receipt audits, evidence decisions, decision artifacts, verified decision receipts,
publish-review intake lineage/artifacts/verified receipts, human review controls and immutable
decision/revocation lineage/artifacts/verified receipts, output lineage, and structured reports.
The same separate projection now adds caption job state, executor classification, artifact/content
identities, line/available/withheld/unavailable counts, and revocation-after-completion state. It does
not project caption prose, merge into `RunBundle`, or claim a Results/replay identity.
The read endpoints carry no paths or receipt bytes; they
return empty lists until their completed operation exists and fail the whole response closed when
stored content or lineage does not agree with the validated journal.
The deterministic run-005 proof invokes the real ffmpeg seek host, reads both pre-existing pinned
receipts, emits one `studio.evidence-assessment.receipt.v1`, reopens it for audit, and emits then
reopens one `studio.evidence-decision.receipt.v1`, then queues one verified publish-review intake;
a withheld fixture emits rejected intake with preserved reasons. After explicit approval, the
run-005 fixture adapter emits 16 bounded timed KO+EN lines while preserving two withheld targets and
one unavailable source/target. A V1 proof projects empty evidence, assessment, assessment-audit,
decision, intake, human-review, and caption regions. These regions remain empty whenever no
validated events exist. Raw ingest
artifacts are not relabelled as outputs: their region exposes identity and content facts only, and
their storage paths remain absent. Artifact references navigate only to rendered source/output
identities in this same region; receipt identities remain text. A rejected batch leaves the last
completely accepted projection in place and stops polling. The URL/demo path remains recorded
replay. `/studio/?lab=1` retains its lower-level proof
controls. Neither path inserts production events into `RunBundle`, legacy traces, or the recorded
graph.

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
`reachedHead` and `terminal` are true and shows the validated production task, spawn decision,
worker, grant, source-artifact, assessment-artifact, output-artifact lineage, and report facts below
the runtime identities. The production-operations region shows the completed `media.seek`, while
**Evidence artifacts**, **Evidence reads**, **Evidence assessments**, and **Assessment artifacts**
remain explicitly unavailable for that browser-created V1 source. To see original receipt
identities/lineage, bounded completed reads, and one range/citation-bound assessment, restart the host with the sealed run-005
directory registered through `--source-directory`, connect to that session, and repeat review/start.
After deterministic run-005 reaches terminal, **Human review** lists the verified queued intake.
Confirm the named reviewer attestation, choose **Approve for caption production** or select a closed
reason and choose **Reject with reasons**, and optionally enter the bounded note. Approval creates no
captions; it may be superseded with **Revoke approval** after selecting a closed revocation reason and
confirming the separate revocation attestation. To exercise approve and reject independently, start
two fresh runtime commands because every intake accepts exactly one immutable decision.
Stop and restart the same command with
the same ignored `.studio/runtime-host` root, query its command/runtime status, and continue from the
prior cursor. The emitted `events.ndjson` remains directly loadable through the existing manual
`/studio/runtime/` file picker. `npm run runtime:host:codex` is the separately guarded real-executor
path and must be invoked only with explicit authorization.

### Guarded real-Codex run-005 attempt — 2026-07-15

One explicit opt-in attempt used the existing command guard on a fresh ignored runtime root:

```text
npm run runtime:host:codex -- --runtime-root .studio/runtime-host-real-run-005-20260715 --port 4313
```

The authenticated host accepted exactly one start for
`runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a` / command
`runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e`.
Real Codex discovered and completed the granted `media_seek` plus both `evidence_read` calls against
their journaled operation and receipt identities: seek
`operation:bounded-media-seek:3ea64c5620ca47571a78068ada97d5179c7fddf5e3282731089d400d412b60d6`
returned `receipt:50e27b6bb609a1fd2f59f33dee013a4c8d9747edcec1dab8ae2020b53a9a1db4`;
the two reads returned
`evidence-read:25dbe3cf8ed07b71b273bc889e0cdd93381d313115be9f855d4e9f51e1a27e18`
and `evidence-read:bff448f28e3f0fbac18018b291848a17806a99d1f71549a17e7395fc7fd3b157`.
It did not complete `evidence_assess` or
`evidence_decide`: executor receipt
`span:528f2587ac4db945065a15ed6e3f8afc9b89b76fa83258ffc44c875f7dfa6ffb`
records `timed_out` after 45,026 ms against the 45,000 ms active-wall limit. Therefore this is a
blocked partial real-Codex smoke, not closed-chain verification. It was not retried, and none of the
publish-review intake claims depend on it; those are classified separately as deterministic and
fake-Codex verification.

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
5. Implemented 2026-07-14, extended 2026-07-16: bounded `media.seek` perception re-hashes the source, invokes ffmpeg with
   fixed host arguments to decode only the exact granted audio interval, and emits one `signal` or
   `digital_silence` observation from receipted mean/peak volume measurements. It stores the
   `studio.media-perception.receipt.v1` as a content-addressed non-media artifact with raw-source
   lineage and journals the semantic observation through the production projection. A task-private loopback bridge exposes `media_seek` and/or
   `media_extract` only when the scheduler task owns the matching grant and exact scope; the media host
   remains authoritative for live ownership, budget, source hash, range, event, artifact, and receipt
   checks. Audio activity is not speech, words, music, speakers, or meaning. No UI playhead,
   step/loop/mark, frame, or other media operation is claimed.
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
    source-artifact/task/spawn-decision/worker/grant/operation/output-artifact/report view-models and
    renders them outside legacy replay state. Operation cards consume only existing validated
    media-host events; the deterministic worker proof now produces one real completed seek, while
    any execution with no operation events still projects an empty operations region. The source-artifact region
    exposes only validated identity and content facts. Artifact references have in-page hooks only to
    rendered source/output, task, worker, operation/execution, and report identities. No child-visible
    media bytes, caption, study, swarm completeness, or hosted-runtime capability is implied.
12. Implemented 2026-07-15: the bounded child media bridge publishes only the task's granted
    `media_extract`/`media_seek` MCP tools, strips caller control over paths and operation identity,
    forwards exact range calls to the existing ffmpeg capability host, and returns closed receipt and
    artifact identities. The deterministic executor and a real stdio MCP child-process test exercise
    grant -> call -> journal -> projection. The launcher is configured and host-tested with a fake
    Codex JSONL process; a real model-backed `codex exec` invocation remains operator-only and was not
    required to establish the bridge or media-host evidence.
13. Implemented 2026-07-15, range-bound 2026-07-16: `evidence.read` registers only already-validated V2/V3 speech/language
    receipts as private content-addressed preflight-evidence artifacts, derives exact scheduler
    scopes with one exact source artifact, task window, and 32 KiB/64-fact ceilings, and exposes one path-free `evidence_read` MCP tool through a
    separate task-private loopback bridge. The host rechecks live ownership, combined tool-call and
    remaining per-artifact budgets, content identity, receipt kind, source, window, and lineage; the
    `studio.evidence-read.receipt.v2` selects intersecting facts and clips every returned range to the
    authorized half-open window. Run-005 deterministically reads both existing artifacts;
    browser V1 has no grant and no facts. Launcher completion requires every granted evidence
    artifact to be read. Product projection adds boring **Evidence artifacts** and **Evidence reads**
    regions. Deterministic and fake-Codex seams are tested; a real model-backed Codex invocation was
    not run for this tranche.
14. Implemented 2026-07-15: `analysis.evidence.assess` consumes only completed same-task
    `studio.evidence-read.receipt.v2` identity/content pairs through the path-free `evidence_assess`
    MCP tool. The host re-hashes stored receipts, rechecks live ownership/grant/tool-call and
    assessment/receipt/claim/citation/structured-token budgets, rejects unread receipts and invalid
    returned-fact indexes/ranges/values, derives upstream supported/unknown/withheld/truncated state,
    and emits `studio.evidence-assessment.receipt.v1` as a private content-addressed artifact.
    Deterministic run-005 performs one assessment after two reads; browser V1 receives no grant.
    Deterministic, stdio MCP, and fake-Codex seams are tested; real Codex and browser assertions were
    not executed for this tranche.
15. Implemented 2026-07-15: the authenticated assessment-audit endpoint reopens the private
    `studio.evidence-assessment.receipt.v1` object and every cited `studio.evidence-read.receipt.v1`
    object by content identity, verifies canonical hashes/receipt ids, exact claim range/value/state
    derivation, returned-fact indexes, and journal/artifact/task lineage, and returns only the closed
    claim/citation view. Product navigation targets only already-rendered read receipts, artifacts,
    tasks, workers, and operations. Restart, mutated-byte, swapped-content, out-of-lineage, journal-
    mismatch, and V1-empty cases are runtime-tested. Playwright assertions are authored but were not
    executed; real Codex remains optional and was not run.
16. Implemented 2026-07-15: `analysis.evidence.decide` consumes only exact successfully audited
    assessment operation/artifact/receipt/content identities through the path-free
    `evidence_decide` MCP tool. The host rechecks live owner/grant/tool and 1-decision/4-input
    budgets, records started/completed/failed events, re-runs the stored assessment/read audit, and
    emits private content-addressed `studio.evidence-decision.receipt.v1`. Its deterministic policy
    emits `withheld` with canonical `audited_claim_withheld`, `audited_claim_unknown`, and/or
    `audited_claim_truncated` reasons, or `proceed_to_publish_review` with
    `all_audited_claims_supported`. A separate authenticated GET re-hashes that decision, re-runs
    every audit, and re-derives the policy before product projection. Run-005 produces one decision;
    V1 receives no grant and all decision regions remain unavailable. Deterministic, stdio MCP,
    fake-Codex, non-audited, tamper, and skipped-grant seams are runtime-tested. Playwright seams are
    authored but not executed; one guarded real-Codex attempt completed seek and reads but timed out
    before assess/decide. No human review, caption, upload, or publication producer is claimed.
17. Implemented 2026-07-15: the host-only publish-review intake producer accepts only one exact
    decision operation/artifact/receipt/content identity, re-runs stored decision plus complete
    assessment/read audit verification, and emits private content-addressed
    `studio.publish-review-intake.receipt.v1` with only `queued` or `rejected`. Run-005 queues after
    `proceed_to_publish_review`; a withheld fixture rejects with unchanged decision reasons; V1 is
    empty. The authenticated GET reopens intake bytes and repeats the entire decision verification.
    Raw decision bytes, paths, captions, prose, caller outcomes, proceed-without-audit, tamper, and
    drift fail closed. The focused desktop Playwright assertion executed against a fresh
    deterministic/no-model run-005 host and passed; this does not upgrade the partial real-Codex
    result. Intake itself is not human review and creates no caption, upload, publication, public
    artifact, or media/language-truth claim.
18. Implemented 2026-07-15: the host-authoritative human review producer accepts only one exact
    recursively verified `queued` intake identity and the host-configured local reviewer id plus
    required attestation. It appends a private content-addressed
    `studio.publish-review-decision.receipt.v1` with closed `approve_for_caption_production` or
    `reject_with_reasons`, ordered reasons, and an optional bounded note. Rejection is immutable for
    that intake; an unrevoked approval may be superseded only by one separate content-addressed
    `studio.publish-review-revocation.receipt.v1`. Authenticated GET verification reopens every review,
    revocation, intake, decision, assessment, and read receipt. The product exposes boring approve,
    reject, and revoke controls plus honest V1/absent/rejected-intake/unverified empty states. Focused
    tests cover approve, reject, illegal replacement, revoke, forged reviewer/open input, tamper,
    rejected intake, and V1 empty. No real-Codex rerun was needed or performed; browser execution is
    reported with this tranche. Approval creates no captions, translation, study, upload, publication,
    public artifact, correctness claim, or media/language-truth claim.
19. Implemented 2026-07-15: the separate caption-production host accepts only one exact approval
    identity, recursively re-verifies the stored unrevoked review chain, resolves source/range from
    immutable host state, and journals started/completed/failed. It enforces 120 s, 64 line, 32 KiB
    per-language, 128 KiB artifact, and 60 s wall bounds, then stores private content-addressed
    `studio.caption-production.artifact.v1` and `studio.caption-production.receipt.v1` objects with
    timed KO+EN lines and first-class withheld/unavailable states. The default executor adapts the
    run-005 output previously produced by the real run-clip recognizer/translator and labels itself
    `recorded_real_pipeline_fixture`; an explicitly guarded OpenAI executor is available but was not
    required for acceptance. GET verification reopens caption/receipt bytes and the complete approval
    chain. Revocation blocks new starts; a later revocation retains completed artifacts and returns
    `revoked_after_completion`. Product wiring shows only job state, executor, identities, and counts
    under stable caption-production selectors. Focused host/client tests cover no approval, happy
    path, revoked approval, caller path/prose/open input, tamper, and V1 empty. No upload, public
    publication, Results merge, English-quality, SOTA, or Studio-completeness claim is made.

Acoustic classification, overlap detection, source separation, and separation-quality gates follow
the same rule: choose a real deterministic producer first, then add the contract, fixture, policy,
and UI projection together.
