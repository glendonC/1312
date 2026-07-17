# Owned-media swarm depth checklist v2

Decision: **ACCEPT after this challenge-pass revision as the definitive owned-path swarm-depth
campaign plan.**

Audit baseline: `1e98fd9` on 2026-07-16. Execute in dependency order and finish one slice before
starting the next. Provider, UI, and eval work may extend the named seams; they must not weaken the
receipts or promote replay evidence into this path.

## Campaign exit contract

When all five slices are complete, one owned-source run can launch a model-executed root with an
immutable job context; let that root request, receive scheduler decisions for, and await multiple
bounded workers; let workers create current-run timed semantic evidence and coverage-complete study
reports; admit only accepted artifacts to the parent; let the root request follow-up work or
synthesize a private evidence-linked study; and produce captions only from a human-approved,
synthesis-causal path. The complete graph must replay from the production journal and fail closed on
stored-content or lineage drift.

That is a believable agent-directed multi-worker study path. It is not proof of media truth,
transcription or translation quality, unlimited autonomy, publication, or swarm completeness for
every media class.

## Delta from v1

- Real: bounded scheduler and grants, dynamic registration, one real range-bound audio-activity
  observation, bounded reads of pinned VAD/language evidence, one structured child report, one
  content-addressed root disposition, current-run caption lineage, independent structural caption
  QC, and a production-only coordination projection.
- Missing: a model-executed root, immutable job context on tasks, worker-callable delegation and
  report waiting, more than one executing child, current-run semantic evidence, coverage-bearing
  reports, parent-readable artifact admission, gap-directed follow-up, model-authored synthesis, a
  synthesis-level readiness gate, and captions/review causally bound to that synthesis. The owned
  path is still deterministic host composition.

## 1. Durable agent-directed orchestration kernel

- [x] Status: complete.
- Real: the scheduler already accepts an authorized active parent and enforces depth, active-worker,
  duplicate-owner, scope, capability, dependency, output-contract, and run-budget policy. It records
  explicit spawn decisions, and the production projection renders them. The launcher receipts one
  bounded Codex child and the host has one durable run-launch claim.
- Missing: the root is not model-executed; `LanguageJobContext` and the exact analysis request are not
  scheduler task context; no worker bridge exposes `task.spawn.request`; the launcher rejects that
  grant; accepted child tasks have no per-task durable launch claim; a parent cannot fan out, wait for
  report identities, or continue its turn; the application host authors and synchronously launches
  the sole child under root-plus-one limits.
- Done when:
  - A versioned immutable task job-context identity carries the source artifact/content, analysis
    request/range, requested source-language policy, target language, selected pack, output depth,
    and detector-evidence identities. Children receive only scheduler-validated inherited or
    attenuated context; prompt prose cannot mutate it.
  - A model-executed orchestrator receives only closed `task_spawn_request` and `task_reports_wait`
    tools under exact grants. Spawn accepts a bounded child contract but no task/agent/grant ids;
    wait returns only terminal child task/report/artifact identities and closed failure states.
  - The root can issue at least two requests before waiting. Each accepted task receives one durable
    per-task launch claim and at most one executor; accepted children may run concurrently within
    scheduler limits. Rejected and deliberate no-request decisions remain journal evidence.
  - Parent `working`/`waiting_for_children`/terminal transitions, child launch, report availability,
    and executor causation are reconstructable from a cold journal replay. Restart before/after
    request, decision, claim, executor start, and report cannot duplicate a child or invent a report;
    ambiguous parent execution becomes explicit `interrupted`, not silently resumed.
  - The validated production projection exposes job-context identity, parent/child/task edges,
    requests and decisions, per-task launch/executor state, waiting state, and terminal report/failure
    identities without converting them into replay agents or requiring UI-authored inference.
  - Contract tests cover accepted fan-out, no-request, rejection, partial child failure, depth,
    concurrency, duplicate, dependency, scope, capability, budget, forged requester, repeat wait,
    and every restart boundary. One guarded real-Codex proof must record a root executor receipt,
    explicitly configured model identity, measured usage receipt, and at least one root-authored
    spawn tool call; deterministic/fake seams alone do not establish model-directed planning.
- Non-goals: semantic media understanding, child-output acceptance, synthesis, captions, transparent
  resumption of an interrupted model turn, unrestricted recursion, peer chat, UI work, or calling one
  successful fan-out a complete autonomous swarm.
- Fake-claim risk: relabelling host-authored child templates, scheduler acceptance, fake/deterministic
  executors, or worker count as model planning. The host may validate and launch a model-authored
  request; it must not choose the decomposition and then attribute that choice to the model.

## 2. Current-run semantic perception evidence

- [x] Status: complete.
- Real: source bytes and exact ranges are content-bound; `media.seek` proves only audio activity;
  VAD and language receipts are readable under exact task windows; a separate caption executor
  contains a current-run recognizer seam.
- Missing: there is no scheduler-granted, child-visible semantic media capability and no private
  current-run timed transcript hypothesis that a worker can cite. The caption executor is not a
  reusable child evidence producer.
- Done when:
  - One closed `speech.transcribe` capability re-hashes the owned source, consumes only one granted
    track and half-open range, runs a current-run recognizer, and emits a private content-addressed
    `studio.semantic-media-evidence.v1` artifact plus receipt. The first closed observation kind is
    `timed_transcript_hypothesis`; the envelope is versioned so later acoustic, overlap, speaker, OCR,
    or visual producers can be added without changing orchestration/report/synthesis authority.
  - The receipt binds source/artifact/content, exact requested and returned ranges, normalization,
    producer/model/runtime/configuration, timed segment ids/text/states, byte and segment ceilings,
    executor identity, and unavailable/empty/unknown/truncated outcomes. It exposes no path and makes
    no accuracy or understanding claim.
  - A path-free child bridge returns only the stored artifact/receipt identities and bounded timed
    observations. The child output envelope carries a closed semantic-evidence input list with exact
    observation ids and ranges; at least two delegated workers can consume disjoint or overlapping
    authorized ranges in the same run. Free-text mention of an identity is not a citation.
  - Authenticated reopening re-hashes source, artifact, and receipt and closes every timed observation
    against journal/grant/executor lineage. Tests cover current-run success, empty/unavailable output,
    model failure, timeout, range escape, source-byte drift, wrong track/grant/task, excessive output,
    duplicate operation, non-canonical/tampered storage, and fixture reuse refusal.
  - The production projection exposes operation, producer/executor, source/range, artifact/receipt,
    observation-count, and closed availability identities; it does not project a semantic finding
    when the audited artifact is absent or invalid.
- Non-goals: transcript truth or quality scoring, speaker identity, diarization, acoustic or overlap
  classification, source separation, translation quality, captions, public results, or publication.
- Fake-claim risk: treating decode success, `signal`, VAD, language ID, recognizer hypotheses, fluent
  text, or multiple workers reading the same evidence as hearing, understanding, agreement, or truth.

## 3. Coverage-aware report-up and parent artifact admission

- [x] Status: complete.
- Real: a child can submit artifacts only from its own task; required output kinds and executor
  lineage are checked; the owning parent alone accepts or rejects a report; one root-only host can
  disposition one free-text worker output.
- Missing: worker output is free-text content with no source lineage; reports contain only artifact
  ids plus summary prose; they do not partition scope or cite semantic observations; promotion is
  root-only and does not grant the parent bounded read access to accepted child content.
- Done when:
  - A typed `studio.study-report.v1` artifact partitions the entire assigned media scope into ordered,
    non-overlapping `supported`, `withheld`, `unknown`, or `failed` ranges. Every supported claim cites
    exact semantic evidence artifact/receipt/content and observation ids; every other range has a
    closed reason. Coverage is derived from the partition, never submitted as an authoritative
    percentage.
  - Report submission binds the task job context, required output slot, full coverage partition,
    claim/citation counts, output content, source artifacts, executor receipt, and exact parent edge.
    The parent records an immutable accept/reject disposition for each reported artifact.
  - Acceptance creates a content-addressed parent-admission receipt and a least-privilege
    `artifact.read` grant scoped to exact accepted content ids and hard byte/item ceilings. Rejection
    grants nothing and remains visible. The parent reads admitted structured artifacts through a
    path-free tool; artifact ids in prompt prose are not readable authority.
  - Recursive audit closes report → study artifact → semantic observations → source/grant/executor
    and parent disposition/admission. Tests reject uncovered gaps, overlaps, range escape, unsupported
    or cross-run citations, free-text-only claims, wrong output slot/parent, forged acceptance,
    rejected-artifact reads, byte/count overflow, duplicate disposition, and every stored-byte or
    journal mutation.
  - The production projection exposes the derived coverage partition/counts, citations,
    accept/reject disposition, admission/read grant, and explicit absent/failed states without
    deriving coverage from card count or prose.
- Non-goals: equating coverage with correctness, forcing supported coverage, model synthesis,
  follow-up policy, semantic quality judgment, captions, UI percentages, or publication.
- Fake-claim risk: treating artifact count, report acceptance, supported-range percentage, citation
  closure, or parent readability as correctness, complete study, or evidence that the parent agreed.

## 4. Gap-directed planning and model-authored study synthesis

- [x] Status: complete.
- Real: the scheduler already accepts completed dependencies; the parent can decide reports; v1 can
  promote one child output; evidence assessment/audit shows how to separate model opinion from a
  deterministic integrity gate.
- Missing: no executing parent reads multiple accepted reports, records a post-report plan decision,
  requests targeted follow-up from explicit gaps/conflicts, or creates a root-owned study. The current
  publish-review decision is downstream of one child assessment, not a synthesized study.
- Done when:
  - After reading at least two admitted study reports, the model root records a closed, receipted
    planning decision over their exact coverage/conflict identities: `request_follow_up`,
    `synthesize_with_gaps`, or `withhold`. Follow-up requests must name the cited gap/conflict, remain
    within the root scope/context/budget, and re-enter slices 1–3; the host validates but does not
    choose the decision.
  - A model root that chooses synthesis emits one private content-addressed
    `studio.owned-media-study.v1` artifact and executor receipt. It contains the immutable job context,
    complete root coverage partition, range-bound claims with semantic observation and child-report
    citations, accepted/rejected/failed child dispositions, conflicts and limitations, and exact
    follow-up history. It cannot turn an uncovered or unresolved range into `supported`.
  - A separate deterministic study audit reopens every source/evidence/report/admission/planning/
    executor identity and emits a structural readiness receipt: `proceed_to_caption_review` or
    `withheld` with closed gap/integrity reasons and no quality score. Publish-review intake and human
    approval are rebound to this exact study-readiness identity; a child decision alone can no longer
    authorize final caption review.
  - Cold replay derives one terminal root outcome and the same study/readiness identities. Tests cover
    useful follow-up, budget/depth rejection, no-follow-up-with-explicit-gaps, conflicting children,
    partial child failure, rejected inputs, unsupported synthesized claims, hidden gaps, duplicate
    synthesis, model timeout, receipt/content tamper, and attempts to queue review from a child-only
    decision. One guarded real-Codex run must close model root fan-out → reports → planning decision →
    synthesis; fixture or host-concatenated prose cannot satisfy this acceptance case.
  - The production projection exposes planning-decision inputs/outcome, follow-up causation, study
    identity/coverage/conflicts, and audited readiness/reasons so later UI work consumes facts rather
    than reconstructing a swarm narrative.
- Non-goals: hidden chain-of-thought, all-to-all debate, automatic truth arbitration, translation
  quality, caption generation, public Results, upload, publication, or guaranteeing that more workers
  improve the answer.
- Fake-claim risk: calling host concatenation, a deterministic disposition, citation integrity,
  conflict listing, or structural readiness model synthesis, semantic correctness, or quality.

## 5. Study-causal captions and independent structural QC

- [x] Status: complete.
- Real: caption production already requires one verified same-run promoted child output; every line
  retains source/child/promotion lineage; current-run structural QC is independent; every executor
  declares `cognitionClaim: none`; recorded fixture output is always withheld.
- Missing: caption approval and production are not bound to a root study/readiness receipt; the host
  requires exactly one child promotion; lines do not cite the study coverage/evidence graph; study
  gaps cannot directly force caption withholding.
- Done when:
  - Caption production accepts only one exact human approval over a recursively verified
    `proceed_to_caption_review` study-readiness receipt. It consumes the matching immutable study and
    current-run source; child-only review, fixture reuse, a different study, and revoked approval fail
    closed.
  - Every timed line closes source → current-run semantic observations → coverage-bearing child
    reports → parent admissions/dispositions → root study claim/coverage → readiness → approval →
    caption executor. A line may be available only inside `supported` study coverage with matching
    citations; `withheld`, `unknown`, `failed`, conflict, or uncovered ranges remain null with closed
    reasons.
  - Caption and QC authenticated reads recursively reopen the entire graph and retain executor scope,
    source/content/range, line counts, and authority/revocation state. Independent QC remains a
    deterministic structural accept/withhold receipt without a score or semantic language judgment.
  - The production projection exposes exact study/readiness/approval/caption/QC causation and
    per-line supported/withheld identities while keeping replay Results and publication state absent.
  - Tests cover current-run success, partial study coverage, unresolved conflict, withheld/unknown/
    failed range, citation mismatch, child/study/readiness/approval/caption/QC tamper, duplicate job or
    QC, revoke-before/during/after completion, executor timeout/failure, and recorded-fixture refusal.
    One full owned-run test closes root plan → multiple children → semantic evidence → coverage reports
    → admissions → study/readiness → approval → current-run captions → QC under cold replay.
- Non-goals: semantic caption or translation-quality judgment, a score, Results/replay identity,
  study/caption export, upload, CDN, publication, Bet G work, UI polish, or claiming QC acceptance as
  publish readiness.
- Fake-claim risk: treating causal lineage, supported coverage, complete line availability, human
  approval, or structural QC acceptance as transcription accuracy, translation quality, public
  availability, or swarm completeness.

## Explicit deferrals after this campaign

- Additional semantic producers—music/noise, diarization/overlap, source separation, OCR, frames, and
  visual context. They are important difficult-media depth, but they extend slice 2's versioned
  evidence union and slices 3–4's generic citation/coverage contracts; they do not require a new
  orchestration plan. Until implemented, their findings remain unavailable and affected ranges may
  be withheld.
- Semantic transcription/translation evaluation, independent model judging, calibration, and Bet G
  scoring. Bet G remains the eval north star, but eval evidence cannot establish runtime planning or
  swarm completeness and must remain a separate campaign.
- Transparent continuation of an interrupted model turn, cross-host distributed scheduling, elastic
  workers, and unlimited recursion. This campaign requires durable no-duplication plus explicit
  interruption; seamless continuation is operational resilience, not required for the local
  agent-directed study claim.
- Hosted/link ingest, accounts, remote execution, retention/access policy, live pause/resume/cancel
  acknowledgement, and multi-run persistence. These are service/control-plane product contracts,
  orthogonal to whether the owned local runtime can plan and synthesize through real workers.
- Production topology/workspace UI, Results integration, exports, upload, CDN, and publication.
  UI may catch up from validated production projections; private study/caption artifacts confer no
  public authority.
- Memory promotion and learning from the study. Existing proposal/decision/materialization rules
  remain separate so one uncertain run cannot silently become cross-run truth.

## Binding non-claims

- Deterministic host composition is not model-driven planning.
- `signal`, `digital_silence`, VAD, and language ID are not transcription or understanding.
- Recognizer hypotheses are not ground truth.
- Coverage and citation closure are not accuracy.
- QC acceptance is not translation quality.
- `ReplayTransport` and `run-006` agents are not the owned-path swarm.
- A Bet G score is not swarm completeness.

## Recommended first implementation

Implement slice 1 only: the durable agent-directed orchestration kernel. It is intentionally larger
than a spawn-tool micro-proof because the parent must be model-executed, issue multiple bounded
requests, survive the wait/report lifecycle without duplicate launches, and leave real model-backed
evidence before later slices can honestly claim compounding multi-worker intelligence. Stop before
semantic perception, artifact admission, synthesis, captions, Results, or UI work.
