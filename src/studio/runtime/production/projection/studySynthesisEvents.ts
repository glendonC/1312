import type { RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { invariant } from "./shared.ts";
import { canonicalJsonContentId } from "../artifactStore.ts";

export function applyStudySynthesisEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "study.restudied_synthesis_completed") {
    invariant(event.producer.kind === "study_synthesis_host", event, "restudied studies must come from the synthesis host");
    const receipt = event.data.executorReceipt;
    const artifact = next.artifacts[event.data.outputArtifactId];
    const execution = artifact?.origin.kind === "generalized_owned_media_study" ? next.executions[artifact.origin.executionId] : null;
    invariant(!next.generalizedOwnedMediaStudies[event.data.studyId] && Object.keys(next.generalizedOwnedMediaStudies).length === 0, event, `restudied study ${event.data.studyId} duplicates terminal synthesis`);
    invariant(
      receipt.output.studyId === event.data.studyId && receipt.output.artifactId === event.data.outputArtifactId &&
        receipt.output.contentId === event.data.outputContentId && receipt.output.schema === "studio.owned-media-study.v3" &&
        execution?.status === "active" && execution.taskId === artifact?.producerTaskId && execution.agentId === artifact.producerAgentId &&
        artifact?.origin.kind === "generalized_owned_media_study" && artifact.origin.studyId === event.data.studyId &&
        artifact.origin.executorReceiptId === receipt.receiptId && artifact.origin.executorReceiptContentId === event.data.executorReceiptContentId &&
        canonicalJsonContentId(receipt) === event.data.executorReceiptContentId &&
        artifact.content.contentId === event.data.outputContentId &&
        JSON.stringify(receipt.input.reportArtifactIds) === JSON.stringify(event.data.projection.reports.map((entry) => entry.report.artifactId)) &&
        JSON.stringify(receipt.input.admissionIds) === JSON.stringify(event.data.projection.reports.map((entry) => entry.admission.admissionId)) &&
        JSON.stringify(receipt.input.passIds) === JSON.stringify(event.data.projection.passes.map((entry) => entry.id)) &&
        event.data.projection.passes.every((entry) => JSON.stringify(next.rangePasses[entry.id]) === JSON.stringify(entry)),
      event,
      `restudied study ${event.data.studyId} changed its executor, reports, passes, artifact, or receipt lineage`,
    );
    next.generalizedOwnedMediaStudies[event.data.studyId] = {
      schema: "studio.owned-media-study.v3",
      id: event.data.studyId,
      rootTaskId: execution.taskId,
      rootAgentId: execution.agentId,
      executionId: execution.id,
      artifactId: artifact.id,
      contentId: artifact.content.contentId,
      bytes: artifact.content.bytes,
      executorReceiptId: receipt.receiptId,
      executorReceiptContentId: event.data.executorReceiptContentId,
      reports: structuredClone(event.data.projection.reports),
      passes: structuredClone(event.data.projection.passes),
      coverage: structuredClone(event.data.projection.coverage),
      claims: structuredClone(event.data.projection.claims),
      evidenceCitations: structuredClone(event.data.projection.evidenceCitations),
    };
    return true;
  }

  if (event.type === "study.restudied_readiness_audited") {
    invariant(event.producer.kind === "study_audit_host", event, "restudied readiness must come from the deterministic audit host");
    const receipt = event.data.receipt;
    const study = next.generalizedOwnedMediaStudies[event.data.studyId];
    const artifact = next.artifacts[event.data.outputArtifactId];
    invariant(study?.schema === "studio.owned-media-study.v3", event, `restudied readiness ${receipt.readinessId} has no v3 study`);
    invariant(!next.generalizedStudyReadiness[receipt.readinessId] && !Object.values(next.generalizedStudyReadiness).some((entry) => entry.studyId === study.id), event, `restudied study ${study.id} was audited twice`);
    invariant(
      receipt.input.studyId === study.id && receipt.input.artifactId === study.artifactId && receipt.input.contentId === study.contentId &&
        event.data.study.study.studyId === study.id && event.data.study.study.artifactId === study.artifactId &&
        event.data.study.executorReceiptId === study.executorReceiptId && event.data.study.executorReceiptContentId === study.executorReceiptContentId &&
        artifact?.origin.kind === "generalized_study_readiness" && artifact.origin.readinessId === receipt.readinessId &&
        artifact.origin.studyId === study.id && artifact.origin.studyArtifactId === study.artifactId &&
        artifact.origin.receiptId === receipt.receiptId && artifact.content.contentId === event.data.receiptContentId &&
        canonicalJsonContentId(receipt) === event.data.receiptContentId,
      event,
      `restudied readiness ${receipt.readinessId} changed study, artifact, or receipt lineage`,
    );
    next.generalizedStudyReadiness[receipt.readinessId] = {
      schema: "studio.study-readiness.receipt.v4",
      id: receipt.readinessId,
      studyId: study.id,
      studyArtifactId: study.artifactId,
      studyContentId: study.contentId,
      status: "completed",
      artifactId: artifact.id,
      receiptId: receipt.receiptId,
      receiptContentId: artifact.content.contentId,
      outcome: receipt.result.outcome,
      reasonCodes: [...receipt.result.reasonCodes],
      states: [...receipt.result.states],
      terminalWeakCoverageIds: [...receipt.result.terminalWeakCoverageIds],
      study: structuredClone(event.data.study),
    };
    return true;
  }

  if (event.type === "study.generalized_synthesis_completed") {
    invariant(event.producer.kind === "study_synthesis_host", event, "generalized studies must come from the synthesis host");
    const receipt = event.data.executorReceipt;
    const artifact = next.artifacts[event.data.outputArtifactId];
    const execution = artifact?.origin.kind === "generalized_owned_media_study"
      ? next.executions[artifact.origin.executionId]
      : null;
    invariant(!next.generalizedOwnedMediaStudies[event.data.studyId] && Object.keys(next.generalizedOwnedMediaStudies).length === 0, event, `generalized study ${event.data.studyId} duplicates terminal synthesis`);
    invariant(
      receipt.output.studyId === event.data.studyId && receipt.output.artifactId === event.data.outputArtifactId &&
        receipt.output.contentId === event.data.outputContentId && receipt.output.schema === "studio.owned-media-study.v2" &&
        execution?.status === "active" && execution.taskId === artifact?.producerTaskId && execution.agentId === artifact.producerAgentId &&
        artifact?.origin.kind === "generalized_owned_media_study" && artifact.origin.studyId === event.data.studyId &&
        artifact.origin.executorReceiptId === receipt.receiptId && artifact.origin.executorReceiptContentId === event.data.executorReceiptContentId &&
        artifact.content.contentId === event.data.outputContentId &&
        JSON.stringify(receipt.input.reportArtifactIds) === JSON.stringify(event.data.projection.reports.map((entry) => entry.report.artifactId)) &&
        JSON.stringify(receipt.input.admissionIds) === JSON.stringify(event.data.projection.reports.map((entry) => entry.admission.admissionId)),
      event,
      `generalized study ${event.data.studyId} changed its executor, admitted reports, artifact, or receipt lineage`,
    );
    next.generalizedOwnedMediaStudies[event.data.studyId] = {
      schema: "studio.owned-media-study.v2",
      id: event.data.studyId,
      rootTaskId: execution.taskId,
      rootAgentId: execution.agentId,
      executionId: execution.id,
      artifactId: artifact.id,
      contentId: artifact.content.contentId,
      bytes: artifact.content.bytes,
      executorReceiptId: receipt.receiptId,
      executorReceiptContentId: event.data.executorReceiptContentId,
      reports: structuredClone(event.data.projection.reports),
      coverage: structuredClone(event.data.projection.coverage),
      claims: structuredClone(event.data.projection.claims),
      evidenceCitations: structuredClone(event.data.projection.evidenceCitations),
    };
    return true;
  }

  if (event.type === "study.generalized_readiness_audited") {
    invariant(event.producer.kind === "study_audit_host", event, "generalized readiness must come from the deterministic audit host");
    const receipt = event.data.receipt;
    const study = next.generalizedOwnedMediaStudies[event.data.studyId];
    const artifact = next.artifacts[event.data.outputArtifactId];
    invariant(study?.schema === "studio.owned-media-study.v2", event, `generalized readiness ${receipt.readinessId} has no v2 study`);
    invariant(!next.generalizedStudyReadiness[receipt.readinessId] && !Object.values(next.generalizedStudyReadiness).some((entry) => entry.studyId === study.id), event, `generalized study ${study.id} was audited twice`);
    invariant(
      receipt.input.studyId === study.id && receipt.input.artifactId === study.artifactId && receipt.input.contentId === study.contentId &&
        event.data.study.study.studyId === study.id && event.data.study.study.artifactId === study.artifactId &&
        event.data.study.executorReceiptId === study.executorReceiptId && event.data.study.executorReceiptContentId === study.executorReceiptContentId &&
        artifact?.origin.kind === "generalized_study_readiness" && artifact.origin.readinessId === receipt.readinessId &&
        artifact.origin.studyId === study.id && artifact.origin.studyArtifactId === study.artifactId &&
        artifact.origin.receiptId === receipt.receiptId && artifact.content.contentId === event.data.receiptContentId,
      event,
      `generalized readiness ${receipt.readinessId} changed study, artifact, or receipt lineage`,
    );
    next.generalizedStudyReadiness[receipt.readinessId] = {
      schema: "studio.study-readiness.receipt.v3",
      id: receipt.readinessId,
      studyId: study.id,
      studyArtifactId: study.artifactId,
      studyContentId: study.contentId,
      status: "completed",
      artifactId: artifact.id,
      receiptId: receipt.receiptId,
      receiptContentId: artifact.content.contentId,
      outcome: receipt.result.outcome,
      reasonCodes: [...receipt.result.reasonCodes],
      states: [...receipt.result.states],
      study: structuredClone(event.data.study),
    };
    return true;
  }

  if (event.type === "study.planning_decision_recorded") {
    invariant(event.producer.kind === "study_planning_host", event, "study planning decisions must come from the planning host");
    const receipt = event.data.receipt;
    const execution = next.executions[receipt.modelExecutor.executionId];
    const task = next.tasks[receipt.modelExecutor.taskId];
    const artifact = next.artifacts[event.data.outputArtifactId];
    invariant(
      execution?.status === "active" && execution.taskId === task?.id && execution.agentId === receipt.modelExecutor.agentId &&
        task.ownerAgentId === receipt.modelExecutor.agentId && task.parentTaskId === null,
      event,
      `study planning decision ${receipt.decisionId} has no active root executor`,
    );
    invariant(!next.studyPlanningDecisions[receipt.decisionId], event, `study planning decision ${receipt.decisionId} is duplicated`);
    invariant(
      artifact?.origin.kind === "study_planning_decision" && artifact.origin.decisionId === receipt.decisionId &&
        artifact.origin.inputId === receipt.input.inputId && artifact.origin.executionId === execution.id &&
        artifact.origin.receiptId === receipt.receiptId && artifact.origin.receiptContentId === event.data.receiptContentId &&
        artifact.content.contentId === event.data.receiptContentId,
      event,
      `study planning decision ${receipt.decisionId} lost its content-addressed receipt`,
    );
    next.studyPlanningDecisions[receipt.decisionId] = {
      id: receipt.decisionId,
      inputId: receipt.input.inputId,
      rootTaskId: task.id,
      rootAgentId: task.ownerAgentId!,
      executionId: execution.id,
      artifactId: artifact.id,
      receiptId: receipt.receiptId,
      receiptContentId: artifact.content.contentId,
      outcome: receipt.decision.outcome,
      coverageIds: receipt.input.coverage.map((entry) => entry.coverageId),
      gapIds: receipt.input.gaps.map((entry) => entry.gapId),
      conflictIds: receipt.input.conflicts.map((entry) => entry.conflictId),
      citedGapIds: [...receipt.decision.citedGapIds],
      citedConflictIds: [...receipt.decision.citedConflictIds],
      input: structuredClone(receipt.input),
      reason: receipt.decision.reason,
    };
    return true;
  }

  if (event.type === "study.follow_up_linked") {
    invariant(event.producer.kind === "study_planning_host", event, "study follow-up causation must come from the planning host");
    const followUp = event.data.followUp;
    const planning = next.studyPlanningDecisions[followUp.planningDecisionId];
    const spawn = next.spawnRequests[followUp.spawnRequestId];
    invariant(planning?.outcome === "request_follow_up", event, `follow-up ${followUp.id} has no request-follow-up decision`);
    const cited = followUp.cause.kind === "gap" ? planning.citedGapIds : planning.citedConflictIds;
    invariant(cited.includes(followUp.cause.id), event, `follow-up ${followUp.id} does not name a cited cause`);
    invariant(
      spawn?.authoredByExecutionId === planning.executionId && spawn.requestedByTaskId === planning.rootTaskId &&
        spawn.requestedByAgentId === planning.rootAgentId && spawn.accepted === followUp.accepted &&
        spawn.rejection === followUp.rejection && spawn.taskId === followUp.taskId && spawn.agentId === followUp.agentId,
      event,
      `follow-up ${followUp.id} changed its scheduler request or decision`,
    );
    invariant(!next.studyFollowUps[followUp.id] && !Object.values(next.studyFollowUps).some((entry) => entry.spawnRequestId === followUp.spawnRequestId), event, `follow-up ${followUp.id} is duplicated`);
    next.studyFollowUps[followUp.id] = structuredClone(followUp);
    return true;
  }

  if (event.type === "study.synthesis_completed") {
    invariant(event.producer.kind === "study_synthesis_host", event, "owned-media studies must come from the synthesis host");
    const receipt = event.data.executorReceipt;
    const execution = next.executions[receipt.execution.executionId];
    const planning = next.studyPlanningDecisions[receipt.planning.decisionId];
    const artifact = next.artifacts[event.data.outputArtifactId];
    invariant(execution?.status === "active" && execution.taskId === receipt.execution.taskId && execution.agentId === receipt.execution.agentId, event, `study ${event.data.studyId} has no active root executor`);
    invariant(planning?.outcome === "synthesize_with_gaps" && planning.executionId === execution.id, event, `study ${event.data.studyId} has no matching synthesis decision`);
    invariant(
      JSON.stringify(event.data.projection.coverage.map((entry) => entry.coverageId)) === JSON.stringify(planning.coverageIds) &&
        JSON.stringify(event.data.projection.conflicts.map((entry) => entry.conflictId)) === JSON.stringify(planning.conflictIds),
      event,
      `study ${event.data.studyId} changed the exact planned coverage or conflict identities`,
    );
    invariant(!next.ownedMediaStudies[event.data.studyId] && Object.keys(next.ownedMediaStudies).length === 0, event, `study ${event.data.studyId} duplicates terminal root synthesis`);
    invariant(
      artifact?.origin.kind === "owned_media_study" && artifact.origin.studyId === event.data.studyId &&
        artifact.origin.planningDecisionId === planning.id && artifact.origin.executionId === execution.id &&
        artifact.origin.executorReceiptId === receipt.receiptId && artifact.origin.executorReceiptContentId === event.data.executorReceiptContentId &&
        artifact.content.contentId === event.data.outputContentId,
      event,
      `study ${event.data.studyId} lost its content-addressed artifact or executor receipt`,
    );
    next.ownedMediaStudies[event.data.studyId] = {
      id: event.data.studyId,
      planningDecisionId: planning.id,
      rootTaskId: execution.taskId,
      rootAgentId: execution.agentId,
      executionId: execution.id,
      artifactId: artifact.id,
      contentId: artifact.content.contentId,
      executorReceiptId: receipt.receiptId,
      executorReceiptContentId: event.data.executorReceiptContentId,
      coverageIds: [],
      conflictIds: [],
      coverage: structuredClone(event.data.projection.coverage),
      conflicts: structuredClone(event.data.projection.conflicts),
    };
    return true;
  }

  if (event.type === "study.readiness_audited") {
    invariant(event.producer.kind === "study_audit_host", event, "study readiness must come from the deterministic audit host");
    const receipt = event.data.receipt;
    const study = next.ownedMediaStudies[event.data.studyId];
    const artifact = next.artifacts[event.data.outputArtifactId];
    invariant(study && receipt.input.studyId === study.id && receipt.input.artifactId === study.artifactId && receipt.input.contentId === study.contentId, event, `readiness ${receipt.readinessId} changed its study input`);
    invariant(!next.studyReadiness[receipt.readinessId] && !Object.values(next.studyReadiness).some((entry) => entry.studyId === study.id), event, `study ${study.id} was audited twice`);
    invariant(
      artifact?.origin.kind === "study_readiness" && artifact.origin.readinessId === receipt.readinessId &&
        artifact.origin.studyId === study.id && artifact.origin.studyArtifactId === study.artifactId &&
        artifact.origin.receiptId === receipt.receiptId && artifact.origin.receiptContentId === event.data.receiptContentId &&
        artifact.origin.outcome === receipt.result.outcome && artifact.content.contentId === event.data.receiptContentId,
      event,
      `readiness ${receipt.readinessId} lost its content-addressed receipt`,
    );
    study.coverageIds = [...receipt.result.coverageIds];
    study.conflictIds = [...receipt.result.conflictIds];
    next.studyReadiness[receipt.readinessId] = {
      id: receipt.readinessId,
      studyId: study.id,
      studyArtifactId: study.artifactId,
      studyContentId: study.contentId,
      status: "completed",
      artifactId: artifact.id,
      receiptId: receipt.receiptId,
      receiptContentId: artifact.content.contentId,
      outcome: receipt.result.outcome,
      reasonCodes: [...receipt.result.reasonCodes],
    };
    return true;
  }
  return false;
}
