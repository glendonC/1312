import type { RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { invariant } from "./shared.ts";

export function applyArtifactEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "artifact.recorded") {
    const artifact = event.data.artifact;
    const isAtomicParentReceipt =
      (artifact.origin.kind === "parent_admission" || artifact.origin.kind === "parent_artifact_disposition") &&
      event.producer.kind === "admission_host";
    const isAtomicStudyReceipt =
      (artifact.origin.kind === "study_planning_decision" && event.producer.kind === "study_planning_host") ||
      (artifact.origin.kind === "owned_media_study" && event.producer.kind === "study_synthesis_host") ||
      (artifact.origin.kind === "study_readiness" && event.producer.kind === "study_audit_host");
    const isAtomicFrameSampling =
      (artifact.origin.kind === "sampled_frame" ||
        artifact.origin.kind === "frame_sample_manifest" ||
        artifact.origin.kind === "frame_sampling_receipt") &&
      event.producer.kind === "frame_host";
    invariant(
      event.producer.kind === "artifact_store" || isAtomicParentReceipt || isAtomicStudyReceipt || isAtomicFrameSampling,
      event,
      "artifact evidence must come from its bounded storage, capability, admission, planning, synthesis, or audit host",
    );
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
    } else if (artifact.origin.kind === "sampled_frame") {
      const operation = next.frameSamples[artifact.origin.operationId];
      invariant(operation?.status === "started", event, `frame ${artifact.id} has no active frame operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `frame ${artifact.id} changed its producer`);
      invariant(artifact.sourceArtifactIds.length === 1 && artifact.sourceArtifactIds[0] === operation.sourceArtifactId, event, `frame ${artifact.id} changed source lineage`);
    } else if (artifact.origin.kind === "frame_sample_manifest") {
      const operation = next.frameSamples[artifact.origin.operationId];
      invariant(operation?.status === "started", event, `frame manifest ${artifact.id} has no active frame operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `frame manifest ${artifact.id} changed its producer`);
      invariant(artifact.sourceArtifactIds[0] === operation.sourceArtifactId && artifact.sourceArtifactIds.slice(1).every((id) => next.artifacts[id]?.origin.kind === "sampled_frame"), event, `frame manifest ${artifact.id} changed frame lineage`);
    } else if (artifact.origin.kind === "frame_sampling_receipt") {
      const operation = next.frameSamples[artifact.origin.operationId];
      invariant(operation?.status === "started", event, `frame receipt ${artifact.id} has no active frame operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `frame receipt ${artifact.id} changed its producer`);
      invariant(artifact.sourceArtifactIds[0] === operation.sourceArtifactId && artifact.sourceArtifactIds[1] === artifact.origin.manifestArtifactId && next.artifacts[artifact.origin.manifestArtifactId]?.origin.kind === "frame_sample_manifest", event, `frame receipt ${artifact.id} changed manifest lineage`);
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
          task.requiredOutputs.some((slot) => slot.name === origin.outputSlotName && slot.artifactKind === artifact.kind),
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
    } else if (artifact.origin.kind === "generalized_parent_admission") {
      const report = next.reports[artifact.origin.reportId];
      invariant(report?.study?.schema === "studio.study-report-submission.v2" && report.status === "accepted", event, `artifact ${artifact.id} has no accepted v2 report`);
      invariant(
        report.parentTaskId === artifact.producerTaskId && report.parentAgentId === artifact.producerAgentId &&
          report.study.output.artifactId === artifact.origin.reportArtifactId &&
          artifact.sourceArtifactIds.length === 1 && artifact.sourceArtifactIds[0] === artifact.origin.reportArtifactId,
        event,
        `artifact ${artifact.id} changed its generalized admission lineage`,
      );
    } else if (artifact.origin.kind === "generalized_parent_artifact_read") {
      const admission = next.generalizedParentArtifactAdmissions[artifact.origin.admissionId];
      invariant(admission?.contractVersion === 2, event, `artifact ${artifact.id} has no v2 admission authority`);
      invariant(
        admission.parentTaskId === artifact.producerTaskId && admission.parentAgentId === artifact.producerAgentId &&
          admission.inputArtifactId === artifact.origin.reportArtifactId &&
          artifact.sourceArtifactIds.length === 1 && artifact.sourceArtifactIds[0] === artifact.origin.reportArtifactId,
        event,
        `artifact ${artifact.id} changed its generalized read lineage`,
      );
    } else if (artifact.origin.kind === "study_planning_decision") {
      const execution = next.executions[artifact.origin.executionId];
      invariant(execution?.status === "active" && execution.taskId === artifact.producerTaskId && execution.agentId === artifact.producerAgentId, event, `artifact ${artifact.id} has no active root planning executor`);
    } else if (artifact.origin.kind === "owned_media_study") {
      const execution = next.executions[artifact.origin.executionId];
      const planning = next.studyPlanningDecisions[artifact.origin.planningDecisionId];
      invariant(execution?.status === "active" && execution.taskId === artifact.producerTaskId && execution.agentId === artifact.producerAgentId && planning?.outcome === "synthesize_with_gaps", event, `artifact ${artifact.id} has no active root synthesis executor or planning decision`);
    } else if (artifact.origin.kind === "generalized_owned_media_study") {
      const execution = next.executions[artifact.origin.executionId];
      invariant(execution?.status === "active" && execution.taskId === artifact.producerTaskId && execution.agentId === artifact.producerAgentId, event, `artifact ${artifact.id} has no active generalized root synthesis executor`);
    } else if (artifact.origin.kind === "study_readiness") {
      const study = next.ownedMediaStudies[artifact.origin.studyId];
      invariant(study?.artifactId === artifact.origin.studyArtifactId && artifact.producerTaskId === null && artifact.producerAgentId === null, event, `artifact ${artifact.id} has no exact owned-media study input`);
    } else if (artifact.origin.kind === "generalized_study_readiness") {
      const study = next.generalizedOwnedMediaStudies[artifact.origin.studyId];
      invariant(study?.artifactId === artifact.origin.studyArtifactId && (study.schema === "studio.owned-media-study.v2" || study.schema === "studio.owned-media-study.v3") && artifact.producerTaskId === null && artifact.producerAgentId === null, event, `artifact ${artifact.id} has no exact generalized study input`);
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
        artifact.origin.readinessId === intake.readinessId &&
          artifact.origin.readinessArtifactId === intake.readinessArtifactId &&
          artifact.origin.readinessReceiptId === intake.readinessReceiptId &&
          artifact.origin.readinessReceiptContentId === intake.readinessReceiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([intake.readinessArtifactId]),
        event,
        `artifact ${artifact.id} changed its verified study-readiness input`,
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
          artifact.origin.studyId === job.study.studyId &&
          artifact.origin.studyArtifactId === job.study.artifactId &&
          artifact.origin.readinessId === job.readiness.readinessId &&
          artifact.origin.readinessArtifactId === job.readiness.artifactId &&
          artifact.content.contentId !== artifact.origin.receiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([
            job.sourceArtifactId,
            job.study.artifactId,
            job.readiness.artifactId,
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
          artifact.origin.studyId === job.study.studyId &&
          artifact.origin.studyArtifactId === job.study.artifactId &&
          artifact.origin.readinessId === job.readiness.readinessId &&
          artifact.origin.readinessArtifactId === job.readiness.artifactId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([
            caption.id,
            job.study.artifactId,
            job.readiness.artifactId,
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
          artifact.origin.studyId === job.study.studyId &&
          artifact.origin.readinessId === job.readiness.readinessId &&
          artifact.origin.approvalReviewId === job.approvalReviewId &&
          artifact.content.contentId === artifact.origin.receiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([
            caption.id,
            job.study.artifactId,
            job.readiness.artifactId,
            job.approvalArtifactId,
          ]),
        event,
        `artifact ${artifact.id} changed its caption candidate or study/approval lineage`,
      );
    }
    next.artifacts[artifact.id] = artifact;
    return true;
  }

  return false;
}
