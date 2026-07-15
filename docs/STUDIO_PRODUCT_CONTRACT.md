# Studio Product Contract

Status: shared UI/runtime contract and implementation inventory
Last updated: 2026-07-15

## Purpose

This document is the shared boundary between Studio UI/UX work and runtime architecture work.
It records every product stage, visible datum, control, action, evidence source, and unavailable
state needed for the complete 1321 loop:

```text
clip or link
  -> source facts
  -> range and output choices
  -> analysis plan and forecast
  -> swarm execution
  -> captions, study, and evidence
```

The UI/UX chat owns how these contracts are presented. The architecture chat owns the producers
and runtime wiring that make them true. Neither chat may silently change an action's meaning or
promote recorded replay into live runtime evidence.

This is not a second architecture ledger. Runtime design and implementation status remain in
[`docs/STUDIO_AUTONOMY.md`](./STUDIO_AUTONOMY.md), stable boundaries remain in
[`docs/ARCHITECTURE.md`](./ARCHITECTURE.md), and exact wire contracts remain in
[`docs/RUNTIME_CONTRACTS.md`](./RUNTIME_CONTRACTS.md).

## Scope and lane boundaries

In scope:

- `/studio/` source entry, preflight, planning, swarm, workspaces, results, and replay controls
- `/studio/?lab=1` development-only UI states and replay inspection
- `/studio/runtime/` production-journal inspection
- `/studio/runtime/memory/` memory-receipt inspection
- Local ingest, detector, legacy run, scheduler, launcher, journal, media, handoff, forecast, and
  observability seams that can eventually power the Studio
- The data and action contracts needed to replace replay sources incrementally

Out of scope:

- Bet G, gold, controls, freezes, scores, and the `bench/` conveyor unless a Studio runtime
  contract cannot be tested without them
- More listen-pass work
- Visual implementation decisions that do not alter product semantics
- Hosted accounts, sync, private Sori integration, and fine-tuning

## Authority and editing rules

1. The UI/UX chat is the primary editor of this document's surface inventory, interaction
   requirements, state coverage, and acceptance checklist.
2. The architecture chat implements against this document. It owns
   `src/studio/runtime/production/`, local runtime scripts, and the implementation ledger in
   `STUDIO_AUTONOMY.md`.
3. Only one chat should edit this document at a time. Architecture discrepancies should first be
   recorded in its runtime ledger or handed back as a proposed contract change.
4. A control may be redesigned, renamed, or moved by UI/UX, but its **today behavior**, target
   action, evidence class, and unavailable behavior must remain explicit.
5. A real producer does not become a live Studio feature until the Studio invokes it and consumes
   its validated output through an explicit session/job contract.
6. Recorded files never become evidence about a newly submitted URL, selected range, or option.

## Status vocabulary

Every row uses one evidence class and one implementation status.

| Class | Meaning |
|---|---|
| A — recorded replay / preview | The UI projects recorded artifacts or events. It may be interactive, but it is not executing the submitted job. |
| B — local real runtime fragment | A producer performs real work and emits receipts, artifacts, or a production journal. It may still be disconnected from `/studio/`. |
| C — missing / contract only | The desired behavior has no complete producer-to-UI path. A fixture may exercise presentation only. |

| Implementation status | Meaning |
|---|---|
| Real and wired | The user action invokes the real producer and the UI consumes its validated result. |
| Real producer, UI unwired | Real local work exists but `/studio/` does not call or stream it. |
| Recorded replay | The visible state comes from a recorded run bundle and `ReplayTransport`. |
| UI contract only | The control or state exists for replay/fixture coverage but cannot produce a matching new run. |
| Missing | No product surface or adequate producer exists. |

`Unavailable`, `unknown`, `withheld`, and `null` are valid product values. They must not be changed
to zero, false, empty arrays, guessed ranges, estimated prices, or plausible activity.

## Current system truth

- The recorded URL/demo side of default `/studio/` is hard-wired to `run-006` in
  `src/pages/studio/index.astro` and boots a `ReplayTransport` in `src/studio/StudioApp.tsx` and
  `src/studio/store.ts`. A separate **Use owned local source** product control now opens the local
  host path without changing the replay store or projecting production events as replay agents.
- `ReplayTransport` reads `public/demo/runs/<id>/` files. The recorded URL/demo loop does not create
  a runtime job, start `scripts/run-clip.mjs`, start `scripts/run-local-worker.ts`, or load a
  production journal. The owned-source product surface and the development-only `/studio/?lab=1`
  surface call the separate local runtime-start host without changing replay state.
- A submitted YouTube URL creates a `StudioPreviewSession` with `dataSource: "recorded_run"`.
  It starts the recorded run and displays: “This interface preview uses a recorded run. Your
  source was not processed.”
- `run-005` and `run-006` contain recorded artifacts used by the Studio and lab. `run-005` is also
  the content-addressed owned-media validator fixture consumed by local runtime tests.
- A local runtime-start host now exists under
  `src/studio/runtime/production/runtimeHost/`. `npm run runtime:host` starts its deterministic
  one-child proof on loopback with bearer authentication, registered owned-source sessions,
  development-only owned-byte ingest/probe/seal/status endpoints,
  an exact read-only plan/forecast endpoint, idempotent start acknowledgements, lifecycle lookup,
  and validated cursor polling. The shared browser client lists registered sources, validates the
  returned `studio.forecast.v1`, sends product inputs plus stable session/revision identities,
  consumes the acknowledgement and frozen identities, and polls validated events from the last
  consumed cursor. An atomic production-only adapter now folds those events into separate task,
  spawn request/decision, worker, grant, output-artifact lineage, and report view-models in the
  owned-source status surface. This is a real and wired local product fragment, not a caption or
  swarm loop.
- `/studio/runtime/` validates one operator-selected local NDJSON journal and projects normalized
  facts. A host journal remains manually loadable there, but the inspector does not start or
  connect to the host. Its own page states that it “does not start a worker, search raw logs, or
  insert activity into a recorded demo.”
- The local scheduler, artifact store, journal, one-child launcher, forecast freeze, and structured
  report-up remain composed only into the host's bounded proof. Default Studio can now plan, start,
  poll, and project its validated task/spawn/worker/grant/output-artifact/report facts in a separate
  production region, but does not project them into the recorded canvas or publish results.
  `media.extract` and `media.seek` are also real fragments, but remain unavailable to the child.
- `scripts/run-clip.mjs` performs the older real API-backed clip pipeline and writes a recorded run
  folder. Its emitted legacy traces look like a swarm, but it is not the production scheduler or a
  live Studio session.
- UI polish alone cannot change any of these boundaries.

## Product flow contract

| Step | Required user-visible outcome | Today | Class / status | Required runtime boundary |
|---|---|---|---|---|
| 1. Add source | User supplies a supported link or owned clip | A valid YouTube link starts an explicit recorded preview; **Use owned local source** connects to the loopback host, accepts browser-selected owned bytes only after explicit ownership/control attestation, and keeps CLI preflight registration as an escape hatch | A+B / recorded preview plus real browser-owned source path | Hosted/link ingest remains missing; local browser ingest is development-only |
| 2. Validate and probe | Access, rights, duration, tracks, speech, languages, and known gaps | Browser-owned ingest preserves bytes under ignored `.studio/`, runs the existing ffprobe producer, seals V1 preflight, hot-registers the session, and exposes real queued/probing/sealing/registered/failed state. Speech/language findings remain unavailable for this V1 path. Submitted links are not probed | B / real and wired for browser-owned source; detector and hosted-link gaps remain | Add detectors only through their sealed producer chain; do not infer findings from media or filename |
| 3. Choose range | Suggested, detected-language, whole, or custom time window | Owned-source numeric range is bounded by host-reported measured duration; replay custom changes remain blocked; recommendation is absent | A+B+C / real local custom range; replay and missing recommendation boundaries retained | Add measured selection affordance/recommender without inventing findings |
| 4. Choose result | Target language, captions/evidence depth, relevant advanced options | Owned-source path maps explicit declared/target language, optional pack, range, and output contract into `studio.analysis-request.v1`; this does not imply a corresponding output producer | B / real and wired request mapping | Extend only when producers support more options |
| 5. Review plan | Work operations, agent/task limits, assumptions, workload, elapsed-time range, cost range | Default Studio calls the read-only host planner and shows exact selected range, explicit proof operation, deterministic workload floor, assumptions, and unavailable elapsed/usage/cost | B+C / real floor wired; estimators and interactive task planner missing | Add producer-backed operation/tier choices and estimators |
| 6. Start analysis | Accepted plan becomes a run; exact forecast is frozen | **Replay recorded analysis** still starts `ReplayTransport`. Separately, default Studio can **Accept forecast and start local runtime** for a registered owned source; the existing host start freezes the exact reviewed forecast and returns durable identities | A+B / replay plus real and wired local product fragment | Add complete analysis operations and results; do not recast bounded proof as them |
| 7. Spawn agents | Scheduler creates bounded tasks and workers | Recorded manifest/traces animate only for replay; the owned-source path separately projects validated tasks, spawn requests with pending/accepted/rejected decisions, and registered workers without inserting them into replay topology | A+B / bounded local task, spawn-decision, and worker facts wired separately from replay | Add operation views and larger scheduler behavior without creating a swarm-completeness claim |
| 8. Coordinate | Children inspect scoped inputs and report structured outputs upward | Recorded prose remains replay-only; the local one-child report and parent decision are projected as structured production facts, while the child still cannot inspect media | A+B / bounded report-up wired; larger coordination missing | Parent/orchestrator execution, dependencies, retries, and child tool bridge |
| 9. Work through media | Agents seek, loop, mark, extract, inspect frames/tracks, and run detectors | Recorded workspaces are projections; host has only real extract and seek; child can call neither | A+B+C / partial | Capability bridge plus remaining media/detector operations and receipts |
| 10. Control run | Pause, resume, cancel, reconnect, and show accepted state | Pause/resume/stop control replay only. Lab and product local clients project host lifecycle and retry polling from the last consumed journal cursor; product polling atomically updates the separate production fact projection. The host has no pause/resume/cancel endpoint | A+B+C / recorded controls; real local polling/projection wired; runtime controls missing | Add a separate request/ack protocol for live controls without changing replay controls |
| 11. Publish output | Timed source, translation, withheld lines, captions, study, evidence, exports | Recorded captions, comparison, scores, evidence, glossary, and artifact links render | A / recorded replay | Merge/QC/publish task producing immutable result artifacts |
| 12. Inspect real run | Operator can audit actual tasks, operations, usage, handoffs, and failures | The owned-source status surface projects polled task/spawn/worker/grant/output-artifact/report facts; output lineage retains content, producer, origin receipt/execution or operation, upstream-artifact ids when recorded, and report references. The fuller local journal remains manually loadable in `/studio/runtime/` | B / bounded product projection plus full inspector | Add a product operation view and artifact source navigation without merging protocols |

## Surface and control inventory

### 1. Welcome and source entry — `/studio/`

| ID | Visible datum or control | What it does today | Source today | Target semantics | Class / status |
|---|---|---|---|---|---|
| `source.input.open` | **Input Source** | Opens the URL entry control | Client state | Open source selection; no job starts | C / UI contract only |
| `source.url` | **Paste a link** | Parses presentation details client-side | `presentSource()` | Accept supported URL; upload/owned-file selection remains a separate adapter | C / UI contract only |
| `source.edit` | Source review/edit button | Returns to URL editing | Client state | Edit before submission; invalidate any stale probe/plan | C / UI contract only |
| `source.submit` | Arrow, labelled **Launch investigation** | For a valid YouTube URL, creates a UI-only preview and starts `run-006` replay when loaded | `previewSession.ts`, recorded bundle | Rename or redesign so preview and real submission are never the same unlabelled action; real action should create a source session and begin bounded probe only | A / recorded replay |
| `source.preview.notice` | Submitted-source provenance note | Says the submitted source was not processed | `StudioPreviewSession.dataSource` | Must remain visible anywhere a submitted URL is displayed over recorded evidence | A / recorded replay |
| `source.owned.open` | **Use owned local source** | Opens the separate product-facing loopback-host path; it does not submit the URL field or start replay | Client state | Preserve the explicit replay/production boundary | B / real local path entry |
| `demo.open` | **Run Demo** | Opens recorded-source preflight for the loaded bundle | `run-006` | Explicit entry into recorded demonstration | A / recorded replay |
| `bundle.retry` | **Retry loading** | Reloads recorded bundle after a fetch/validation failure | `ReplayTransport` | Retry the current source of truth only; never imply runtime retry | A / recorded replay |

Required states: recorded bundle loading, load failure, empty source, invalid URL, unsupported URL,
submitted-source preview, hosted probe unavailable, and explicit recorded demo.

### 2. Source facts and preflight — `/studio/`

| ID | Visible datum or control | What it does today | Source today | Target semantics | Class / status |
|---|---|---|---|---|---|
| `preflight.source` | Source/creator label | Displays recorded receipt facts or an honest absence | Recorded ingest receipt | Normalized ingest fact; do not infer creator from filename or ownership | A+B / producer recorded, UI replay |
| `preflight.rights` | Rights/licence and attestation | Displays recorded rights basis | Recorded ingest receipt | Gate processing/hosting using adapter-specific receipt | A+B / producer recorded, UI replay |
| `preflight.selection` | Selected source window and duration | Displays recorded window | Recorded ingest receipt | Measured source duration plus selected analysis range | A+B / producer recorded, UI replay |
| `preflight.media` | Playable artifact, waveform, SHA-256, bytes | Displays recorded artifact/provenance | Recorded ingest and probe receipts | Session-bound source/artifact identity | A+B / producer recorded, UI replay |
| `preflight.tracks` | Container, codecs, dimensions, rate, channels | Displays recorded ffprobe data | `media-probe.json` | Real probe projection with source identity | A+B / producer recorded, UI replay |
| `preflight.speech` | Speech duration/windows/coverage | Displays recorded detector receipt when present | `speech-activity.json` | Measured speech/non-speech ranges with producer identity | A+B / producer recorded, UI replay |
| `preflight.languages` | Time-ranged classifications, unknowns, withhelds | Displays recorded detector receipt when present | `language-ranges.json` | Measured ranges; never silently set target language or pack | A+B / producer recorded, UI replay |
| `preflight.acoustics` | Music/noise ranges | Only absence/gap copy exists; empty legacy arrays are not proof | No deterministic producer | Show ranges and uncertainty only after an acoustic receipt exists | C / missing |
| `preflight.overlap` | Speaker count/overlap ranges | Completed-run diarizer labels may be visible elsewhere, but are not preflight facts | No preflight producer | Show estimates and uncertainty only after a producer exists | C / missing |
| `preflight.recommendation` | Suggested range/complexity | Disabled: **no recommender output** | No producer | Explain why the range is suggested and link to measured inputs | C / missing |
| `preflight.coverage` | **Producer coverage** details | Expands recorded producer identities and missing gaps | Recorded receipts and gap registry | Keep as an inspectable honesty surface | A / recorded replay |
| `preflight.dismiss` | **Try another source** / **Close** | Dismisses a failed/cancelled preflight | Client state | Abandon this preflight without creating a run | C / UI contract only |
| `preflight.use-recorded` | **Use recorded source** | Opens recorded demo preflight | `run-006` bundle | Remain an explicit demo fallback, never an automatic substitution | A / recorded replay |
| `local.source.connect` | **Connect to local host** | Uses an exact loopback origin and paste-once bearer token to list only host-registered sessions | `LocalRuntimeHostClient` | Keep paths and tokens out of response bodies | B / real and wired |
| `local.source.ingest` | **Owned media file**, **Source label**, **Rights holder**, explicit ownership/control checkbox, and **Confirm ownership and ingest** | Creates an authenticated local-processing-only job, uploads bounded bytes, invokes the existing ingest/probe/seal producers with host-chosen paths/arguments, and hot-registers the validated result | Runtime host owned-media ingest composition | Never treat filename as rights; never accept client destination paths, public publication, or redistribution through this endpoint | B / real and wired development path |
| `local.source.ingest-progress` | **queued**, **probing**, **sealing**, **registered**, or **failed** | Polls producer-backed job state; terminal registration carries only the validated source summary and stable identities | `GET /v1/owned-media-ingests/:ingestId` | No animated percentage or invented detector progress | B / real and wired |
| `local.source.select` | **Registered owned source** | Selects a host-returned stable source-session/revision; a newly ingested source is cross-checked against the list and auto-selected | `RuntimeSourceRegistry` | Preserve stale-revision checks | B / real and wired |
| `local.source.facts` | Receipt scope, measured duration/tracks, sealed preflight, language-evidence availability, content/session/revision ids | Projects the validated registered source summary; no filename/path is returned | Host source registry over owned preflight receipts | Expand only with validated source-adapter facts | B / real and wired |

Required failure states: inaccessible/disallowed, no target language, mixed language, detector
uncertainty, excessive duration, cancelled, probe failure, and partial probe success. Development
fixtures already exercise several of these but contain no measurements.

### 3. Range, output, and analysis choices — `/studio/`

| ID | Visible datum or control | What it does today | Target semantics | Class / status |
|---|---|---|---|---|
| `request.range.recorded` | **Recorded selection** | Selects the exact range covered by recorded artifacts | Whole measured/default selection | A / recorded replay |
| `request.range.suggested` | **Suggested range** | Disabled because no recommender ran | Select a measured recommendation; show rationale/confidence | C / missing |
| `request.range.detected` | **Measured language ranges** | Disabled because detector evidence does not identify a replayable result subrange | Select one or more measured target-language ranges | C / UI contract only |
| `request.range.custom` | **Custom start and end** | Reveals numeric fields; any changed range is blocked because no matching recorded run exists | Bind a valid half-open range within measured duration | C / UI contract only |
| `request.range.start/end` | Start/end seconds | Edits client request only | Prefer scrubber plus exact accessible fields; changing range invalidates plan/forecast | C / UI contract only |
| `request.long-local` | **Allow this longer local run** | Development-only acceptance for a recorded range; still cannot create a new run | Explicit local policy override with recalculated plan | C / UI contract only |
| `request.target` | **Translation target** | Only the recorded target is offered | Choose a supported target before planning; unsupported pairs fail closed | A+C / UI contract only |
| `request.output.captions` | **Captions only** | Replays the same run and hides evidence/comparison surfaces | Plan only required caption outputs | A / recorded replay presentation |
| `request.output.evidence` | **Captions plus evidence and breakdown** | Replays the same run and shows evidence/comparison | Add evidence/study work to the plan | A / recorded replay presentation |
| `request.speech-scope` | Foreground/all speech | Visible only in relevant fixtures; changed value cannot replay | Planner input gated by measured relevance | C / UI contract only |
| `request.lyrics` | Include lyrics | Visible only in relevant fixtures; changed value cannot replay | Planner input gated by measured music finding | C / UI contract only |
| `request.speaker` | Focus on speaker | Visible only in relevant fixtures; changed value cannot replay | Choose a detector label, not an inferred identity | C / UI contract only |
| `request.honorifics` | Preserve/naturalize | Changed value cannot replay | Translation-plan input | C / UI contract only |
| `request.style` | Literal/natural | Changed value cannot replay | Translation-plan input | C / UI contract only |
| `request.caption-density` | Compact/balanced/relaxed | Changed value cannot replay | Publishing constraint with reading-speed validation | C / UI contract only |
| `request.slow-analysis` | Longer/slower analysis | Changed value cannot replay | Explicit quality/latency tradeoff in the work plan | C / UI contract only |
| `request.cancel` | **Cancel** | Enters a cancelled preflight state; no replay starts | Cancel before runtime start | C / UI contract only |
| `request.confirm-replay` | **Replay recorded analysis** | Validates exact recorded configuration and starts `ReplayTransport` | Must remain explicitly replay-labelled | A / recorded replay |
| `request.local.range` | **Start, seconds / End, seconds** in owned-source path | Binds a non-empty half-open range inside host-reported measured duration | Future media-range control may replace the numeric input without changing units/bounds | B / real and wired |
| `request.local.languages` | Declared source language, target language, optional pack | Maps explicit product language inputs; detector evidence does not mutate them | Extend language modes carefully; never infer pack from detector output | B / real and wired |
| `request.start-local` | **Accept forecast and start local runtime** in default `/studio/`; **Start local runtime** remains in the lab | Sends the exact reviewed request to the existing host start and requires matching command/runtime/request/forecast identities | Never imply captions or a swarm | B / real and wired local product fragment |

Policy: default suggested selection is 30–60 seconds; hosted maximum is 120 seconds; longer local
ranges require an explicit warning. These are policies, not measured cost or elapsed time.

### 4. Plan and time/cost forecast — `/studio/` owned-source path

The first integrated surface is intentionally narrow: one explicit bounded-proof operation over a
numeric measured range. It is a real planner/forecast path, not yet the full task-lane calculator.

| ID | Required datum or control | Available today | Target semantics | Class / status |
|---|---|---|---|---|
| `plan.range` | Draggable selected media range | Owned path shows numeric selected range from the exact host plan; draggable control is absent | Same content-identified range accepted by runtime | B+C / real binding, richer control missing |
| `plan.operations` | Requested operations/task lanes | Shows the explicit `runtime.worker-contract-proof` operation and range; no operation choices or lanes | Human-readable work plan; no hidden operations | B / real and wired narrow plan |
| `plan.agent-limits` | Spawn depth, active workers, concurrency | Scheduler limits exist locally; no Studio selection | Policy-bounded choices, not promises of worker count | B+C / partial |
| `plan.quality` | Model/quality tier | No complete adapter or UI | Versioned choice mapped to supported executor configuration | C / missing |
| `forecast.floor` | Deterministic requested workload | `studio.forecast.v1` selected and summed explicit-operation media duration is shown as **Workload floor** | Never relabel it elapsed time | B / real and wired |
| `forecast.elapsed.baseline` | Baseline elapsed time | `null`, rendered **Unavailable** | Show unavailable until an elapsed-time estimator has evidence | C / missing producer, honest UI wired |
| `forecast.elapsed.expected` | Expected elapsed range | `null` in the validated forecast; no number is rendered | Versioned calibrated estimate with uncertainty | C / missing producer |
| `forecast.elapsed.conservative` | Conservative elapsed range | `null` in the validated forecast; no number is rendered | Versioned calibrated estimate with uncertainty | C / missing producer |
| `forecast.model-usage` | Token/provider-unit estimate | `null`, rendered **Unavailable** | Model-adapter estimate, distinct from budget and actual usage | C / missing producer, honest UI wired |
| `forecast.api-cost` | Estimated amount and currency | amount and currency are `null`, rendered **Unavailable** | Versioned price-book snapshot; no hard-coded UI prices | C / missing producer, honest UI wired |
| `forecast.assumptions` | What dominates estimate | Exact producer assumptions are expandable in the owned-source plan | Always inspectable; name excluded retries/spawns/unknown work | B / real and wired |
| `forecast.accept` | Accept plan and forecast | **Accept forecast and start local runtime** calls the existing start endpoint; the client requires the frozen forecast content id to equal the reviewed one | Freeze exact accepted forecast and create one idempotent run | B / real and wired |
| `forecast.back` | Edit range/options | Any request/source field change discards the reviewed plan and runtime projection; user must review again | Invalidate and regenerate the forecast | B / real and wired, implicit invalidation |

UIUX may design every planner state now. Where producers remain absent, it must render unavailable
values rather than fixture currency or time. A UI-only demonstration fixture may be used only when
visibly labelled as example data and must never enter recorded or production evidence.

### 5. Swarm and global run controls — `/studio/`

| ID | Visible datum or control | What it does today | Target semantics | Class / status |
|---|---|---|---|---|
| `run.topology` | Orchestrator, worker nodes, edges, statuses | Folds recorded legacy traces over a predeclared run manifest | Project production scheduler/registry events | A / recorded replay |
| `run.layout` | Layout segmented control | Rearranges the local graph only | Presentation-only; may remain independent of runtime | A / real UI over replay data |
| `run.pan` | Canvas drag | Pans local graph | Presentation-only | A / real UI over replay data |
| `run.agent.open` | Click agent/orchestrator node | Opens recorded role workspace and history | Inspect the selected production agent/task and its receipts | A / recorded replay |
| `run.production.tasks` | **Production tasks** | Shows scheduler-owned identity, objective, owner, parent, dependencies, required outputs, and journal status from the validated local poll | Keep this production-only; absence is unavailable until `task.created` is validated | B / real and wired bounded facts |
| `run.production.spawns` | **Spawn requests and decisions** | Shows the requester, bounded requested child contract, and pending/accepted/rejected scheduler decision; accepted decisions name the created task/worker and rejected decisions retain the validated rejection code | Never infer a decision from later worker presence; pending stays unavailable until `spawn.decided` is validated | B / real and wired bounded facts |
| `run.production.workers` | **Registered workers** | Shows registry identity, kind, task, parent, and journal status from validated production events | Do not treat recorded status as a presence signal or insert the worker into the replay graph | B / real and wired bounded facts |
| `run.production.grants` | **Capability grants** | Shows scheduler-issued capability, task/worker binding, and exact grant scope | Empty media scope means no media scope was granted; it does not imply a media operation ran | B / real and wired bounded facts |
| `run.production.output-lineage` | **Output artifact lineage** | Shows non-ingest artifacts with artifact/content identity, producer task/worker, receipted execution or operation origin, recorded upstream artifact ids, and validated report references | An empty upstream list is displayed as not recorded; it is not replaced with task inputs or guessed media ancestry | B / real and wired for the bounded worker output; media-operation outputs appear only when their validated events exist |
| `run.production.reports` | **Structured reports** | Shows the validated report summary, output artifact ids, parent edge, status, and decision reason when present | A submitted report keeps its decision reason unavailable until `report.decided` is validated | B / real and wired bounded facts |
| `run.phase` | Phase label and percentage | Derived from replay cursor and trace count | Derive live progress from explicit tasks; never invent a percentage from animation time | A / recorded replay |
| `run.pause` | **Pause/Resume**, space shortcut | Stops/resumes the replay clock exactly | Send a correlated control request; show paused only after runtime acknowledgement | A / recorded replay |
| `run.stop` | **Stop** | Stops replay and marks the client session cancelled | Request cancellation; distinguish requested, accepted, draining, cancelled, and failed | A / recorded replay |
| `run.clear` | **Clear** | Returns to source entry after terminal state | Clear local UI; must not delete runtime evidence | A / client state |
| `run.again` | **Run again** | Restarts the same recorded replay | Offer replay-again separately from new runtime execution | A / recorded replay |

The words **live**, **working now**, **spawned for your source**, and **paused** are production
claims. They require corresponding runtime evidence or acknowledgement.

### 6. Agent focus and workspace — `/studio/`

| ID | Visible datum or control | What it does today | Target semantics | Class / status |
|---|---|---|---|---|
| `agent.identity` | Display name and recorded status; role and id in panel metadata | Uses a run-scoped manifest label when it is distinct from the machine id, otherwise the recorded role-title fallback | Production registry identity plus task ownership | A / recorded replay |
| `agent.previous/next` | Previous/next agent | Navigates currently projected recorded agents | Navigate production registry without changing execution | A / client state |
| `agent.close` | Close/backdrop/Escape | Closes focus surface | Presentation-only | A / client state |
| `agent.activity` | Recorded action history | Filters emitted legacy traces by agent | Query normalized task, operation, execution, and handoff facts | A / recorded replay |
| `agent.segment.media` | Play, pause, ±5 seconds, scrubber | Lets the human inspect recorded media; does not move the agent playhead | Preserve separate human inspection cursor and receipted agent operations | A / recorded replay |
| `agent.segment.marks` | Waveform, playhead, marked ranges | Projects recorded trace effects | Production media-operation receipts and annotations | A / recorded replay |
| `agent.context` | Resolved terms | Projects recorded glossary effects | Run-scoped evidence with source links; no silent memory promotion | A / recorded replay |
| `agent.translate` | Draft/translation state | Projects recorded draft effects | Immutable worker artifacts and revisions | A / recorded replay |
| `agent.qc` | Gates/withholding | Projects recorded gate effects | Structured QC decisions linked to evidence and publish outcome | A / recorded replay |
| `agent.capabilities` | Granted tools/scope | Not shown in main Studio | Show scheduler-enforced grants and exact media scope | B / producer exists, UI unwired |
| `agent.spawn-request` | Child request/decision | The owned-source production region shows validated requests and decisions; recorded agent focus does not consume them | Add an agent-scoped view only through a future production workspace, not the replay focus panel | B / separate production region real and wired; focus unwired |
| `agent.handoff` | Structured report-up | No production view in main Studio | Show submitted/accepted/rejected report and artifacts | B / producer exists, UI unwired |

Focus mode keeps the visual mark, one public display name, and the evidence-derived state as its
identity anchor. Role, machine id, activity, workspace, and provenance remain inside one recorded
workspace instrument. The concise role remit beneath the name is compatibility presentation copy,
not a recorded task objective; a future production projection must replace it with scheduler-owned
objective data. A presentation-only section rail switches that instrument between the
role-specific workspace and recorded activity from the panel's outer right edge. Its active label is
persistent and inactive labels appear on hover or keyboard focus. Previous/next and Esc Close use one
keycap-style command language below the panel, while a spatial X occupies the same right-side rail
as the section controls; there is no competing close control in the panel header. While focus is
open, the top source chrome recedes but
the global recorded-replay Dock remains visible and authoritative for pause, progress, and stop. When
a submitted-source preview is active, its not-processed warning is repeated inside the focus panel.
Keep the recorded-preview boundary until a separate production topology/workspace projection
consumes scheduler evidence; lifecycle polling alone does not make the recorded graph live.

### 7. Results, captions, study, and evidence — `/studio/`

| ID | Visible datum or control | What it does today | Target semantics | Class / status |
|---|---|---|---|---|
| `result.player` | Recorded media play/pause and seek | Plays media from the recorded run folder | Play the immutable input/selected output associated with this run | A / recorded replay |
| `result.caption-view` | **1321 / Cold / Diff** | Switches among recorded caption projections when evidence depth permits | Comparison only when both paths have compatible recorded evidence | A / recorded replay |
| `result.cue` | Timed source/target/withheld rows | Clicking seeks recorded media to the cue | Published timed result with evidence and withholding reason | A / recorded replay |
| `result.scores` | Hard lines, fabrications, coverage, timing | Displays recorded values and honest nulls | Keep benchmark accuracy separate from runtime behavior metrics | A / recorded replay |
| `result.evidence` | Recorded evidence index | Displays post-run index and terminal cue decisions | Link production artifacts/operations without recasting legacy prose as provenance | A / recorded replay |
| `result.study` | Glossary/corrections/evidence breakdown | Present across recorded worker/results artifacts, but no dedicated study/export workflow is complete | Define a focused study artifact and its export contract | A+C / partial |
| `result.raw` | **Raw run** disclosure and artifact links | Expands emitted recorded traces and run files | Keep raw recorded and production protocols distinct | A / recorded replay |
| `result.run-again` | **Run again** | Returns to source entry | Begin a new source session; do not silently rerun or overwrite evidence | A / client state |
| `result.bench-link` | **See the full bench** | Navigates to `/benchmarks/` | Separate lane; not required for runtime wiring | A / navigation |
| `result.export-captions` | Caption download/export | Only raw artifact links may expose files | Explicit SRT/VTT/JSON export from published artifacts | C / missing product control |
| `result.export-study` | Study export | No dedicated control | Export an evidence-linked study artifact; do not rebuild Feather | C / missing |

### 8. Development lab — `/studio/?lab=1`

The lab is development-only. Replay controls remain explicitly recorded; the separate local-host
section is real bounded runtime execution and must retain its no-captions/no-swarm boundary.

| Control | Today behavior | Class / status |
|---|---|---|
| Collapse/expand | Shows or hides lab controls | A / client state |
| Recorded scenario | Chooses exact `run-005` or `run-006` anchors | A / recorded replay |
| Preflight contract | Chooses fixture-only failure/relevance states with no measurements | C / UI contract only |
| Pause/resume | Controls replay clock | A / recorded replay |
| Step one | Folds exactly one recorded trace | A / recorded replay |
| Restart scenario | Reloads and seeks the selected recorded scenario | A / recorded replay |
| Trace cursor | Reconstructs state through the pure replay reducer | A / recorded replay |
| Playback speed | Changes recorded replay pace | A / recorded replay |
| Phase checkpoints | Seeks to exact derived cursor anchors | A / recorded replay |
| Current trace/support | Inspects the exact recorded trace and references | A / recorded replay |
| Connect to local host | Uses an exact loopback origin plus a paste-once bearer token to list registered source sessions | B / real and wired development fragment |
| Start local runtime | Maps product inputs plus the selected stable source-session/revision identities to one host start | B / real and wired development fragment |
| Repeat identical start | Repeats the retained exact request and compares command/runtime/journal/receipt/forecast identities | B / real idempotency proof |
| Runtime lifecycle/journal poll | Keeps accepted/initializing distinct from running, shows closed reasons, and advances only to a validated returned cursor | B / real and wired development fragment |

The lab still needs fixture coverage for live-control pending/rejected
states, page-reload/host-restart reconnect, partial result publication, and export failures. Such
fixtures exercise UI contracts only and cannot be called run evidence.

### 9. Production Run Explorer — `/studio/runtime/`

| Control or datum | What it does today | Class / status |
|---|---|---|
| Select production journal | Reads one local `.ndjson`/`.jsonl` file up to 5 MB in the browser | B / real inspector-wired |
| Validation/rejection | Builds an immutable observability index or fails closed | B / real inspector-wired |
| Agent/task/operation filters | Queries normalized indexed facts | B / real inspector-wired |
| Active duration/tokens/failures | Shows receipted values and coverage; unsupported values are unavailable | B / real inspector-wired |
| Queue/dependency/reporting/critical path/provider/billing | Explicitly unavailable | C / missing producers |
| Operations/executions/handoffs/failures | Shows normalized records with source identities | B / real inspector-wired |
| Worker projection | Shows production task, agent, grants, scope, execution, and report facts | B / real inspector-wired |
| Source identity registry | Resolves event, receipt, and artifact references inside the selected journal/index | B / real inspector-wired |

The inspector does not discover journals, start a worker, control a run, stream appended events,
or convert production events into a legacy `RunBundle`.

### 10. Memory review inspector — `/studio/runtime/memory/`

This operator surface validates an explicitly selected set of proposal, decision, revocation,
materialization, consumption, and legacy receipts. It has no accept/reject/promotion controls and
does not discover repository receipts. It is a real read-only inspector, not part of the first
submit-to-result wiring slice.

## Required data inventory

| Data contract | Needed by | Current producer/source | Current truth | Next owner |
|---|---|---|---|---|
| Source session id and status | Source/preflight/reconnect | Runtime host startup or hot registration and `GET /v1/source-sessions` | Real browser-owned preflight session/revision identity; auto-selectable in default Studio and selectable in the lab | Shared Studio-host wiring |
| Source adapter and rights receipt | Preflight | YouTube and owned/local scripts | Real for browser-owned local ingest and recorded sources; submitted URL remains preview-only | Architecture |
| Raw content id, bytes, preservation | Preflight/provenance | Owned ingest | Real and wired for browser-owned local ingest; real recorded | Architecture |
| Duration, tracks, codecs, dimensions | Preflight/range | `probe-media.mjs` / ffprobe | Real and wired as validated browser-owned source summary; real recorded | Architecture |
| Speech/non-speech ranges | Preflight/plan | Pinned Silero producer | Real for CLI/local and recorded preflights; unavailable for browser-ingested V1 | Architecture |
| Language ranges and uncertainty | Preflight/range | Pinned Whisper-language producer | Real for CLI/local and recorded preflights; unavailable for browser-ingested V1 | Architecture |
| Music/noise ranges | Preflight/plan | None | Withheld | Architecture |
| Speaker/overlap ranges | Preflight/plan | None | Withheld | Architecture |
| Suggested range/complexity | Range/plan | None | Withheld | Architecture |
| Analysis request | Plan/runtime start | `AnalysisRequest` client model and local-host mapper | Owned-source product fields map to validated `studio.analysis-request.v1`; replay request remains separate | Shared contract; UIUX presentation, architecture validation |
| Explicit work plan | Planner/runtime | Runtime-start command and forecast request model | Real one-operation bounded-proof plan shown in default Studio | Architecture |
| Workload floor | Planner | Forecast engine plus `POST /v1/runtime-plans` | Real local and product-wired | Architecture |
| Expected/conservative elapsed time | Planner | None | Unavailable | Architecture |
| Model/provider usage estimate | Planner | None | Unavailable | Architecture |
| Pricing snapshot/currency/API cost | Planner | None | Unavailable | Architecture |
| Frozen accepted forecast | Runtime start/audit | Runtime host and forecast freeze function | Real local; product requires frozen content to equal the reviewed plan and consumes immutable identities | Shared Studio-host wiring |
| Run id/runtime id/journal identity | Run/reconnect/inspector | Runtime-start host acknowledgements, status, and run-start receipt | Real local, durable, and projected in product and development lab | Shared Studio-host wiring |
| Task definitions/dependencies/budgets | Swarm/agent focus | Production scheduler | Real local; selected task definitions/dependencies are projected in the default owned-source surface, while budgets remain undisplayed in this slice | Architecture |
| Dynamic agent registry/grants/scopes | Swarm/agent focus | Production scheduler/registry | Real local; spawn requests/decisions, worker identities, and exact grants/scopes are projected in the default owned-source surface without entering the replay graph | Architecture |
| Live events and cursor | Swarm/reconnect | Authenticated runtime-host polling over the append-only journal | Product and lab poll from the last consumed cursor and surface validation errors; events do not enter replay topology | Shared Studio-host wiring |
| Control request/ack | Dock | None | Missing | Architecture |
| Media-operation receipts | Agent workspace/evidence | `media.extract`, `media.seek` | Real local; child and main Studio unwired | Architecture |
| Remaining media tools/detectors | Agent workspace | None | Missing | Architecture |
| Worker execution and measured usage | Agent/observability | Codex launcher | Real for one child | Architecture |
| Worker output artifact | Agent/result | Codex launcher/artifact store | Real for one child; output identity, producer, executor receipt lineage, and report references are projected in the default owned-source surface | Architecture |
| Structured handoff and decision | Coordination/result | Report host | Real for one child and projected from the validated host journal in the default owned-source surface | Architecture |
| Captions and cue decisions | Results | Legacy run pipeline/recorded bundles | Real recorded output; no production runtime publisher | Architecture |
| Glossary/corrections/study artifact | Results/study | Legacy run pipeline and memory proposal path | Partial recorded artifacts | Shared product definition then architecture |
| Production observability index | Run Explorer | Post-run indexer | Real local and inspector-wired | Architecture |

## Action contracts for real wiring

The first real Studio wiring slice now calls the existing local host without redesigning the
scheduler, inventing another runtime-start protocol, or merging legacy and production event shapes.
For ingest, the shared client submits an original basename, declared byte count, explicit label,
rights holder, fixed local-processing scope, and a true ownership/control attestation, followed by
the exact browser bytes. It never submits a destination path, public flag, executable argument, or
detector fact. After registration, plan/start still submit only product inputs plus stable
`sourceSessionId` and `sourceRevisionId`; they never submit filesystem paths, runtime identities,
journal identities, scheduler state, or executable arguments. The full analysis planner remains a
future slice.

```text
operator starts the loopback host and connects Studio with its bearer token
  -> Studio may list existing registered sources or accept an explicitly attested owned file
  -> host preserves bytes, probes, seals V1, and hot-registers stable source identities
  -> Studio cross-checks and selects the registered source-session/revision
  -> Studio submits product inputs to the read-only exact planner
  -> Studio shows the selected range, explicit work, floor, assumptions, and unavailable estimates
  -> human accepts; Studio sends the same request to the existing start endpoint
  -> host validates, freezes the exact reviewed forecast, and acknowledges one durable command
  -> Studio reads lifecycle status without equating accepted/initializing with running
  -> Studio polls from the last consumed event sequence
  -> an atomic production adapter projects task, spawn, worker, grant, output-artifact, and report facts outside replay state
  -> Studio projects terminal, failed, or interrupted state with the host's safe reason
```

Hosted/link ingest, pause/resume/cancel acknowledgement, hosted execution, child media
inspection, captions or study publication, and production swarm integration remain separate future
boundaries; the local host does not provide them.

Minimum action results:

| Action | Required success result | Required failure behavior |
|---|---|---|
| Ingest owned local media | Real terminal registration with a validated summary and stable session/revision identities | Require explicit ownership/control; reject redistribution, arbitrary paths/fields, mismatched or oversized bytes, probe/seal errors, and path-bearing responses |
| List/select registered source | Stable source-session/revision identity and validated owned-preflight summary | Surface unknown, changed, or stale source identity; never ask the browser for a source path |
| Update request | Validated range and options bound to current source revision | Return field-level reasons; invalidate stale forecast |
| Create forecast | Read-only content-addressed `studio.forecast.v1` plus `not_started`/unfrozen status | Never create runtime state or synthesize missing time, token, or price values |
| Start run | Command, run, runtime, and journal identities plus the immutable run-start receipt and frozen forecast reference | Retry idempotently; never duplicate a run on double click or label acceptance/initialization as running |
| Read lifecycle | `accepted`, `initializing`, validated `running`, `terminal`, or `failed`/`interrupted` with a closed safe reason | Surface `failed` and `interrupted` reasons; do not expose raw exceptions or infer running without executor/journal evidence |
| Subscribe/reconnect | Ordered validated production events after the last consumed sequence | Surface cursor and journal validation errors; never continue animation from a rejected or past-head cursor |
| Request control | Future correlation id and pending state; no host endpoint exists yet | Do not display accepted state before acknowledgement |
| Publish result | Immutable artifact ids plus terminal/partial/withheld status | Partial failures remain visible and inspectable |

## UIUX acceptance checklist

The UIUX demo loop is complete only when a human can exercise every state below using clearly
labelled recorded evidence or contract fixtures:

- [ ] Welcome, source-entry closed/open/edit/review states
- [ ] Invalid, unsupported, inaccessible, probing, partial-probe, and probe-failed states
- [ ] Measured source facts with producer identities and missing-finding explanations
- [ ] Recorded, suggested, detected-language, and custom range presentation
- [ ] Valid, invalid, short, recommended, long, and over-policy ranges
- [ ] Captions-only and captions-plus-evidence result choices
- [ ] Relevant advanced choices without showing irrelevant controls
- [ ] Plan lanes, assumptions, and agent limits
- [ ] Workload floor available while elapsed time and cost are unavailable
- [ ] Forecast loading, stale, failed, accepted, and changed-after-accept states
- [ ] Explicit **Replay recorded analysis** path
- [ ] Separate **Start local runtime** path that cannot be mistaken for replay or caption production
- [ ] Swarm empty, starting, running, waiting, partial failure, withheld, cancelled, and complete states
- [ ] Control requested, acknowledged, rejected, disconnected, and replay-only states
- [ ] Agent task, scope, grants, operations, outputs, handoffs, and absent-evidence states
- [ ] Captions, withheld cues, comparison unavailable, unscored, and partial results
- [ ] Study artifact empty/available and export unavailable/failed/succeeded states
- [ ] Recorded-demo provenance visible wherever a submitted source is paired with replay data
- [ ] Production-inspector provenance remains separate from recorded demo provenance

Completing this checklist proves the product interface, not the runtime.

## Runtime readiness milestones

### Testable without new architecture

- Complete `/studio/` replay loop with `run-006`
- Explicit recorded-source preflight and exact-range replay
- Submitted-URL preview with the source-not-processed notice
- Recorded pause/resume/stop/run-again and agent focus/workspaces
- Recorded captions, comparison, evidence, raw artifacts, and honest nulls
- Development lab scenarios and contract-only preflight states
- Local ingest, probe, speech, and language producers
- Development-only browser-owned upload through the existing ingest/probe/V1-seal producers, with hot registration
- Deterministic forecast workload-floor tests
- Default-Studio registered owned-source selection, exact planner, accept/start, and journal polling
- One bounded local Codex child with journal, usage, output artifact, and report-up
- Development-only runtime host with registered owned sources, idempotent start/status, and
  authenticated validated cursor polling
- Manual production journal inspection in `/studio/runtime/`

### Small wiring slice

The thin slice now connects default `/studio/` as well as `/studio/?lab=1` to the existing host for
registered owned/local receipted sources and one bounded child. The default product path can also
create a registered V1 source from explicitly attested browser-selected bytes. Implemented glue:

- A host client outside static `ReplayTransport`, configured for the exact local
  origin and bearer token
- Authenticated create/upload/status endpoints that write only beneath the host-owned ignored root,
  call `ingest-owned-media.mjs` then `preflight-owned-media.mjs --index-existing`, and hot-register
  without browser-submitted paths or executable arguments
- A default-Studio owned-file, rights-attestation, real-progress, auto-selection, and source-facts path;
  operator `--source-directory` registration remains an escape hatch
- Mapping the existing `AnalysisRequest` to the host request and consuming the idempotent start
  acknowledgement, frozen forecast, and durable command/runtime/journal identities
- A read-only exact planner that creates no command/runtime directory, plus a functional forecast
  surface that keeps elapsed, usage, amount, and currency unavailable
- Lifecycle projection that keeps `accepted` and `initializing` distinct from `running`, which
  requires validated journal/executor evidence, and surfaces closed `failed`/`interrupted` reasons
- Authenticated bounded cursor polling from the last consumed sequence, with visible cursor and
  journal-validation failures
- An atomic dedicated production adapter and boring task/spawn/worker/grant/output-artifact/report
  region; rejected batches preserve the last completely accepted view and never create legacy
  traces or a `RunBundle`
- Explicit UI labels for the production local one-child proof versus recorded demonstration

Still open: hosted/link ingest, speech/language detection for browser V1 ingest, a production
operation view, artifact source navigation, operation/tier choices, calibrated estimation, and
every larger-runtime item below. This slice does not produce autonomous media captions or give the
child media tools.

### Larger runtime work

- Hosted source ingest and hosted runtime service
- Parent/orchestrator execution beyond the one-child proof
- Child-process bridge for scheduler-authorized media and detector tools
- Remaining media operations, acoustic classification, overlap, separation, and visual context
- Multi-task dependencies, retries, partial publication, merge, and QC
- Production caption/study publisher and exports
- Live control acknowledgements plus hosted reconnect, retention, and access policy
- Calibrated elapsed-time estimator, usage estimator, and versioned pricing adapter

## Collision and honesty rules

UI/UX changes must not:

- Remove or obscure the submitted-source recorded-preview notice
- Change `StudioPreviewSession.dataSource` away from `recorded_run` without a real producer path
- Attach submitted URL metadata to recorded run evidence
- Rename **Replay recorded analysis** to a live-sounding action
- Describe the owned-source **Start local runtime** action as caption/study/swarm production merely
  because it starts the bounded proof
- Make a changed range or option appear accepted when no matching artifact can be produced
- Display fixture values as measurements, expected time, price, usage, worker count, or progress
- Treat replay pause as runtime acknowledgement
- Treat a human workspace scrubber as an agent media operation
- Treat legacy spawn/report prose as production scheduler or handoff evidence
- Merge production journal events into `run-005`, `run-006`, `RunBundle`, or legacy traces
- Interpret empty music/speaker arrays as proof that detectors ran
- Turn null/unavailable scores, usage, prices, or timing into zero

The UIUX chat should avoid editing:

- `src/studio/runtime/production/`
- `scripts/run-local-worker.ts`
- Runtime launcher, scheduler, journal, authorization, artifact-store, media-host, report-host,
  observability, forecast, and memory implementation
- `bench/`, gold, freeze, scoring, or control-pack files

The architecture chat should avoid redesigning Studio chrome or changing visible interaction
semantics without updating this contract with the UIUX owner.

## Evidence map

| Claim | Primary evidence |
|---|---|
| Main Studio loads `run-006` | `src/pages/studio/index.astro` |
| Main Studio uses replay transport | `src/studio/StudioApp.tsx`, `src/studio/store.ts`, `src/studio/transport.ts` |
| Submitted source is recorded-preview-only | `src/studio/previewSession.ts`, `src/studio/StudioApp.tsx` |
| Product owned-source path, forecast/status regions, and production fact selectors | `src/studio/localRuntime/ProductLocalRuntime.tsx` |
| Browser-owned ingest composition and progress protocol | `src/studio/runtime/production/runtimeHost/ownedMediaIngest.ts`, `src/studio/localRuntime/client.ts` |
| Range and output controls | `src/studio/preflight/ConfirmationForm.tsx` |
| Changed ranges/options cannot replay | `src/studio/preflight/model.ts` |
| Replay and cancellation action semantics | `src/studio/store.ts`, `src/studio/Dock.tsx` |
| Recorded agent focus/workspaces | `src/studio/AgentPanel.tsx`, `src/studio/Workspace.tsx` |
| Recorded results/evidence/artifact links | `src/studio/Results.tsx`, `src/studio/evidence/` |
| Lab replay and contract fixtures | `src/studio/lab/Lab.tsx`, `src/studio/lab/scenarios.ts`, `src/studio/lab/preflightScenarios.ts` |
| Local real legacy clip pipeline | `scripts/run-clip.mjs` |
| Local bounded Codex child | `scripts/run-local-worker.ts`, `src/studio/runtime/production/launcher.ts` |
| Scheduler/journal/media/handoff fragments | `src/studio/runtime/production/` |
| Dedicated task/spawn/worker/grant/output-artifact/report adapter | `src/studio/runtime/production/studioProjection.ts` |
| Workload floor and unavailable estimates | `src/studio/runtime/production/forecast/`, `tests/studio-forecast-production.test.ts` |
| Local host lifecycle and public identities | `src/studio/runtime/production/runtimeHost/model.ts` |
| Local host endpoints, bearer authentication, and loopback binding | `src/studio/runtime/production/runtimeHost/httpServer.ts` |
| Shared host client, exact forecast validation, lifecycle projection, and cursor validation | `src/studio/localRuntime/`, `tests/studio-local-runtime-client.test.ts` |
| Local host implementation and absence boundary | `docs/STUDIO_AUTONOMY.md`, section **Local runtime-start host** |
| Deterministic host and guarded real-Codex commands | `package.json` (`runtime:host`, `runtime:host:codex`), `scripts/run-runtime-host.ts` |
| Production journal inspector boundary | `src/studio/runtime/production/ProductionRuntimeInspector.tsx` |
| Runtime/autonomy implementation ledger | `docs/STUDIO_AUTONOMY.md` |
