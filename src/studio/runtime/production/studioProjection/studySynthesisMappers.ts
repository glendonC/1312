import type { RuntimeProjection } from "../model.ts";
import type {
  ProductionStudioOwnedMediaStudyView,
  ProductionStudioStudyFollowUpView,
  ProductionStudioStudyPlanningDecisionView,
  ProductionStudioStudyReadinessView,
} from "./model.ts";

export function projectStudyPlanningDecisions(state: RuntimeProjection): ProductionStudioStudyPlanningDecisionView[] {
  return Object.values(state.studyPlanningDecisions).map((decision) => ({
    decisionId: decision.id,
    inputId: decision.inputId,
    rootTaskId: decision.rootTaskId,
    rootAgentId: decision.rootAgentId,
    executionId: decision.executionId,
    artifactId: decision.artifactId,
    receiptId: decision.receiptId,
    receiptContentId: decision.receiptContentId,
    outcome: decision.outcome,
    reason: decision.reason,
    reports: structuredClone(decision.input.reports),
    coverage: structuredClone(decision.input.coverage),
    gaps: structuredClone(decision.input.gaps),
    conflicts: structuredClone(decision.input.conflicts),
    citedGapIds: [...decision.citedGapIds],
    citedConflictIds: [...decision.citedConflictIds],
  })).sort((left, right) => left.decisionId.localeCompare(right.decisionId));
}

export function projectStudyFollowUps(state: RuntimeProjection): ProductionStudioStudyFollowUpView[] {
  return Object.values(state.studyFollowUps).map((followUp) => ({
    followUpId: followUp.id,
    planningDecisionId: followUp.planningDecisionId,
    cause: structuredClone(followUp.cause),
    spawnRequestId: followUp.spawnRequestId,
    accepted: followUp.accepted,
    rejection: followUp.rejection,
    taskId: followUp.taskId,
    agentId: followUp.agentId,
  })).sort((left, right) => left.followUpId.localeCompare(right.followUpId));
}

export function projectOwnedMediaStudies(state: RuntimeProjection): ProductionStudioOwnedMediaStudyView[] {
  return Object.values(state.ownedMediaStudies).map((study) => ({
    studyId: study.id,
    planningDecisionId: study.planningDecisionId,
    rootTaskId: study.rootTaskId,
    rootAgentId: study.rootAgentId,
    executionId: study.executionId,
    artifactId: study.artifactId,
    contentId: study.contentId,
    executorReceiptId: study.executorReceiptId,
    executorReceiptContentId: study.executorReceiptContentId,
    coverage: structuredClone(study.coverage),
    conflicts: structuredClone(study.conflicts),
  })).sort((left, right) => left.studyId.localeCompare(right.studyId));
}

export function projectStudyReadiness(state: RuntimeProjection): ProductionStudioStudyReadinessView[] {
  return Object.values(state.studyReadiness).map((readiness) => ({
    readinessId: readiness.id,
    studyId: readiness.studyId,
    studyArtifactId: readiness.studyArtifactId,
    studyContentId: readiness.studyContentId,
    artifactId: readiness.artifactId,
    receiptId: readiness.receiptId,
    receiptContentId: readiness.receiptContentId,
    outcome: readiness.outcome,
    reasonCodes: [...readiness.reasonCodes],
  })).sort((left, right) => left.readinessId.localeCompare(right.readinessId));
}
