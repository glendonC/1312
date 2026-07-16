import { useState, type ReactNode } from "react";

import type { EvidenceAssessmentAudit } from "../runtime/production/assessmentAudit";
import type { EvidenceDecisionReceiptVerification } from "../runtime/production/decisionReceiptAudit";
import type { PublishReviewIntakeVerification } from "../runtime/production/publishReviewIntakeAudit";
import type { PublishReviewDecisionVerification } from "../runtime/production/publishReviewDecisionAudit";
import type { CaptionProductionVerification } from "../runtime/production/captionProductionAudit";
import type {
  RuntimeHostCaptionProductionRequest,
  RuntimeHostPublishReviewDecisionRequest,
  RuntimeHostPublishReviewOperator,
  RuntimeHostPublishReviewRevocationRequest,
} from "../runtime/production/runtimeHost/model";
import type {
  ProductionStudioGrantView,
  ProductionStudioProjection,
} from "../runtime/production/studioProjection";
import { seconds } from "./productLocalRuntimeShared";

type ProductionIdentityKind = "task" | "worker" | "operation" | "execution" | "artifact" | "receipt" | "report";

function productionIdentityTarget(kind: ProductionIdentityKind, identity: string): string {
  return `product-production-${kind}-${identity}`;
}

function ProductionIdentityLink({
  kind,
  identity,
  children,
}: {
  kind: ProductionIdentityKind;
  identity: string;
  children?: ReactNode;
}) {
  return (
    <a
      href={`#${productionIdentityTarget(kind, identity)}`}
      data-production-navigation={kind}
      data-production-target-id={identity}
    >
      {children ?? identity}
    </a>
  );
}

function ProductionArtifactReference({
  identity,
  renderedArtifactIds,
}: {
  identity: string;
  renderedArtifactIds: ReadonlySet<string>;
}) {
  return renderedArtifactIds.has(identity)
    ? <ProductionIdentityLink kind="artifact" identity={identity} />
    : <>{identity}</>;
}

function ProductionArtifactList({
  identities,
  renderedArtifactIds,
  empty,
}: {
  identities: readonly string[];
  renderedArtifactIds: ReadonlySet<string>;
  empty: string;
}) {
  if (identities.length === 0) return <>{empty}</>;
  return identities.map((identity, index) => (
    <span key={identity}>
      {index > 0 ? ", " : null}
      <ProductionArtifactReference identity={identity} renderedArtifactIds={renderedArtifactIds} />
    </span>
  ));
}

function ProductionScopeSummary({
  scopes,
  renderedArtifactIds,
}: {
  scopes: ProductionStudioGrantView["mediaScope"];
  renderedArtifactIds: ReadonlySet<string>;
}) {
  if (scopes.length === 0) return <>No media scope granted</>;
  return scopes.map((scope, index) => (
    <span key={`${scope.artifactId}:${scope.trackId}:${scope.startMs}:${scope.endMs}`}>
      {index > 0 ? "; " : null}
      <ProductionArtifactReference identity={scope.artifactId} renderedArtifactIds={renderedArtifactIds} />
      {` · ${scope.trackId} [${scope.startMs}, ${scope.endMs}) ms`}
    </span>
  ));
}

function ProductionEvidenceScopeSummary({
  scopes,
  renderedArtifactIds,
}: {
  scopes: ProductionStudioGrantView["evidenceScope"];
  renderedArtifactIds: ReadonlySet<string>;
}) {
  if (scopes.length === 0) return <>No evidence scope granted</>;
  return scopes.map((scope, index) => (
    <span key={`${scope.artifactId}:${scope.evidenceKind}`}>
      {index > 0 ? "; " : null}
      <ProductionArtifactReference identity={scope.artifactId} renderedArtifactIds={renderedArtifactIds} />
      {` · ${scope.evidenceKind} · ${scope.maxItems} items / ${scope.maxBytes} bytes`}
    </span>
  ));
}

function ProductionAssessmentScopeSummary({
  scope,
  renderedArtifactIds,
}: {
  scope: ProductionStudioGrantView["assessmentScope"];
  renderedArtifactIds: ReadonlySet<string>;
}) {
  if (!scope) return <>No assessment scope granted</>;
  return (
    <>
      <ProductionArtifactList
        identities={scope.evidenceArtifactIds}
        renderedArtifactIds={renderedArtifactIds}
        empty="No evidence artifacts"
      />
      {` · ${scope.maxAssessments} assessment / ${scope.maxReadReceipts} read receipts / ${scope.maxClaims} claims / ${scope.maxCitations} cited indexes / ${scope.maxTokens} structured tokens`}
    </>
  );
}

function ProductionDecisionScopeSummary({
  scope,
}: {
  scope: ProductionStudioGrantView["decisionScope"];
}) {
  if (!scope) return <>No decision scope granted</>;
  return <>{scope.maxDecisions} decision / {scope.maxAuditedAssessments} audited assessments</>;
}

const REVIEW_REJECTION_REASONS = [
  "evidence_requires_additional_review",
  "source_scope_not_approved",
  "rights_or_policy_concern",
  "other_review_concern",
] as const;

const REVIEW_REVOCATION_REASONS = [
  "approval_entered_in_error",
  "new_review_required",
  "source_scope_changed",
  "rights_or_policy_concern",
] as const;

function PublishReviewDecisionControl({
  intake,
  reviewer,
  busy,
  onDecision,
}: {
  intake: PublishReviewIntakeVerification;
  reviewer: RuntimeHostPublishReviewOperator;
  busy: boolean;
  onDecision: (request: RuntimeHostPublishReviewDecisionRequest) => Promise<void>;
}) {
  const [reason, setReason] = useState<(typeof REVIEW_REJECTION_REASONS)[number] | "">("");
  const [note, setNote] = useState("");
  const [attested, setAttested] = useState(false);
  const identity = {
    intakeId: intake.intakeId,
    artifactId: intake.artifactId,
    receiptId: intake.receiptId,
    receiptContentId: intake.receiptContentId,
  };
  const normalizedNote = note.trim() || null;

  return (
    <article
      data-production-review-control-intake-id={intake.intakeId}
      data-review-status="unreviewed"
    >
      <header><h5>Verified queued intake</h5><span>unreviewed</span></header>
      <dl>
        <div><dt>Intake</dt><dd>{intake.intakeId}</dd></div>
        <div><dt>Attested review operator</dt><dd>{reviewer.label} · {reviewer.id}</dd></div>
      </dl>
      <label>
        <span>Rejection reason code</span>
        <select
          value={reason}
          disabled={busy}
          data-production-review-rejection-reason
          onChange={(event) => setReason(event.currentTarget.value as typeof reason)}
        >
          <option value="">Select a required reason</option>
          {REVIEW_REJECTION_REASONS.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
      </label>
      <label>
        <span>Optional review note</span>
        <input
          type="text"
          value={note}
          maxLength={280}
          disabled={busy}
          data-production-review-note
          onChange={(event) => setNote(event.currentTarget.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={attested}
          disabled={busy}
          data-production-review-attestation
          onChange={(event) => setAttested(event.currentTarget.checked)}
        />
        <span>{reviewer.decisionAttestation}</span>
      </label>
      <div>
        <button
          type="button"
          disabled={busy || !attested}
          data-production-review-action="approve_for_caption_production"
          onClick={() => void onDecision({
            intake: identity,
            reviewer: { id: reviewer.id, attestation: reviewer.decisionAttestation },
            decision: {
              outcome: "approve_for_caption_production",
              reasonCodes: ["reviewer_attested_caption_production_may_proceed"],
              note: normalizedNote,
            },
          })}
        >
          Approve for caption production
        </button>
        <button
          type="button"
          disabled={busy || !attested || reason === ""}
          data-production-review-action="reject_with_reasons"
          onClick={() => {
            if (reason === "") return;
            void onDecision({
              intake: identity,
              reviewer: { id: reviewer.id, attestation: reviewer.decisionAttestation },
              decision: { outcome: "reject_with_reasons", reasonCodes: [reason], note: normalizedNote },
            });
          }}
        >
          Reject with reasons
        </button>
      </div>
      <p>
        Approval permits only the separate bounded caption producer to consume this receipt after
        another host verification. Approval itself creates no
        captions, upload, publication, media-truth, or English-correctness claim.
      </p>
    </article>
  );
}

function PublishReviewRevocationControl({
  review,
  reviewer,
  busy,
  onRevoke,
}: {
  review: PublishReviewDecisionVerification;
  reviewer: RuntimeHostPublishReviewOperator;
  busy: boolean;
  onRevoke: (request: RuntimeHostPublishReviewRevocationRequest) => Promise<void>;
}) {
  const [reason, setReason] = useState<(typeof REVIEW_REVOCATION_REASONS)[number] | "">("");
  const [note, setNote] = useState("");
  const [attested, setAttested] = useState(false);
  return (
    <div data-production-review-revocation-control={review.reviewId}>
      <label>
        <span>Revocation reason code</span>
        <select
          value={reason}
          disabled={busy}
          data-production-review-revocation-reason
          onChange={(event) => setReason(event.currentTarget.value as typeof reason)}
        >
          <option value="">Select a required reason</option>
          {REVIEW_REVOCATION_REASONS.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
      </label>
      <label>
        <span>Optional revocation note</span>
        <input
          type="text"
          value={note}
          maxLength={280}
          disabled={busy}
          data-production-review-revocation-note
          onChange={(event) => setNote(event.currentTarget.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={attested}
          disabled={busy}
          data-production-review-revocation-attestation
          onChange={(event) => setAttested(event.currentTarget.checked)}
        />
        <span>{reviewer.revocationAttestation}</span>
      </label>
      <button
        type="button"
        disabled={busy || !attested || reason === ""}
        data-production-review-action="revoke_approval"
        onClick={() => {
          if (reason === "") return;
          void onRevoke({
            approval: {
              reviewId: review.reviewId,
              artifactId: review.artifactId,
              receiptId: review.receiptId,
              receiptContentId: review.receiptContentId,
            },
            reviewer: { id: reviewer.id, attestation: reviewer.revocationAttestation },
            revocation: { reasonCodes: [reason], note: note.trim() || null },
          });
        }}
      >
        Revoke caption-production approval
      </button>
      <p>
        Revocation blocks every new caption start. Already completed immutable caption artifacts
        remain inspectable and are marked as produced before revocation; they are not silently deleted.
      </p>
    </div>
  );
}

export function ProductionJournalFacts({
  projection,
  assessmentAudits,
  decisionReceipts,
  publishReviewIntakes,
  publishReviewDecisions,
  captionProductions,
  reviewOperator,
  reviewBusy,
  reviewError,
  captionBusy,
  captionError,
  onPublishReviewDecision,
  onPublishReviewRevocation,
  onCaptionProduction,
}: {
  projection: ProductionStudioProjection;
  assessmentAudits: readonly EvidenceAssessmentAudit[];
  decisionReceipts: readonly EvidenceDecisionReceiptVerification[];
  publishReviewIntakes: readonly PublishReviewIntakeVerification[];
  publishReviewDecisions: readonly PublishReviewDecisionVerification[];
  captionProductions: readonly CaptionProductionVerification[];
  reviewOperator: RuntimeHostPublishReviewOperator | null;
  reviewBusy: boolean;
  reviewError: string | null;
  captionBusy: boolean;
  captionError: string | null;
  onPublishReviewDecision: (request: RuntimeHostPublishReviewDecisionRequest) => Promise<void>;
  onPublishReviewRevocation: (request: RuntimeHostPublishReviewRevocationRequest) => Promise<void>;
  onCaptionProduction: (request: RuntimeHostCaptionProductionRequest) => Promise<void>;
}) {
  const outputArtifactIds = new Set(projection.outputArtifacts.map((artifact) => artifact.artifactId));
  const renderedArtifactIds = new Set([
    ...projection.sourceArtifacts.map((artifact) => artifact.artifactId),
    ...projection.evidenceArtifacts.map((artifact) => artifact.artifactId),
    ...projection.assessmentArtifacts.map((artifact) => artifact.artifactId),
    ...projection.decisionArtifacts.map((artifact) => artifact.artifactId),
    ...projection.publishReviewIntakeArtifacts.map((artifact) => artifact.artifactId),
    ...projection.publishReviewDecisionArtifacts.map((artifact) => artifact.artifactId),
    ...projection.publishReviewRevocationArtifacts.map((artifact) => artifact.artifactId),
    ...projection.captionArtifacts.map((artifact) => artifact.artifactId),
    ...outputArtifactIds,
  ]);
  const operationIds = new Set([
    ...projection.operations.map((operation) => operation.operationId),
    ...projection.evidenceReads.map((operation) => operation.operationId),
    ...projection.evidenceAssessments.map((operation) => operation.operationId),
    ...projection.evidenceDecisions.map((operation) => operation.operationId),
  ]);
  const taskIds = new Set(projection.tasks.map((task) => task.taskId));
  const workerIds = new Set(projection.workers.map((worker) => worker.agentId));
  const readReceiptIds = new Set(projection.evidenceReads.flatMap((read) =>
    read.receiptId && read.status === "completed" ? [read.receiptId] : []));
  const visibleAssessmentAudits = assessmentAudits.filter((audit) =>
    projection.evidenceAssessments.some((assessment) =>
      assessment.operationId === audit.operationId &&
      assessment.status === "completed" &&
      assessment.outputArtifactId === audit.artifactId &&
      assessment.receiptId === audit.receiptId &&
      assessment.receiptContentId === audit.receiptContentId) &&
    renderedArtifactIds.has(audit.artifactId));
  const visibleDecisionReceipts = decisionReceipts.filter((receipt) =>
    projection.evidenceDecisions.some((decision) =>
      decision.operationId === receipt.operationId &&
      decision.status === "completed" &&
      decision.outputArtifactId === receipt.artifactId &&
      decision.receiptId === receipt.receiptId &&
      decision.receiptContentId === receipt.receiptContentId &&
      decision.outcome === receipt.outcome) &&
    renderedArtifactIds.has(receipt.artifactId));
  const visiblePublishReviewIntakes = publishReviewIntakes.filter((intake) =>
    projection.publishReviewIntakes.some((projected) =>
      projected.intakeId === intake.intakeId &&
      projected.status === "completed" &&
      projected.outputArtifactId === intake.artifactId &&
      projected.receiptId === intake.receiptId &&
      projected.receiptContentId === intake.receiptContentId &&
      projected.decisionOperationId === intake.decision.operationId &&
      projected.decisionArtifactId === intake.decision.artifactId &&
      projected.decisionReceiptId === intake.decision.receiptId &&
      projected.decisionReceiptContentId === intake.decision.receiptContentId &&
      projected.outcome === intake.outcome) &&
    renderedArtifactIds.has(intake.artifactId));
  const visiblePublishReviewDecisions = publishReviewDecisions.filter((review) =>
    projection.publishReviewDecisions.some((projected) =>
      projected.reviewId === review.reviewId &&
      projected.status === "completed" &&
      projected.outputArtifactId === review.artifactId &&
      projected.receiptId === review.receiptId &&
      projected.receiptContentId === review.receiptContentId &&
      projected.intakeId === review.intake.intakeId &&
      projected.intakeArtifactId === review.intake.artifactId &&
      projected.intakeReceiptId === review.intake.receiptId &&
      projected.intakeReceiptContentId === review.intake.receiptContentId &&
      projected.outcome === review.outcome) &&
    renderedArtifactIds.has(review.artifactId) &&
    visiblePublishReviewIntakes.some((intake) => intake.intakeId === review.intake.intakeId));
  const verifiedQueuedIntakes = visiblePublishReviewIntakes.filter((intake) => intake.outcome === "queued");
  const verifiedRejectedIntakes = visiblePublishReviewIntakes.filter((intake) => intake.outcome === "rejected");
  const unreviewedQueuedIntakes = verifiedQueuedIntakes.filter((intake) =>
    !visiblePublishReviewDecisions.some((review) => review.intake.intakeId === intake.intakeId));
  const hasUnverifiedQueuedProjection = projection.publishReviewIntakes.some((intake) =>
    intake.status === "completed" &&
    intake.outcome === "queued" &&
    !visiblePublishReviewIntakes.some((verified) => verified.intakeId === intake.intakeId));
  const visibleCaptionProductions = captionProductions.filter((caption) =>
    projection.captionProductions.some((job) =>
      job.jobId === caption.jobId &&
      job.status === "completed" &&
      job.approvalReviewId === caption.approval.reviewId &&
      job.captionArtifactId === caption.captionArtifactId &&
      job.captionContentId === caption.captionContentId &&
      job.receiptArtifactId === caption.receiptArtifactId &&
      job.receiptId === caption.receiptId &&
      job.receiptContentId === caption.receiptContentId) &&
    renderedArtifactIds.has(caption.captionArtifactId) &&
    renderedArtifactIds.has(caption.receiptArtifactId));
  const eligibleCaptionApprovals = visiblePublishReviewDecisions.filter((review) =>
    review.outcome === "approve_for_caption_production" &&
    review.state === "approved_for_caption_production" &&
    review.revocation === null &&
    !projection.captionProductions.some((job) => job.approvalReviewId === review.reviewId));
  const executionIds = new Set(
    projection.workers.flatMap((worker) => worker.execution ? [worker.execution.id] : []),
  );

  return (
    <section
      className="product-runtime-production"
      data-production-projection="journal"
      aria-labelledby="product-runtime-production-title"
    >
      <header>
        <span>Validated production adapter · never added to RunBundle</span>
        <h3 id="product-runtime-production-title">Production task and handoff facts</h3>
        <p>
          Latest validated journal facts, including source identity, scheduler decisions, and
          output lineage. They are recorded production evidence, not a presence signal, progress
          estimate, or replay topology.
        </p>
      </header>

      <section
        data-production-region="source-artifacts"
        aria-labelledby="product-runtime-source-artifacts-title"
      >
        <h4 id="product-runtime-source-artifacts-title">Source artifacts</h4>
        {projection.sourceArtifacts.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="source-artifacts">
            Unavailable until an ingest-origin <code>artifact.recorded</code> event is validated.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.sourceArtifacts.map((artifact) => (
              <article
                key={artifact.artifactId}
                id={productionIdentityTarget("artifact", artifact.artifactId)}
                data-production-source-artifact-id={artifact.artifactId}
              >
                <header><h5>{artifact.kind}</h5><span>{artifact.mediaClass}</span></header>
                <dl>
                  <div><dt>Artifact</dt><dd>{artifact.artifactId}</dd></div>
                  <div><dt>Content</dt><dd>{artifact.contentId} · {artifact.bytes} bytes</dd></div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{artifact.durationMs === null ? "Unavailable in the validated artifact" : `${artifact.durationMs} ms`}</dd>
                  </div>
                  <div><dt>Tracks</dt><dd>{artifact.trackCount}</dd></div>
                  <div><dt>Publication</dt><dd>{artifact.publication}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="evidence-artifacts"
        aria-labelledby="product-runtime-evidence-artifacts-title"
      >
        <h4 id="product-runtime-evidence-artifacts-title">Evidence artifacts</h4>
        {projection.evidenceArtifacts.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="evidence-artifacts">
            Unavailable when the owned preflight has no pinned speech or language evidence receipt.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.evidenceArtifacts.map((artifact) => (
              <article
                key={artifact.artifactId}
                id={productionIdentityTarget("artifact", artifact.artifactId)}
                data-production-evidence-artifact-id={artifact.artifactId}
                data-evidence-kind={artifact.evidenceKind}
              >
                <header><h5>{artifact.kind}</h5><span>{artifact.evidenceKind}</span></header>
                <dl>
                  <div><dt>Artifact</dt><dd>{artifact.artifactId}</dd></div>
                  <div><dt>Receipt schema</dt><dd>{artifact.receiptSchema}</dd></div>
                  <div><dt>Existing producer</dt><dd>{artifact.producerId}</dd></div>
                  <div><dt>Content</dt><dd>{artifact.contentId} · {artifact.bytes} bytes</dd></div>
                  <div><dt>Preflight</dt><dd>{artifact.preflightId}</dd></div>
                  <div><dt>Preflight content</dt><dd>{artifact.preflightContentId}</dd></div>
                  <div>
                    <dt>Source lineage</dt>
                    <dd>
                      <ProductionArtifactList
                        identities={artifact.sourceArtifactIds}
                        renderedArtifactIds={renderedArtifactIds}
                        empty="Unavailable"
                      />
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="product-runtime-tasks-title">
        <h4 id="product-runtime-tasks-title">Production tasks</h4>
        {projection.tasks.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="tasks">
            Unavailable until a <code>task.created</code> event is validated.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.tasks.map((task) => (
              <article
                key={task.taskId}
                id={productionIdentityTarget("task", task.taskId)}
                data-production-task-id={task.taskId}
                data-status={task.status}
              >
                <header><h5>{task.label}</h5><span>{task.status}</span></header>
                <p>{task.objective}</p>
                <dl>
                  <div><dt>Task</dt><dd>{task.taskId}</dd></div>
                  <div><dt>Assigned worker</dt><dd>{task.assignedAgentId}</dd></div>
                  <div><dt>Registered owner</dt><dd>{task.ownerAgentId ?? "Unavailable until agent registration"}</dd></div>
                  <div><dt>Parent task</dt><dd>{task.parentTaskId ?? "Root task"}</dd></div>
                  <div>
                    <dt>Input artifacts</dt>
                    <dd>
                      <ProductionArtifactList
                        identities={task.inputArtifactIds}
                        renderedArtifactIds={renderedArtifactIds}
                        empty="None in task contract"
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Media scope</dt>
                    <dd>
                      <ProductionScopeSummary
                        scopes={task.mediaScope}
                        renderedArtifactIds={renderedArtifactIds}
                      />
                    </dd>
                  </div>
                  <div><dt>Dependencies</dt><dd>{task.dependencies.join(", ") || "None in task contract"}</dd></div>
                  <div>
                    <dt>Required outputs</dt>
                    <dd>
                      {task.requiredOutputs.map((output) => (
                        `${output.name} · ${output.artifactKind} · ${output.required ? "required" : "optional"}`
                      )).join("; ") || "None in task contract"}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="spawn-requests"
        aria-labelledby="product-runtime-spawns-title"
      >
        <h4 id="product-runtime-spawns-title">Spawn requests and decisions</h4>
        {projection.spawnRequests.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="spawn-requests">
            Unavailable until a <code>spawn.requested</code> event is validated.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.spawnRequests.map((spawn) => {
              const decidedTarget = spawn.decision === "accepted"
                ? `${spawn.taskId} / ${spawn.agentId}`
                : spawn.decision === "rejected"
                  ? "Not created — request rejected"
                  : "Unavailable until spawn.decided is validated";
              const decisionReason = spawn.decision === "rejected"
                ? spawn.rejection
                : spawn.decision === "accepted"
                  ? "Not applicable — request accepted"
                  : "Unavailable until spawn.decided is validated";
              return (
                <article
                  key={spawn.requestId}
                  data-production-spawn-request-id={spawn.requestId}
                  data-decision={spawn.decision}
                >
                  <header><h5>{spawn.workerLabel}</h5><span>{spawn.decision}</span></header>
                  <p>{spawn.objective}</p>
                  <dl>
                    <div><dt>Request</dt><dd>{spawn.requestId}</dd></div>
                    <div><dt>Requested by</dt><dd>{spawn.requestedByTaskId} / {spawn.requestedByAgentId}</dd></div>
                    <div><dt>Requested worker kind</dt><dd>{spawn.workerKind}</dd></div>
                    <div><dt>Workload key</dt><dd>{spawn.workloadKey}</dd></div>
                    <div><dt>Requested capabilities</dt><dd>{spawn.requiredCapabilities.join(", ") || "None in request contract"}</dd></div>
                    <div>
                      <dt>Requested media scope</dt>
                      <dd>
                        <ProductionScopeSummary
                          scopes={spawn.mediaScope}
                          renderedArtifactIds={renderedArtifactIds}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Requested input artifacts</dt>
                      <dd>
                        <ProductionArtifactList
                          identities={spawn.inputArtifactIds}
                          renderedArtifactIds={renderedArtifactIds}
                          empty="None in request contract"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Required outputs</dt>
                      <dd>
                        {spawn.requiredOutputs.map((output) => (
                          `${output.name} · ${output.artifactKind} · ${output.required ? "required" : "optional"}`
                        )).join("; ") || "None in request contract"}
                      </dd>
                    </div>
                    <div><dt>Dependencies</dt><dd>{spawn.dependencies.join(", ") || "None in request contract"}</dd></div>
                    <div><dt>Decision target</dt><dd>{decidedTarget}</dd></div>
                    <div><dt>Decision reason</dt><dd>{decisionReason}</dd></div>
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="product-runtime-workers-title">
        <h4 id="product-runtime-workers-title">Registered workers</h4>
        {projection.workers.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="workers">
            Unavailable until an <code>agent.registered</code> event is validated.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.workers.map((worker) => (
              <article
                key={worker.agentId}
                id={productionIdentityTarget("worker", worker.agentId)}
                data-production-worker-id={worker.agentId}
                data-status={worker.status}
              >
                <header><h5>{worker.label}</h5><span>{worker.status}</span></header>
                <dl>
                  <div><dt>Worker</dt><dd>{worker.agentId}</dd></div>
                  <div><dt>Task</dt><dd>{worker.taskId}</dd></div>
                  <div><dt>Kind</dt><dd>{worker.kind}</dd></div>
                  <div><dt>Parent worker</dt><dd>{worker.parentAgentId ?? "Root worker"}</dd></div>
                  <div><dt>Journal task status</dt><dd>{worker.taskStatus}</dd></div>
                  {worker.execution ? (
                    <div>
                      <dt>Latest execution</dt>
                      <dd
                        id={productionIdentityTarget("execution", worker.execution.id)}
                        data-production-execution-id={worker.execution.id}
                      >
                        {worker.execution.id}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="product-runtime-grants-title">
        <h4 id="product-runtime-grants-title">Capability grants</h4>
        {projection.grants.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="grants">
            Unavailable until scheduler-issued grants are validated.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.grants.map((grant) => (
              <article key={grant.grantId} data-production-grant-id={grant.grantId}>
                <header><h5>{grant.capability}</h5></header>
                <dl>
                  <div><dt>Grant</dt><dd>{grant.grantId}</dd></div>
                  <div><dt>Task / worker</dt><dd>{grant.taskId} / {grant.agentId}</dd></div>
                  <div>
                    <dt>Enforced media scope</dt>
                    <dd>
                      <ProductionScopeSummary
                        scopes={grant.mediaScope}
                        renderedArtifactIds={renderedArtifactIds}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Enforced evidence scope</dt>
                    <dd>
                      <ProductionEvidenceScopeSummary
                        scopes={grant.evidenceScope}
                        renderedArtifactIds={renderedArtifactIds}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Enforced assessment scope</dt>
                    <dd>
                      <ProductionAssessmentScopeSummary
                        scope={grant.assessmentScope}
                        renderedArtifactIds={renderedArtifactIds}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Enforced decision scope</dt>
                    <dd><ProductionDecisionScopeSummary scope={grant.decisionScope} /></dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="evidence-reads"
        aria-labelledby="product-runtime-evidence-reads-title"
      >
        <h4 id="product-runtime-evidence-reads-title">Evidence reads</h4>
        {projection.evidenceReads.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="evidence-reads">
            Unavailable until an <code>evidence.read_started</code> event is validated. No read is
            inferred from an evidence artifact or grant.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.evidenceReads.map((read) => (
              <article
                key={read.operationId}
                id={productionIdentityTarget("operation", read.operationId)}
                data-production-evidence-read-id={read.operationId}
                data-evidence-kind={read.evidenceKind}
                data-status={read.status}
              >
                <header><h5>{read.capability}</h5><span>{read.status}</span></header>
                <dl>
                  <div><dt>Operation</dt><dd>{read.operationId}</dd></div>
                  <div><dt>Task / worker</dt><dd>{read.taskId} / {read.agentId}</dd></div>
                  <div><dt>Grant</dt><dd>{read.grantId}</dd></div>
                  <div>
                    <dt>Existing evidence artifact</dt>
                    <dd>
                      <ProductionArtifactReference
                        identity={read.inputArtifactId}
                        renderedArtifactIds={renderedArtifactIds}
                      />
                    </dd>
                  </div>
                  <div><dt>Evidence kind</dt><dd>{read.evidenceKind}</dd></div>
                  <div><dt>Hard bounds</dt><dd>{read.maxItems} items / {read.maxBytes} bytes</dd></div>
                  <div><dt>Returned</dt><dd>{read.returnedItems === null || read.returnedFactBytes === null ? "Unavailable until evidence.read_completed is validated" : `${read.returnedItems} items / ${read.returnedFactBytes} bytes`}</dd></div>
                  <div><dt>Truncated</dt><dd>{read.truncated === null ? "Unavailable until completion" : read.truncated ? "Yes" : "No"}</dd></div>
                  <div>
                    <dt>Receipt</dt>
                    <dd>
                      {read.receiptId ? (
                        <span
                          id={productionIdentityTarget("receipt", read.receiptId)}
                          data-production-read-receipt-id={read.receiptId}
                        >
                          {read.receiptId}
                        </span>
                      ) : "Unavailable until completion"}
                    </dd>
                  </div>
                  <div><dt>Receipt content</dt><dd>{read.receiptContentId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Failure</dt><dd>{read.failure ?? (read.status === "failed" ? "Failure reason unavailable" : "Not recorded")}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="evidence-assessments"
        aria-labelledby="product-runtime-evidence-assessments-title"
      >
        <h4 id="product-runtime-evidence-assessments-title">Evidence assessments</h4>
        {projection.evidenceAssessments.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="evidence-assessments">
            Unavailable until an <code>analysis.evidence.assessment_started</code> event is validated.
            No assessment is inferred from an evidence artifact, read, or worker output.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.evidenceAssessments.map((assessment) => (
              <article
                key={assessment.operationId}
                id={productionIdentityTarget("operation", assessment.operationId)}
                data-production-evidence-assessment-id={assessment.operationId}
                data-status={assessment.status}
              >
                <header><h5>{assessment.capability}</h5><span>{assessment.status}</span></header>
                <dl>
                  <div><dt>Operation</dt><dd>{assessment.operationId}</dd></div>
                  <div><dt>Task / worker</dt><dd>{assessment.taskId} / {assessment.agentId}</dd></div>
                  <div><dt>Grant</dt><dd>{assessment.grantId}</dd></div>
                  <div><dt>Completed read receipts</dt><dd>{assessment.readReceiptIds.join(", ")}</dd></div>
                  <div><dt>Read receipt content</dt><dd>{assessment.readReceiptContentIds.join(", ")}</dd></div>
                  <div><dt>Hard bounds</dt><dd>{assessment.maxReadReceipts} receipts / {assessment.maxClaims} claims / {assessment.maxCitations} cited indexes / {assessment.maxTokens} structured tokens</dd></div>
                  <div><dt>Used</dt><dd>{assessment.claimCount === null || assessment.citationCount === null || assessment.tokenCount === null ? "Unavailable until assessment completion" : `${assessment.claimCount} claims / ${assessment.citationCount} cited indexes / ${assessment.tokenCount} structured tokens`}</dd></div>
                  <div>
                    <dt>Assessment artifact</dt>
                    <dd>
                      {assessment.outputArtifactId ? (
                        <ProductionArtifactReference
                          identity={assessment.outputArtifactId}
                          renderedArtifactIds={renderedArtifactIds}
                        />
                      ) : "Unavailable until assessment completion"}
                    </dd>
                  </div>
                  <div><dt>Receipt</dt><dd>{assessment.receiptId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Receipt content</dt><dd>{assessment.receiptContentId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Failure</dt><dd>{assessment.failure ?? (assessment.status === "failed" ? "Failure reason unavailable" : "Not recorded")}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="assessment-artifacts"
        aria-labelledby="product-runtime-assessment-artifacts-title"
      >
        <h4 id="product-runtime-assessment-artifacts-title">Assessment artifacts</h4>
        {projection.assessmentArtifacts.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="assessment-artifacts">
            Unavailable until a completed bounded assessment records its content-addressed receipt artifact.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.assessmentArtifacts.map((artifact) => (
              <article
                key={artifact.artifactId}
                id={productionIdentityTarget("artifact", artifact.artifactId)}
                data-production-assessment-artifact-id={artifact.artifactId}
              >
                <header><h5>{artifact.kind}</h5><span>structured opinion</span></header>
                <dl>
                  <div><dt>Artifact</dt><dd>{artifact.artifactId}</dd></div>
                  <div>
                    <dt>Produced by</dt>
                    <dd>
                      <ProductionIdentityLink kind="task" identity={artifact.producerTaskId} />
                      {" / "}
                      <ProductionIdentityLink kind="worker" identity={artifact.producerAgentId} />
                    </dd>
                  </div>
                  <div>
                    <dt>Assessment operation</dt>
                    <dd>
                      {operationIds.has(artifact.operationId)
                        ? <ProductionIdentityLink kind="operation" identity={artifact.operationId} />
                        : artifact.operationId}
                    </dd>
                  </div>
                  <div><dt>Receipt</dt><dd>{artifact.receiptId}</dd></div>
                  <div><dt>Receipt content</dt><dd>{artifact.receiptContentId}</dd></div>
                  <div><dt>Content</dt><dd>{artifact.contentId} · {artifact.bytes} bytes</dd></div>
                  <div><dt>Input read receipts</dt><dd>{artifact.readReceiptIds.join(", ")}</dd></div>
                  <div><dt>Input receipt content</dt><dd>{artifact.readReceiptContentIds.join(", ")}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="assessment-receipt-audits"
        aria-labelledby="product-runtime-assessment-audits-title"
      >
        <h4 id="product-runtime-assessment-audits-title">Assessment receipt audit</h4>
        <p>
          This reopens stored assessment and cited read receipts, verifies their content identities
          and journal lineage, and preserves structured evidence states. It does not certify the
          assessment meaning or the truth of the media.
        </p>
        {visibleAssessmentAudits.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="assessment-receipt-audits">
            Unavailable until a completed assessment receipt is reopened and validated. Failed,
            absent, V1, or stored-content/lineage-mismatch paths remain unavailable.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {visibleAssessmentAudits.map((audit) => (
              <article
                key={audit.operationId}
                data-production-assessment-audit-id={audit.operationId}
                data-integrity={audit.integrity}
              >
                <header>
                  <h5>studio.evidence-assessment.receipt.v1</h5>
                  <span>integrity and citation closure verified</span>
                </header>
                <dl>
                  <div>
                    <dt>Assessment operation</dt>
                    <dd>
                      {operationIds.has(audit.operationId)
                        ? <ProductionIdentityLink kind="operation" identity={audit.operationId} />
                        : audit.operationId}
                    </dd>
                  </div>
                  <div>
                    <dt>Assessment artifact</dt>
                    <dd>
                      <ProductionArtifactReference
                        identity={audit.artifactId}
                        renderedArtifactIds={renderedArtifactIds}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Task / worker</dt>
                    <dd>
                      {taskIds.has(audit.taskId)
                        ? <ProductionIdentityLink kind="task" identity={audit.taskId} />
                        : audit.taskId}
                      {" / "}
                      {workerIds.has(audit.agentId)
                        ? <ProductionIdentityLink kind="worker" identity={audit.agentId} />
                        : audit.agentId}
                    </dd>
                  </div>
                  <div><dt>Receipt</dt><dd>{audit.receiptId}</dd></div>
                  <div><dt>Stored content</dt><dd>{audit.receiptContentId}</dd></div>
                  <div><dt>Validation</dt><dd>Stored bytes rehashed; assessment, read-receipt, citation, and journal lineage closed</dd></div>
                </dl>
                <div className="product-runtime-fact-list" data-production-assessment-claims={audit.claims.length}>
                  {audit.claims.map((claim) => (
                    <article
                      key={claim.claimIndex}
                      data-production-assessment-claim-index={claim.claimIndex}
                      data-claim-kind={claim.kind}
                      data-claim-states={claim.states.join(" ")}
                    >
                      <header>
                        <h5>Claim {claim.claimIndex + 1} · {claim.kind}</h5>
                        <span>{claim.states.join(" + ")}</span>
                      </header>
                      <dl>
                        <div><dt>Kind</dt><dd>{claim.kind}</dd></div>
                        <div><dt>Value</dt><dd>{claim.value ?? "Unavailable (null)"}</dd></div>
                        <div><dt>Exact range</dt><dd>[{claim.range.startMs}, {claim.range.endMs}) ms</dd></div>
                        <div><dt>Preserved states</dt><dd>{claim.states.join(", ")}</dd></div>
                      </dl>
                      <div data-production-assessment-citations={claim.citations.length}>
                        <h6>Cited returned facts</h6>
                        <ul>
                          {claim.citations.map((citation) => (
                            <li
                              key={`${citation.receiptId}:${citation.receiptContentId}`}
                              data-production-assessment-citation-receipt-id={citation.receiptId}
                            >
                              <dl>
                                <div>
                                  <dt>Read receipt</dt>
                                  <dd>
                                    {readReceiptIds.has(citation.receiptId)
                                      ? <ProductionIdentityLink kind="receipt" identity={citation.receiptId} />
                                      : citation.receiptId}
                                  </dd>
                                </div>
                                <div><dt>Receipt content</dt><dd>{citation.receiptContentId}</dd></div>
                                <div>
                                  <dt>Read operation</dt>
                                  <dd>
                                    {operationIds.has(citation.readOperationId)
                                      ? <ProductionIdentityLink kind="operation" identity={citation.readOperationId} />
                                      : citation.readOperationId}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Evidence artifact</dt>
                                  <dd>
                                    <ProductionArtifactReference
                                      identity={citation.evidenceArtifactId}
                                      renderedArtifactIds={renderedArtifactIds}
                                    />
                                  </dd>
                                </div>
                                <div><dt>Fact indexes</dt><dd>{citation.factIndexes.join(", ")}</dd></div>
                              </dl>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </article>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="evidence-decisions"
        aria-labelledby="product-runtime-evidence-decisions-title"
      >
        <h4 id="product-runtime-evidence-decisions-title">Evidence decisions</h4>
        <p>
          Journal facts for the deterministic gate over audited assessment identities. A completed
          decision is neither a caption nor a publication event.
        </p>
        {projection.evidenceDecisions.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="evidence-decisions">
            Unavailable until an <code>analysis.evidence.decision_started</code> event is validated.
            No decision is inferred from an assessment, audit response, grant, or worker report.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.evidenceDecisions.map((decision) => (
              <article
                key={decision.operationId}
                id={productionIdentityTarget("operation", decision.operationId)}
                data-production-evidence-decision-id={decision.operationId}
                data-status={decision.status}
                data-decision-outcome={decision.outcome ?? "unavailable"}
              >
                <header><h5>{decision.capability}</h5><span>{decision.status}</span></header>
                <dl>
                  <div><dt>Operation</dt><dd>{decision.operationId}</dd></div>
                  <div><dt>Task / worker</dt><dd>{decision.taskId} / {decision.agentId}</dd></div>
                  <div><dt>Grant</dt><dd>{decision.grantId}</dd></div>
                  <div><dt>Hard bound</dt><dd>{decision.maxAuditedAssessments} audited assessments</dd></div>
                  <div>
                    <dt>Assessment operations</dt>
                    <dd>
                      {decision.assessmentOperationIds.map((operationId, index) => (
                        <span key={operationId}>
                          {index > 0 ? ", " : null}
                          {operationIds.has(operationId)
                            ? <ProductionIdentityLink kind="operation" identity={operationId} />
                            : operationId}
                        </span>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt>Assessment artifacts</dt>
                    <dd>
                      <ProductionArtifactList
                        identities={decision.assessmentArtifactIds}
                        renderedArtifactIds={renderedArtifactIds}
                        empty="No audited assessment artifacts"
                      />
                    </dd>
                  </div>
                  <div><dt>Assessment receipts</dt><dd>{decision.assessmentReceiptIds.join(", ")}</dd></div>
                  <div><dt>Assessment receipt content</dt><dd>{decision.assessmentReceiptContentIds.join(", ")}</dd></div>
                  <div><dt>Outcome</dt><dd>{decision.outcome ?? "Unavailable until decision completion"}</dd></div>
                  <div><dt>Reason codes</dt><dd>{decision.reasonCodes.join(", ") || "Unavailable until decision completion"}</dd></div>
                  <div><dt>Audited claims</dt><dd>{decision.auditedClaimCount ?? "Unavailable until decision completion"}</dd></div>
                  <div>
                    <dt>Decision artifact</dt>
                    <dd>
                      {decision.outputArtifactId
                        ? <ProductionArtifactReference identity={decision.outputArtifactId} renderedArtifactIds={renderedArtifactIds} />
                        : "Unavailable until decision completion"}
                    </dd>
                  </div>
                  <div><dt>Receipt</dt><dd>{decision.receiptId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Receipt content</dt><dd>{decision.receiptContentId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Failure</dt><dd>{decision.failure ?? (decision.status === "failed" ? "Failure reason unavailable" : "Not recorded")}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="decision-artifacts"
        aria-labelledby="product-runtime-decision-artifacts-title"
      >
        <h4 id="product-runtime-decision-artifacts-title">Decision artifacts</h4>
        {projection.decisionArtifacts.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="decision-artifacts">
            Unavailable until a completed audited decision records its private content-addressed receipt artifact.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.decisionArtifacts.map((artifact) => (
              <article
                key={artifact.artifactId}
                id={productionIdentityTarget("artifact", artifact.artifactId)}
                data-production-decision-artifact-id={artifact.artifactId}
              >
                <header><h5>{artifact.kind}</h5><span>deterministic audit-state gate</span></header>
                <dl>
                  <div><dt>Artifact</dt><dd>{artifact.artifactId}</dd></div>
                  <div>
                    <dt>Produced by</dt>
                    <dd>
                      {taskIds.has(artifact.producerTaskId)
                        ? <ProductionIdentityLink kind="task" identity={artifact.producerTaskId} />
                        : artifact.producerTaskId}
                      {" / "}
                      {workerIds.has(artifact.producerAgentId)
                        ? <ProductionIdentityLink kind="worker" identity={artifact.producerAgentId} />
                        : artifact.producerAgentId}
                    </dd>
                  </div>
                  <div>
                    <dt>Decision operation</dt>
                    <dd>
                      {operationIds.has(artifact.operationId)
                        ? <ProductionIdentityLink kind="operation" identity={artifact.operationId} />
                        : artifact.operationId}
                    </dd>
                  </div>
                  <div><dt>Receipt</dt><dd>{artifact.receiptId}</dd></div>
                  <div><dt>Receipt content</dt><dd>{artifact.receiptContentId}</dd></div>
                  <div><dt>Content</dt><dd>{artifact.contentId} · {artifact.bytes} bytes</dd></div>
                  <div>
                    <dt>Audited assessment artifacts</dt>
                    <dd>
                      <ProductionArtifactList
                        identities={artifact.assessmentArtifactIds}
                        renderedArtifactIds={renderedArtifactIds}
                        empty="No audited assessment artifacts"
                      />
                    </dd>
                  </div>
                  <div><dt>Assessment operations</dt><dd>{artifact.assessmentOperationIds.join(", ")}</dd></div>
                  <div><dt>Assessment receipts</dt><dd>{artifact.assessmentReceiptIds.join(", ")}</dd></div>
                  <div><dt>Assessment receipt content</dt><dd>{artifact.assessmentReceiptContentIds.join(", ")}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="decision-receipts"
        aria-labelledby="product-runtime-decision-receipts-title"
      >
        <h4 id="product-runtime-decision-receipts-title">Publish-review decision receipts</h4>
        <p>
          The host reopens the stored decision and every assessment/read receipt, re-runs citation
          closure, and derives the same deterministic outcome. <code>proceed_to_publish_review</code>
          permits only host intake to an unreviewed queue; it does not mean captions exist or anything was published.
        </p>
        {visibleDecisionReceipts.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="decision-receipts">
            Unavailable until a completed decision receipt and all audited assessment lineage are
            reopened and verified. V1, absent, failed, skipped, or tampered paths remain unavailable.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {visibleDecisionReceipts.map((decision) => (
              <article
                key={decision.operationId}
                data-production-decision-receipt-id={decision.operationId}
                data-integrity={decision.integrity}
                data-decision-outcome={decision.outcome}
                data-decision-producer={decision.producer}
              >
                <header>
                  <h5>studio.evidence-decision.receipt.v1</h5>
                  <span>{decision.outcome}</span>
                </header>
                <dl>
                  <div>
                    <dt>Decision operation</dt>
                    <dd>
                      {operationIds.has(decision.operationId)
                        ? <ProductionIdentityLink kind="operation" identity={decision.operationId} />
                        : decision.operationId}
                    </dd>
                  </div>
                  <div>
                    <dt>Decision artifact</dt>
                    <dd><ProductionArtifactReference identity={decision.artifactId} renderedArtifactIds={renderedArtifactIds} /></dd>
                  </div>
                  <div><dt>Receipt</dt><dd>{decision.receiptId}</dd></div>
                  <div><dt>Stored content</dt><dd>{decision.receiptContentId}</dd></div>
                  <div><dt>Executor</dt><dd>{decision.producer}</dd></div>
                  <div><dt>Outcome</dt><dd>{decision.outcome}</dd></div>
                  <div>
                    <dt>Reason codes</dt>
                    <dd>
                      {decision.reasonCodes.map((reason, index) => (
                        <span key={reason} data-production-decision-reason-code={reason}>
                          {index > 0 ? ", " : null}{reason}
                        </span>
                      ))}
                    </dd>
                  </div>
                  <div><dt>Audited inputs</dt><dd>{decision.auditedAssessmentCount} assessments / {decision.auditedClaimCount} claims</dd></div>
                  <div><dt>Validation</dt><dd>Decision bytes rehashed; assessment audits and deterministic outcome re-derived</dd></div>
                </dl>
                <ul data-production-decision-inputs={decision.inputs.length}>
                  {decision.inputs.map((input) => (
                    <li key={input.operationId} data-production-decision-input-operation-id={input.operationId}>
                      {operationIds.has(input.operationId)
                        ? <ProductionIdentityLink kind="operation" identity={input.operationId} />
                        : input.operationId}
                      {" · "}
                      <ProductionArtifactReference identity={input.artifactId} renderedArtifactIds={renderedArtifactIds} />
                      {` · ${input.receiptId} · ${input.receiptContentId}`}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="publish-review-intakes"
        aria-labelledby="product-runtime-publish-review-intakes-title"
      >
        <h4 id="product-runtime-publish-review-intakes-title">Publish-review intake lineage</h4>
        <p>
          Host-produced queue or rejection lineage over one verified decision receipt. Queued means
          awaiting review only; it does not mean reviewed, captioned, uploaded, published, or public.
        </p>
        {projection.publishReviewIntakes.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="publish-review-intakes">
            Unavailable until the host verifies a completed decision receipt and records a closed
            publish-review intake. V1 and absent, failed, or tampered decision paths stay unavailable.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.publishReviewIntakes.map((intake) => (
              <article
                key={intake.intakeId}
                id={`product-production-intake-${intake.intakeId}`}
                data-production-publish-review-intake-id={intake.intakeId}
                data-status={intake.status}
                data-intake-outcome={intake.outcome ?? "unavailable"}
              >
                <header><h5>studio.publish-review-intake.receipt.v1</h5><span>{intake.outcome ?? intake.status}</span></header>
                <dl>
                  <div><dt>Intake</dt><dd>{intake.intakeId}</dd></div>
                  <div>
                    <dt>Verified decision operation</dt>
                    <dd>
                      {operationIds.has(intake.decisionOperationId)
                        ? <ProductionIdentityLink kind="operation" identity={intake.decisionOperationId} />
                        : intake.decisionOperationId}
                    </dd>
                  </div>
                  <div>
                    <dt>Verified decision artifact</dt>
                    <dd><ProductionArtifactReference identity={intake.decisionArtifactId} renderedArtifactIds={renderedArtifactIds} /></dd>
                  </div>
                  <div><dt>Verified decision receipt</dt><dd>{intake.decisionReceiptId}</dd></div>
                  <div><dt>Decision receipt content</dt><dd>{intake.decisionReceiptContentId}</dd></div>
                  <div><dt>Outcome</dt><dd>{intake.outcome ?? "Unavailable until intake completion"}</dd></div>
                  <div>
                    <dt>Decision reason codes</dt>
                    <dd>
                      {intake.reasonCodes.length === 0
                        ? "Unavailable until intake completion"
                        : intake.reasonCodes.map((reason, index) => (
                          <span key={reason} data-production-intake-reason-code={reason}>
                            {index > 0 ? ", " : null}{reason}
                          </span>
                        ))}
                    </dd>
                  </div>
                  <div>
                    <dt>Intake artifact</dt>
                    <dd>
                      {intake.outputArtifactId
                        ? <ProductionArtifactReference identity={intake.outputArtifactId} renderedArtifactIds={renderedArtifactIds} />
                        : "Unavailable until intake completion"}
                    </dd>
                  </div>
                  <div><dt>Receipt</dt><dd>{intake.receiptId ?? "Unavailable until intake completion"}</dd></div>
                  <div><dt>Receipt content</dt><dd>{intake.receiptContentId ?? "Unavailable until intake completion"}</dd></div>
                  <div><dt>Failure</dt><dd>{intake.failure ?? (intake.status === "failed" ? "Failure reason unavailable" : "Not recorded")}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="publish-review-intake-artifacts"
        aria-labelledby="product-runtime-publish-review-intake-artifacts-title"
      >
        <h4 id="product-runtime-publish-review-intake-artifacts-title">Publish-review intake artifacts</h4>
        {projection.publishReviewIntakeArtifacts.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="publish-review-intake-artifacts">
            Unavailable until a completed intake records its private content-addressed receipt artifact.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.publishReviewIntakeArtifacts.map((artifact) => (
              <article
                key={artifact.artifactId}
                id={productionIdentityTarget("artifact", artifact.artifactId)}
                data-production-publish-review-intake-artifact-id={artifact.artifactId}
              >
                <header><h5>{artifact.kind}</h5><span>private intake receipt</span></header>
                <dl>
                  <div><dt>Artifact</dt><dd>{artifact.artifactId}</dd></div>
                  <div><dt>Content</dt><dd>{artifact.contentId} · {artifact.bytes} bytes</dd></div>
                  <div><dt>Intake</dt><dd>{artifact.intakeId}</dd></div>
                  <div><dt>Receipt</dt><dd>{artifact.receiptId}</dd></div>
                  <div><dt>Receipt content</dt><dd>{artifact.receiptContentId}</dd></div>
                  <div>
                    <dt>Decision operation</dt>
                    <dd>
                      {operationIds.has(artifact.decisionOperationId)
                        ? <ProductionIdentityLink kind="operation" identity={artifact.decisionOperationId} />
                        : artifact.decisionOperationId}
                    </dd>
                  </div>
                  <div>
                    <dt>Decision artifact</dt>
                    <dd><ProductionArtifactReference identity={artifact.decisionArtifactId} renderedArtifactIds={renderedArtifactIds} /></dd>
                  </div>
                  <div><dt>Decision receipt</dt><dd>{artifact.decisionReceiptId}</dd></div>
                  <div><dt>Decision receipt content</dt><dd>{artifact.decisionReceiptContentId}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="publish-review-intake-receipts"
        aria-labelledby="product-runtime-publish-review-intake-receipts-title"
      >
        <h4 id="product-runtime-publish-review-intake-receipts-title">Verified publish-review intake receipts</h4>
        <p>
          The host reopens the intake, decision, assessment, and read receipts before returning this
          view. Rejected decision reasons remain visible; queued remains unreviewed and unpublished.
        </p>
        {visiblePublishReviewIntakes.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="publish-review-intake-receipts">
            Unavailable until stored intake bytes and the complete verified decision lineage agree.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {visiblePublishReviewIntakes.map((intake) => (
              <article
                key={intake.intakeId}
                data-production-publish-review-intake-receipt-id={intake.intakeId}
                data-integrity={intake.integrity}
                data-intake-outcome={intake.outcome}
                data-intake-producer={intake.producer}
              >
                <header><h5>studio.publish-review-intake.receipt.v1</h5><span>{intake.outcome}</span></header>
                <dl>
                  <div><dt>Intake</dt><dd>{intake.intakeId}</dd></div>
                  <div>
                    <dt>Intake artifact</dt>
                    <dd><ProductionArtifactReference identity={intake.artifactId} renderedArtifactIds={renderedArtifactIds} /></dd>
                  </div>
                  <div><dt>Receipt</dt><dd>{intake.receiptId}</dd></div>
                  <div><dt>Stored content</dt><dd>{intake.receiptContentId}</dd></div>
                  <div><dt>Executor</dt><dd>{intake.producer}</dd></div>
                  <div><dt>Outcome</dt><dd>{intake.outcome}</dd></div>
                  <div>
                    <dt>Reason codes</dt>
                    <dd>
                      {intake.reasonCodes.map((reason, index) => (
                        <span key={reason} data-production-verified-intake-reason-code={reason}>
                          {index > 0 ? ", " : null}{reason}
                        </span>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt>Decision operation</dt>
                    <dd>
                      {operationIds.has(intake.decision.operationId)
                        ? <ProductionIdentityLink kind="operation" identity={intake.decision.operationId} />
                        : intake.decision.operationId}
                    </dd>
                  </div>
                  <div>
                    <dt>Decision artifact</dt>
                    <dd><ProductionArtifactReference identity={intake.decision.artifactId} renderedArtifactIds={renderedArtifactIds} /></dd>
                  </div>
                  <div><dt>Decision receipt</dt><dd>{intake.decision.receiptId}</dd></div>
                  <div><dt>Decision receipt content</dt><dd>{intake.decision.receiptContentId}</dd></div>
                  <div><dt>Validation</dt><dd>Intake bytes rehashed; decision and all audited inputs reverified</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="publish-review-human-review"
        aria-labelledby="product-runtime-publish-review-human-review-title"
      >
        <h4 id="product-runtime-publish-review-human-review-title">Queued intake human review</h4>
        <p>
          One host-configured, attested operator may review only a fully verified queued intake.
          The resulting receipt is separate and immutable. A queued intake remains unreviewed until
          that receipt exists.
        </p>
        {reviewError ? <p role="alert" data-production-review-error>{reviewError}</p> : null}
        {hasUnverifiedQueuedProjection ? (
          <p className="product-runtime-unavailable" data-production-review-empty="unverified">
            A queued journal intake is not reviewable because its stored receipt and complete
            decision lineage are not currently host-verified.
          </p>
        ) : null}
        {projection.publishReviewIntakes.length === 0 && visiblePublishReviewIntakes.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-review-empty="v1-or-absent">
            No publish-review intake exists. V1 and runtimes without a completed verified decision
            have no review controls.
          </p>
        ) : null}
        {verifiedRejectedIntakes.length > 0 && verifiedQueuedIntakes.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-review-empty="rejected-intake">
            The verified intake was rejected before queue admission. Its reasons remain visible;
            it cannot be human-approved without a new queued intake.
          </p>
        ) : null}
        {verifiedQueuedIntakes.length > 0 && unreviewedQueuedIntakes.length === 0 ? (
          <p data-production-review-empty="no-pending-intake">
            Every verified queued intake already has an immutable review decision receipt.
          </p>
        ) : null}
        {unreviewedQueuedIntakes.length > 0 && reviewOperator === null ? (
          <p className="product-runtime-unavailable" data-production-review-empty="reviewer-unavailable">
            The host review operator identity is unavailable, so no review action is enabled.
          </p>
        ) : null}
        {reviewOperator && unreviewedQueuedIntakes.length > 0 ? (
          <div className="product-runtime-fact-list">
            {unreviewedQueuedIntakes.map((intake) => (
              <PublishReviewDecisionControl
                key={intake.intakeId}
                intake={intake}
                reviewer={reviewOperator}
                busy={reviewBusy}
                onDecision={onPublishReviewDecision}
              />
            ))}
          </div>
        ) : null}
      </section>

      <section
        data-production-region="publish-review-decision-lineage"
        aria-labelledby="product-runtime-publish-review-decision-lineage-title"
      >
        <h4 id="product-runtime-publish-review-decision-lineage-title">Publish-review decision lineage</h4>
        {projection.publishReviewDecisions.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="publish-review-decision-lineage">
            No started, completed, or failed human review decision is recorded.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.publishReviewDecisions.map((review) => (
              <article
                key={review.reviewId}
                data-production-publish-review-decision-id={review.reviewId}
                data-status={review.status}
                data-review-outcome={review.outcome ?? "unavailable"}
              >
                <header><h5>studio.publish-review-decision.receipt.v1</h5><span>{review.outcome ?? review.status}</span></header>
                <dl>
                  <div><dt>Review</dt><dd>{review.reviewId}</dd></div>
                  <div><dt>Queued intake</dt><dd>{review.intakeId}</dd></div>
                  <div><dt>Reviewer</dt><dd>{review.reviewerLabel} · {review.reviewerId}</dd></div>
                  <div><dt>Outcome</dt><dd>{review.outcome ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Reason codes</dt><dd>{review.reasonCodes.join(", ") || "Unavailable until completion"}</dd></div>
                  <div><dt>Optional note</dt><dd>{review.note ?? "Not recorded"}</dd></div>
                  <div><dt>Receipt</dt><dd>{review.receiptId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Receipt content</dt><dd>{review.receiptContentId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Failure</dt><dd>{review.failure ?? (review.status === "failed" ? "Failure reason unavailable" : "Not recorded")}</dd></div>
                </dl>
              </article>
            ))}
            {projection.publishReviewRevocations.map((revocation) => (
              <article
                key={revocation.revocationId}
                data-production-publish-review-revocation-id={revocation.revocationId}
                data-status={revocation.status}
              >
                <header><h5>studio.publish-review-revocation.receipt.v1</h5><span>{revocation.status}</span></header>
                <dl>
                  <div><dt>Revocation</dt><dd>{revocation.revocationId}</dd></div>
                  <div><dt>Superseded approval</dt><dd>{revocation.reviewId}</dd></div>
                  <div><dt>Reviewer</dt><dd>{revocation.reviewerLabel} · {revocation.reviewerId}</dd></div>
                  <div><dt>Reason codes</dt><dd>{revocation.reasonCodes.join(", ") || "Unavailable until completion"}</dd></div>
                  <div><dt>Optional note</dt><dd>{revocation.note ?? "Not recorded"}</dd></div>
                  <div><dt>Receipt</dt><dd>{revocation.receiptId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Receipt content</dt><dd>{revocation.receiptContentId ?? "Unavailable until completion"}</dd></div>
                  <div><dt>Failure</dt><dd>{revocation.failure ?? (revocation.status === "failed" ? "Failure reason unavailable" : "Not recorded")}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="publish-review-receipt-artifacts"
        aria-labelledby="product-runtime-publish-review-receipt-artifacts-title"
      >
        <h4 id="product-runtime-publish-review-receipt-artifacts-title">Publish-review receipt artifacts</h4>
        {projection.publishReviewDecisionArtifacts.length === 0 && projection.publishReviewRevocationArtifacts.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="publish-review-receipt-artifacts">
            No completed private review decision or revocation receipt artifact exists.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.publishReviewDecisionArtifacts.map((artifact) => (
              <article
                key={artifact.artifactId}
                id={productionIdentityTarget("artifact", artifact.artifactId)}
                data-production-publish-review-decision-artifact-id={artifact.artifactId}
              >
                <header><h5>{artifact.kind}</h5><span>private review receipt</span></header>
                <dl>
                  <div><dt>Artifact</dt><dd>{artifact.artifactId}</dd></div>
                  <div><dt>Content</dt><dd>{artifact.contentId} · {artifact.bytes} bytes</dd></div>
                  <div><dt>Review</dt><dd>{artifact.reviewId}</dd></div>
                  <div><dt>Verified intake</dt><dd>{artifact.intakeId}</dd></div>
                  <div><dt>Receipt</dt><dd>{artifact.receiptId}</dd></div>
                  <div><dt>Receipt content</dt><dd>{artifact.receiptContentId}</dd></div>
                </dl>
              </article>
            ))}
            {projection.publishReviewRevocationArtifacts.map((artifact) => (
              <article
                key={artifact.artifactId}
                id={productionIdentityTarget("artifact", artifact.artifactId)}
                data-production-publish-review-revocation-artifact-id={artifact.artifactId}
              >
                <header><h5>{artifact.kind}</h5><span>private revocation receipt</span></header>
                <dl>
                  <div><dt>Artifact</dt><dd>{artifact.artifactId}</dd></div>
                  <div><dt>Content</dt><dd>{artifact.contentId} · {artifact.bytes} bytes</dd></div>
                  <div><dt>Revocation</dt><dd>{artifact.revocationId}</dd></div>
                  <div><dt>Superseded approval</dt><dd>{artifact.reviewId}</dd></div>
                  <div><dt>Receipt</dt><dd>{artifact.receiptId}</dd></div>
                  <div><dt>Receipt content</dt><dd>{artifact.receiptContentId}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="publish-review-decision-receipts"
        aria-labelledby="product-runtime-publish-review-decision-receipts-title"
      >
        <h4 id="product-runtime-publish-review-decision-receipts-title">Verified human review receipts</h4>
        <p>
          The host reopens each review and optional revocation receipt, then repeats intake,
          decision, assessment, and read verification. Approval means only that the separate caption
          producer may consume this review receipt after another host verification. It creates no captions, upload, publication,
          media-truth, or English-correctness claim.
        </p>
        {visiblePublishReviewDecisions.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="publish-review-decision-receipts">
            No completed human review receipt passes the full stored-lineage verification path.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {visiblePublishReviewDecisions.map((review) => {
              const visibleRevocation = review.revocation && projection.publishReviewRevocations.some((projected) =>
                projected.revocationId === review.revocation?.revocationId &&
                projected.status === "completed" &&
                projected.outputArtifactId === review.revocation.artifactId &&
                projected.receiptId === review.revocation.receiptId &&
                projected.receiptContentId === review.revocation.receiptContentId) &&
                renderedArtifactIds.has(review.revocation.artifactId)
                ? review.revocation
                : null;
              const visibleState = visibleRevocation ? "approval_revoked" : review.state;
              return (
                <article
                  key={review.reviewId}
                  data-production-publish-review-decision-receipt-id={review.reviewId}
                  data-integrity={review.integrity}
                  data-review-outcome={review.outcome}
                  data-review-state={visibleState}
                  data-reviewer-id={review.reviewer.id}
                >
                  <header><h5>studio.publish-review-decision.receipt.v1</h5><span>{visibleState}</span></header>
                  <dl>
                    <div><dt>Review</dt><dd>{review.reviewId}</dd></div>
                    <div><dt>Receipt</dt><dd>{review.receiptId}</dd></div>
                    <div><dt>Stored content</dt><dd>{review.receiptContentId}</dd></div>
                    <div><dt>Reviewer</dt><dd>{review.reviewer.label} · {review.reviewer.id}</dd></div>
                    <div><dt>Attestation</dt><dd>{review.reviewer.attestation}</dd></div>
                    <div><dt>Outcome</dt><dd>{review.outcome}</dd></div>
                    <div>
                      <dt>Reason codes</dt>
                      <dd>{review.reasonCodes.map((reason, index) => (
                        <span key={reason} data-production-review-reason-code={reason}>
                          {index > 0 ? ", " : null}{reason}
                        </span>
                      ))}</dd>
                    </div>
                    <div><dt>Optional note</dt><dd>{review.note ?? "Not recorded"}</dd></div>
                    <div><dt>Verified queued intake</dt><dd>{review.intake.intakeId}</dd></div>
                    <div><dt>Validation</dt><dd>Review bytes rehashed; intake and complete decision lineage reverified</dd></div>
                  </dl>
                  {visibleRevocation ? (
                    <div
                      data-production-publish-review-revocation-receipt-id={visibleRevocation.revocationId}
                      data-integrity={visibleRevocation.integrity}
                    >
                      <h6>Approval revocation receipt</h6>
                      <dl>
                        <div><dt>Revocation</dt><dd>{visibleRevocation.revocationId}</dd></div>
                        <div><dt>Receipt</dt><dd>{visibleRevocation.receiptId}</dd></div>
                        <div><dt>Stored content</dt><dd>{visibleRevocation.receiptContentId}</dd></div>
                        <div><dt>Reviewer</dt><dd>{visibleRevocation.reviewer.label} · {visibleRevocation.reviewer.id}</dd></div>
                        <div><dt>Attestation</dt><dd>{visibleRevocation.reviewer.attestation}</dd></div>
                        <div>
                          <dt>Reason codes</dt>
                          <dd>{visibleRevocation.reasonCodes.map((reason, index) => (
                            <span key={reason} data-production-review-revocation-reason-code={reason}>
                              {index > 0 ? ", " : null}{reason}
                            </span>
                          ))}</dd>
                        </div>
                        <div><dt>Optional note</dt><dd>{visibleRevocation.note ?? "Not recorded"}</dd></div>
                      </dl>
                    </div>
                  ) : review.outcome === "approve_for_caption_production" && reviewOperator ? (
                    <PublishReviewRevocationControl
                      review={review}
                      reviewer={reviewOperator}
                      busy={reviewBusy}
                      onRevoke={onPublishReviewRevocation}
                    />
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section
        data-production-region="caption-production"
        aria-labelledby="product-runtime-caption-production-title"
      >
        <h4 id="product-runtime-caption-production-title">Caption production</h4>
        <p>
          This is a separate private KO + EN production authority. The host accepts only an exact,
          recursively verified, unrevoked approval identity and derives the media, range, and producer
          inputs itself. Coverage counts do not claim transcription or English quality. Withheld and
          unavailable lines remain first-class.
        </p>
        {captionError ? <p role="alert" data-production-caption-error>{captionError}</p> : null}
        {eligibleCaptionApprovals.map((review) => (
          <article key={review.reviewId} data-production-caption-approval-id={review.reviewId}>
            <header><h5>Eligible approval</h5><span>not captioned</span></header>
            <dl>
              <div><dt>Review</dt><dd>{review.reviewId}</dd></div>
              <div><dt>Approval receipt</dt><dd>{review.receiptId}</dd></div>
              <div><dt>Approval content</dt><dd>{review.receiptContentId}</dd></div>
            </dl>
            <button
              type="button"
              disabled={captionBusy || reviewBusy}
              data-production-caption-action="start"
              onClick={() => void onCaptionProduction({
                approval: {
                  reviewId: review.reviewId,
                  artifactId: review.artifactId,
                  receiptId: review.receiptId,
                  receiptContentId: review.receiptContentId,
                },
              })}
            >
              {captionBusy ? "Producing bounded captions…" : "Start bounded caption production"}
            </button>
            <p>Creates private artifacts only. It does not upload or publish.</p>
          </article>
        ))}
        {eligibleCaptionApprovals.length === 0 && projection.captionProductions.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-caption-empty="no-eligible-approval">
            No exact unrevoked caption-production approval is currently eligible. Review alone never
            implies that captions exist.
          </p>
        ) : null}
        {projection.captionProductions.length > 0 ? (
          <div className="product-runtime-fact-list">
            {projection.captionProductions.map((job) => {
              const verified = visibleCaptionProductions.find((caption) => caption.jobId === job.jobId) ?? null;
              return (
                <article
                  key={job.jobId}
                  data-production-caption-job-id={job.jobId}
                  data-status={job.status}
                  data-caption-authority-state={verified?.authorityState ?? "unverified_or_incomplete"}
                >
                  <header><h5>studio.caption-production.receipt.v1</h5><span>{verified?.result.status ?? job.status}</span></header>
                  <dl>
                    <div><dt>Job</dt><dd>{job.jobId}</dd></div>
                    <div><dt>Approval</dt><dd>{job.approvalReviewId}</dd></div>
                    <div><dt>Approved range</dt><dd>{seconds(job.range.startMs)}–{seconds(job.range.endMs)}</dd></div>
                    <div><dt>Executor classification</dt><dd>{job.executorClassification}</dd></div>
                    <div><dt>Authority now</dt><dd>{verified?.authorityState ?? "Unavailable until full completion audit"}</dd></div>
                    <div><dt>Lines</dt><dd data-production-caption-line-count>{verified?.result.lineCount ?? "Unavailable until completion"}</dd></div>
                    <div><dt>Source available</dt><dd>{verified?.result.sourceAvailableCount ?? "Unavailable until completion"}</dd></div>
                    <div><dt>Target available</dt><dd>{verified?.result.targetAvailableCount ?? "Unavailable until completion"}</dd></div>
                    <div><dt>Withheld</dt><dd data-production-caption-withheld-count>{verified?.result.withheldCount ?? "Unavailable until completion"}</dd></div>
                    <div><dt>Unavailable</dt><dd data-production-caption-unavailable-count>{verified?.result.unavailableCount ?? "Unavailable until completion"}</dd></div>
                    <div><dt>Caption artifact</dt><dd>{verified?.captionArtifactId ?? "Unavailable until completion audit"}</dd></div>
                    <div><dt>Caption content</dt><dd>{verified?.captionContentId ?? "Unavailable until completion audit"}</dd></div>
                    <div><dt>Receipt artifact</dt><dd>{verified?.receiptArtifactId ?? "Unavailable until completion audit"}</dd></div>
                    <div><dt>Receipt content</dt><dd>{verified?.receiptContentId ?? "Unavailable until completion audit"}</dd></div>
                    <div><dt>Failure</dt><dd>{job.failure ?? "Not recorded"}</dd></div>
                  </dl>
                </article>
              );
            })}
          </div>
        ) : null}
        {projection.captionArtifacts.length > 0 ? (
          <div className="product-runtime-fact-list">
            {projection.captionArtifacts.map((artifact) => (
              <article
                key={artifact.artifactId}
                id={productionIdentityTarget("artifact", artifact.artifactId)}
                data-production-caption-artifact-id={artifact.artifactId}
                data-caption-artifact-role={artifact.role}
              >
                <header><h5>{artifact.kind}</h5><span>private · immutable</span></header>
                <dl>
                  <div><dt>Artifact</dt><dd>{artifact.artifactId}</dd></div>
                  <div><dt>Content</dt><dd>{artifact.contentId} · {artifact.bytes} bytes</dd></div>
                  <div><dt>Job</dt><dd>{artifact.jobId}</dd></div>
                  <div><dt>Approval</dt><dd>{artifact.approvalReviewId}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        ) : null}
        <p data-production-caption-publish-boundary>
          Upload, CDN delivery, and public publication are absent and require a later separate authority.
        </p>
      </section>

      <section
        data-production-region="operations"
        aria-labelledby="product-runtime-operations-title"
      >
        <h4 id="product-runtime-operations-title">Production operations</h4>
        {projection.operations.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="operations">
            Unavailable until a <code>media.operation_started</code> event is validated. No
            operation is inferred from a plan, grant, or worker claim.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.operations.map((operation) => (
              <article
                key={operation.operationId}
                id={productionIdentityTarget("operation", operation.operationId)}
                data-production-operation-id={operation.operationId}
                data-status={operation.status}
              >
                <header><h5>{operation.capability}</h5><span>{operation.status}</span></header>
                <dl>
                  <div><dt>Operation</dt><dd>{operation.operationId}</dd></div>
                  <div><dt>Task / worker</dt><dd>{operation.taskId} / {operation.agentId}</dd></div>
                  <div><dt>Grant</dt><dd>{operation.grantId}</dd></div>
                  <div>
                    <dt>Input artifact</dt>
                    <dd>
                      <ProductionArtifactReference
                        identity={operation.inputArtifactId}
                        renderedArtifactIds={renderedArtifactIds}
                      />
                    </dd>
                  </div>
                  <div><dt>Track</dt><dd>{operation.trackId}</dd></div>
                  <div><dt>Requested range</dt><dd>[{operation.startMs}, {operation.endMs}) ms · {operation.requestedDurationMs} ms</dd></div>
                  <div>
                    <dt>Output artifact</dt>
                    <dd>
                      {operation.outputArtifactId ? (
                        <ProductionArtifactReference
                          identity={operation.outputArtifactId}
                          renderedArtifactIds={renderedArtifactIds}
                        />
                      ) : "Unavailable until media.operation_completed is validated"}
                    </dd>
                  </div>
                  <div><dt>Receipt</dt><dd>{operation.receiptId ?? "Unavailable until media.operation_completed is validated"}</dd></div>
                  <div><dt>Failure</dt><dd>{operation.failure ?? (operation.status === "failed" ? "Failure reason unavailable" : "Not recorded")}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        data-production-region="output-artifacts"
        aria-labelledby="product-runtime-output-artifacts-title"
      >
        <h4 id="product-runtime-output-artifacts-title">Output artifact lineage</h4>
        {projection.outputArtifacts.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="output-artifacts">
            Unavailable until an output-producing <code>artifact.recorded</code> event is validated.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.outputArtifacts.map((artifact) => {
              const originIdentity = artifact.origin.kind === "worker_output"
                ? `Execution ${artifact.origin.executionId}`
                : `Operation ${artifact.origin.operationId}`;
              return (
                <article
                  key={artifact.artifactId}
                  id={productionIdentityTarget("artifact", artifact.artifactId)}
                  data-production-output-artifact-id={artifact.artifactId}
                  data-origin-kind={artifact.origin.kind}
                >
                  <header><h5>{artifact.kind}</h5><span>{artifact.mediaClass}</span></header>
                  <dl>
                    <div><dt>Artifact</dt><dd>{artifact.artifactId}</dd></div>
                    <div>
                      <dt>Produced by</dt>
                      <dd>
                        <ProductionIdentityLink kind="task" identity={artifact.producerTaskId} />
                        {" / "}
                        <ProductionIdentityLink kind="worker" identity={artifact.producerAgentId} />
                      </dd>
                    </div>
                    <div>
                      <dt>Origin</dt>
                      <dd>
                        {artifact.origin.kind} · {artifact.origin.kind === "worker_output" && executionIds.has(artifact.origin.executionId) ? (
                          <ProductionIdentityLink kind="execution" identity={artifact.origin.executionId}>{originIdentity}</ProductionIdentityLink>
                        ) : artifact.origin.kind !== "worker_output" && operationIds.has(artifact.origin.operationId) ? (
                          <ProductionIdentityLink kind="operation" identity={artifact.origin.operationId}>{originIdentity}</ProductionIdentityLink>
                        ) : originIdentity}
                      </dd>
                    </div>
                    <div><dt>Receipt</dt><dd>{artifact.origin.receiptId}</dd></div>
                    <div><dt>Receipt content</dt><dd>{artifact.origin.receiptContentId}</dd></div>
                    <div><dt>Content</dt><dd>{artifact.contentId} · {artifact.bytes} bytes</dd></div>
                    <div>
                      <dt>Upstream artifacts</dt>
                      <dd>
                        <ProductionArtifactList
                          identities={artifact.sourceArtifactIds}
                          renderedArtifactIds={renderedArtifactIds}
                          empty="No upstream artifact ids recorded"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Report references</dt>
                      <dd>
                        {artifact.reportIds.length === 0
                          ? "No validated report references"
                          : artifact.reportIds.map((reportId, index) => (
                            <span key={reportId}>
                              {index > 0 ? ", " : null}
                              <ProductionIdentityLink kind="report" identity={reportId} />
                            </span>
                          ))}
                      </dd>
                    </div>
                    <div><dt>Publication</dt><dd>{artifact.publication}</dd></div>
                    <div><dt>Duration</dt><dd>{artifact.durationMs === null ? "Not applicable for this artifact" : `${artifact.durationMs} ms`}</dd></div>
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="product-runtime-reports-title">
        <h4 id="product-runtime-reports-title">Structured reports</h4>
        {projection.reports.length === 0 ? (
          <p className="product-runtime-unavailable" data-production-empty="reports">
            Unavailable until a <code>report.submitted</code> event is validated.
          </p>
        ) : (
          <div className="product-runtime-fact-list">
            {projection.reports.map((report) => (
              <article
                key={report.reportId}
                id={productionIdentityTarget("report", report.reportId)}
                data-production-report-id={report.reportId}
                data-status={report.status}
              >
                <header><h5>{report.reportId}</h5><span>{report.status}</span></header>
                <p>{report.summary}</p>
                <dl>
                  <div><dt>Reporter</dt><dd>{report.taskId} / {report.agentId}</dd></div>
                  <div><dt>Reports to</dt><dd>{report.parentTaskId} / {report.parentAgentId}</dd></div>
                  <div>
                    <dt>Output artifacts</dt>
                    <dd>
                      <ProductionArtifactList
                        identities={report.outputArtifactIds}
                        renderedArtifactIds={renderedArtifactIds}
                        empty="No output artifact ids recorded"
                      />
                    </dd>
                  </div>
                  <div><dt>Decision reason</dt><dd>{report.decisionReason ?? "Unavailable until report.decided is validated"}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
