# Bounded runtime contract proposal

Status: production-inert typed proposal with exact development fixtures. A separate production
runtime protocol now exists; these fixture shapes remain disconnected.

These original proposal contracts predate the production implementation and remain deliberately
inert. Consequently these contracts:

- are not part of `RunBundle`, `Trace`, `RunState`, `applyTrace`, or either transport;
- cannot appear in the normal Studio UI;
- are exercised only by `src/studio/lab/runtimeFixtures.ts`;
- are rejected by the fixture validator unless `fixtureOnly` is true and the fixture says it is not
  runtime evidence.

## Separate production implementation

`src/studio/runtime/production/` is a new, independently versioned protocol and implementation. It
does not import this proposal or its `fixtureOnly` events. Its current real producers are:

- an append-only NDJSON event journal and pure replay projection;
- a bounded scheduler that derives task ids, depth, parentage, ownership, grants, and reservations;
- a dynamic registry that registers only a scheduler-issued launch permit;
- a content-addressed artifact store with closed ingest and media-operation origins;
- a capability host that performs one real, scoped ffmpeg audio-range extraction and receipts it;
- a structured handoff host that validates required child output and parent-only acceptance.

The exact runtime test executes that path against the receipted run-005 media and reopens the event
journal to prove replay equivalence. It also rejects fixture-only input, provider-field leakage,
duplicate work, limit violations, scope escalation, invalid registration, source-byte drift,
unauthorized media calls, and invalid handoffs.

This does not make the Studio live. No production Codex worker launcher, hosted runtime service,
production-event-to-UI adapter, or live control acknowledgement producer exists. Only
`media.extract` and structured report-up are implemented production capabilities; the other media
operations and detector/model calls in this proposal remain unavailable. The tables below continue
to document the fixture contract itself and should not be read as the production wire schema.

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
