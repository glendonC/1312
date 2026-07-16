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
- a content-addressed artifact store with closed ingest, preflight-evidence, and media-operation origins;
- a capability host that performs real, scoped ffmpeg audio-range extraction and bounded audio seek
  observation, with content-addressed receipts and source lineage;
- a task-private child bridge that publishes only scheduler-granted `media_extract`/`media_seek`,
  accepts no caller paths or operation ids, and delegates authorization, budget, source, range,
  journal, artifact, and receipt authority to that capability host;
- an `evidence.read` host plus separate task-private bridge that publishes only `evidence_read`,
  accepts only an exact scheduler-granted artifact id, injects task/agent/operation identity, and
  returns bounded facts from already-validated pinned VAD/language receipts with original lineage;
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
`media_seek`, `evidence_read`, `evidence_assess`, and/or `evidence_decide` only for matching live task grants, in addition to the closed
structured report output. `evidence.read` is not a detector call: it reads registered, immutable
V2/V3 receipt artifacts under per-artifact 32 KiB/64-fact ceilings and the shared task tool-call
budget. `analysis.evidence.assess` adds a separate 1-assessment/4-receipt/8-claim/32-cited-index/
512-structured-token ceiling and requires exact fact indexes and bounding ranges. V1 and absent
receipts produce none of those grants. `analysis.evidence.decide` adds a separate one-decision/four-
audited-assessment ceiling and lets the host, not the caller, derive outcome/reasons. `media.extract`,
`media.seek`, `evidence.read`, `analysis.evidence.assess`, and `analysis.evidence.decide` are real
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
