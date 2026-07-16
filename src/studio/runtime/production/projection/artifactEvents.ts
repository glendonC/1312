import type { RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { invariant } from "./shared.ts";

export function applyArtifactEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "artifact.recorded") {
    const artifact = event.data.artifact;
    const isAtomicParentReceipt =
      (artifact.origin.kind === "parent_admission" || artifact.origin.kind === "parent_artifact_disposition") &&
      event.producer.kind === "admission_host";
    invariant(event.producer.kind === "artifact_store" || isAtomicParentReceipt, event, "artifact evidence must come from its bounded storage or admission host");
    invariant(artifact.runId === next.runId, event, `artifact ${artifact.id} belongs to another run`);
    invariant(!next.artifacts[artifact.id], event, `artifact ${artifact.id} is duplicated`);
    invariant(artifact.sourceArtifactIds.every((id) => Boolean(next.artifacts[id])), event, `artifact ${artifact.id} has missing lineage`);
    if (artifact.origin.kind === "media_operation" || artifact.origin.kind === "media_observation") {
      const operation = next.operations[artifact.origin.operationId];
      invariant(operation?.status === "started", event, `artifact ${artifact.id} has no active media operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `artifact ${artifact.id} changed its operation producer`);
      invariant(artifact.sourceArtifactIds.includes(operation.artifactId), event, `artifact ${artifact.id} omits its operation input`);
      invariant(
        (operation.capability === "media.extract" && artifact.origin.kind === "media_operation") ||
          (operation.capability === "media.seek" && artifact.origin.kind === "media_observation"),
        event,
        `artifact ${artifact.id} has the wrong origin for ${operation.capability}`,
      );
    } else if (artifact.origin.kind === "semantic_media_evidence") {
      const operation = next.semanticEvidence[artifact.origin.operationId];
      invariant(operation?.status === "started", event, `artifact ${artifact.id} has no active semantic operation`);
      invariant(
        operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId &&
          artifact.sourceArtifactIds.length === 1 && artifact.sourceArtifactIds[0] === operation.sourceArtifactId,
        event,
        `artifact ${artifact.id} changed its semantic producer or source`,
      );
    } else if (artifact.origin.kind === "worker_output") {
      const execution = next.executions[artifact.origin.executionId];
      invariant(execution?.status === "active", event, `artifact ${artifact.id} has no active worker execution`);
      invariant(
        execution.taskId === artifact.producerTaskId && execution.agentId === artifact.producerAgentId,
        event,
        `artifact ${artifact.id} changed its worker execution producer`,
      );
    } else if (artifact.origin.kind === "study_report") {
      const origin = artifact.origin;
      const execution = next.executions[origin.executionId];
      const task = artifact.producerTaskId ? next.tasks[artifact.producerTaskId] : null;
      invariant(execution?.status === "active", event, `artifact ${artifact.id} has no active study-report execution`);
      invariant(
        execution.taskId === artifact.producerTaskId && execution.agentId === artifact.producerAgentId &&
          task?.jobContext.contextId === origin.jobContextId &&
          task.requiredOutputs.some((slot) => slot.name === origin.outputSlotName && slot.artifactKind === "studio.study-report.v1"),
        event,
        `artifact ${artifact.id} changed its study task, context, or output slot`,
      );
    } else if (artifact.origin.kind === "parent_artifact_disposition") {
      const report = next.reports[artifact.origin.reportId];
      invariant(report?.study && report.status === artifact.origin.outcome, event, `artifact ${artifact.id} has no matching typed report disposition`);
      invariant(
        report.parentTaskId === artifact.producerTaskId && report.parentAgentId === artifact.producerAgentId &&
          report.study.output.artifactId === artifact.origin.inputArtifactId &&
          artifact.sourceArtifactIds.length === 1 && artifact.sourceArtifactIds[0] === artifact.origin.inputArtifactId,
        event,
        `artifact ${artifact.id} changed its parent disposition lineage`,
      );
    } else if (artifact.origin.kind === "parent_admission") {
      const report = next.reports[artifact.origin.reportId];
      invariant(report?.study && report.status === "accepted", event, `artifact ${artifact.id} has no accepted typed report`);
      invariant(
        report.parentTaskId === artifact.producerTaskId && report.parentAgentId === artifact.producerAgentId &&
          report.study.output.artifactId === artifact.origin.inputArtifactId &&
          artifact.sourceArtifactIds.length === 1 && artifact.sourceArtifactIds[0] === artifact.origin.inputArtifactId,
        event,
        `artifact ${artifact.id} changed its parent admission lineage`,
      );
    } else if (artifact.origin.kind === "root_output_disposition") {
      const report = next.reports[artifact.origin.reportId];
      const expectedStatus = artifact.origin.outcome === "promoted_to_root" ? "accepted" : "rejected";
      invariant(report?.status === expectedStatus, event, `artifact ${artifact.id} has no matching root report decision`);
      invariant(
        report.parentTaskId === artifact.producerTaskId &&
          report.parentAgentId === artifact.producerAgentId &&
          report.outputArtifactIds.includes(artifact.origin.inputArtifactId) &&
          artifact.sourceArtifactIds.length === 1 &&
          artifact.sourceArtifactIds[0] === artifact.origin.inputArtifactId,
        event,
        `artifact ${artifact.id} changed its root disposition lineage`,
      );
    } else if (artifact.origin.kind === "evidence_assessment") {
      const assessment = next.evidenceAssessments[artifact.origin.operationId];
      invariant(assessment?.status === "started", event, `artifact ${artifact.id} has no active evidence assessment`);
      invariant(
        assessment.taskId === artifact.producerTaskId && assessment.agentId === artifact.producerAgentId,
        event,
        `artifact ${artifact.id} changed its assessment producer`,
      );
      invariant(
        JSON.stringify(artifact.origin.readReceiptIds) === JSON.stringify(assessment.readReceiptIds) &&
          JSON.stringify(artifact.origin.readReceiptContentIds) === JSON.stringify(assessment.readReceiptContentIds),
        event,
        `artifact ${artifact.id} changed its assessment receipt inputs`,
      );
    } else if (artifact.origin.kind === "evidence_decision") {
      const decision = next.evidenceDecisions[artifact.origin.operationId];
      invariant(decision?.status === "started", event, `artifact ${artifact.id} has no active evidence decision`);
      invariant(
        decision.taskId === artifact.producerTaskId && decision.agentId === artifact.producerAgentId,
        event,
        `artifact ${artifact.id} changed its decision producer`,
      );
      invariant(
        JSON.stringify(artifact.origin.assessmentOperationIds) === JSON.stringify(decision.assessmentOperationIds) &&
          JSON.stringify(artifact.origin.assessmentArtifactIds) === JSON.stringify(decision.assessmentArtifactIds) &&
          JSON.stringify(artifact.origin.assessmentReceiptIds) === JSON.stringify(decision.assessmentReceiptIds) &&
          JSON.stringify(artifact.origin.assessmentReceiptContentIds) === JSON.stringify(decision.assessmentReceiptContentIds),
        event,
        `artifact ${artifact.id} changed its audited assessment inputs`,
      );
    } else if (artifact.origin.kind === "publish_review_intake") {
      const intake = next.publishReviewIntakes[artifact.origin.intakeId];
      invariant(intake?.status === "started", event, `artifact ${artifact.id} has no active publish-review intake`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null,
        event,
        `artifact ${artifact.id} incorrectly claims a task producer`,
      );
      invariant(
        artifact.origin.decisionOperationId === intake.decisionOperationId &&
          artifact.origin.decisionArtifactId === intake.decisionArtifactId &&
          artifact.origin.decisionReceiptId === intake.decisionReceiptId &&
          artifact.origin.decisionReceiptContentId === intake.decisionReceiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([intake.decisionArtifactId]),
        event,
        `artifact ${artifact.id} changed its verified decision input`,
      );
    } else if (artifact.origin.kind === "publish_review_decision") {
      const review = next.publishReviewDecisions[artifact.origin.reviewId];
      invariant(review?.status === "started", event, `artifact ${artifact.id} has no active publish-review decision`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null,
        event,
        `artifact ${artifact.id} incorrectly claims a task producer`,
      );
      invariant(
        artifact.origin.intakeId === review.intakeId &&
          artifact.origin.intakeArtifactId === review.intakeArtifactId &&
          artifact.origin.intakeReceiptId === review.intakeReceiptId &&
          artifact.origin.intakeReceiptContentId === review.intakeReceiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([review.intakeArtifactId]),
        event,
        `artifact ${artifact.id} changed its verified intake input`,
      );
    } else if (artifact.origin.kind === "publish_review_revocation") {
      const revocation = next.publishReviewRevocations[artifact.origin.revocationId];
      invariant(revocation?.status === "started", event, `artifact ${artifact.id} has no active publish-review revocation`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null,
        event,
        `artifact ${artifact.id} incorrectly claims a task producer`,
      );
      invariant(
        artifact.origin.reviewId === revocation.reviewId &&
          artifact.origin.approvalArtifactId === revocation.approvalArtifactId &&
          artifact.origin.approvalReceiptId === revocation.approvalReceiptId &&
          artifact.origin.approvalReceiptContentId === revocation.approvalReceiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([revocation.approvalArtifactId]),
        event,
        `artifact ${artifact.id} changed its verified approval input`,
      );
    } else if (artifact.origin.kind === "caption_production_output") {
      const job = next.captionProductions[artifact.origin.jobId];
      invariant(job?.status === "started", event, `artifact ${artifact.id} has no active caption production`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null &&
          artifact.origin.approvalReviewId === job.approvalReviewId &&
          artifact.origin.approvalArtifactId === job.approvalArtifactId &&
          artifact.origin.sourceArtifactId === job.sourceArtifactId &&
          artifact.origin.acceptedChildArtifactId === job.acceptedChildOutput.artifactId &&
          artifact.origin.rootPromotionArtifactId === job.rootPromotion.artifactId &&
          artifact.content.contentId !== artifact.origin.receiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([
            job.sourceArtifactId,
            job.acceptedChildOutput.artifactId,
            job.rootPromotion.artifactId,
            job.approvalArtifactId,
          ]),
        event,
        `artifact ${artifact.id} changed its caption source or approval authority`,
      );
    } else if (artifact.origin.kind === "caption_production_receipt") {
      const job = next.captionProductions[artifact.origin.jobId];
      const caption = next.artifacts[artifact.origin.captionArtifactId];
      invariant(job?.status === "started", event, `artifact ${artifact.id} has no active caption production`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null &&
          caption?.origin.kind === "caption_production_output" &&
          caption.origin.jobId === job.id &&
          caption.content.contentId === artifact.origin.captionContentId &&
          artifact.origin.approvalReviewId === job.approvalReviewId &&
          artifact.origin.approvalArtifactId === job.approvalArtifactId &&
          artifact.origin.rootPromotionArtifactId === job.rootPromotion.artifactId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([
            caption.id,
            job.rootPromotion.artifactId,
            job.approvalArtifactId,
          ]),
        event,
        `artifact ${artifact.id} changed its caption output or approval authority`,
      );
    } else if (artifact.origin.kind === "caption_quality_control") {
      const job = next.captionProductions[artifact.origin.jobId];
      const caption = next.artifacts[artifact.origin.captionArtifactId];
      invariant(job?.status === "completed", event, `artifact ${artifact.id} has no completed caption candidate`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null &&
          caption?.origin.kind === "caption_production_output" &&
          caption.id === job.captionArtifactId &&
          caption.content.contentId === artifact.origin.captionContentId &&
          artifact.origin.captionContentId === job.captionContentId &&
          artifact.content.contentId === artifact.origin.receiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([
            caption.id,
            job.rootPromotion.artifactId,
          ]),
        event,
        `artifact ${artifact.id} changed its caption candidate or current-run promotion lineage`,
      );
    }
    next.artifacts[artifact.id] = artifact;
    return true;
  }

  return false;
}
