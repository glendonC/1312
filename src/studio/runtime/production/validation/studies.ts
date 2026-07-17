import type {
  OwnedMediaStudyArtifact,
  OwnedMediaStudyCoverageRange,
  OwnedMediaStudyExecutorReceipt,
  OwnedMediaStudySynthesisRequest,
  StudyPlanningDecisionReceipt,
  StudyPlanningDecisionRequest,
  StudyPlanningInput,
  StudyReadinessReceipt,
} from "../model.ts";
import { OWNED_MEDIA_STUDY_LIMITS } from "../model.ts";
import { validateSemanticEvidenceCitationInput } from "./semanticEvidence.ts";
import { assertTaskJobContext } from "./scheduling.ts";
import {
  array,
  contentId,
  exact,
  fail,
  integer,
  literal,
  object,
  oneOf,
  string,
  uniqueStrings,
} from "./primitives.ts";

const COVERAGE_STATES = new Set(["supported", "withheld", "unknown", "failed"]);
const COVERAGE_REASONS = new Set([
  "semantic_evidence_unavailable", "semantic_evidence_empty", "insufficient_semantic_evidence",
  "worker_withheld", "operation_failed", "unobserved_range", "explicit_study_gap",
  "unresolved_conflict", "child_failure", "rejected_input",
]);
const LIMITATION_CODES = new Set([
  "explicit_gap", "unresolved_conflict", "partial_child_failure", "rejected_child_input",
  "recognizer_hypothesis_not_truth", "semantic_quality_not_assessed",
]);

function range(value: unknown, context: string, path: string) {
  const item = object(value, context, path);
  exact(item, ["artifactId", "trackId", "startMs", "endMs"], context, path);
  const startMs = integer(item.startMs, context, `${path}.startMs`);
  const endMs = integer(item.endMs, context, `${path}.endMs`, 1);
  if (endMs <= startMs) fail(context, path, "must be a non-empty half-open range");
  return {
    artifactId: string(item.artifactId, context, `${path}.artifactId`),
    trackId: string(item.trackId, context, `${path}.trackId`),
    startMs,
    endMs,
  };
}

function planningReport(value: unknown, context: string, path: string) {
  const item = object(value, context, path);
  exact(item, [
    "reportId", "childTaskId", "childAgentId", "artifactId", "contentId", "dispositionId",
    "dispositionReceiptId", "dispositionReceiptContentId", "admissionId", "admissionReceiptId",
    "admissionReceiptContentId", "readOperationId", "readReceiptId",
  ], context, path);
  return {
    reportId: string(item.reportId, context, `${path}.reportId`),
    childTaskId: string(item.childTaskId, context, `${path}.childTaskId`),
    childAgentId: string(item.childAgentId, context, `${path}.childAgentId`),
    artifactId: string(item.artifactId, context, `${path}.artifactId`),
    contentId: contentId(item.contentId, context, `${path}.contentId`),
    dispositionId: string(item.dispositionId, context, `${path}.dispositionId`),
    dispositionReceiptId: string(item.dispositionReceiptId, context, `${path}.dispositionReceiptId`),
    dispositionReceiptContentId: contentId(item.dispositionReceiptContentId, context, `${path}.dispositionReceiptContentId`),
    admissionId: string(item.admissionId, context, `${path}.admissionId`),
    admissionReceiptId: string(item.admissionReceiptId, context, `${path}.admissionReceiptId`),
    admissionReceiptContentId: contentId(item.admissionReceiptContentId, context, `${path}.admissionReceiptContentId`),
    readOperationId: string(item.readOperationId, context, `${path}.readOperationId`),
    readReceiptId: string(item.readReceiptId, context, `${path}.readReceiptId`),
  };
}

export function validateStudyPlanningInput(
  value: unknown,
  context = "Study planning input",
  path = "input",
): StudyPlanningInput {
  const item = object(value, context, path);
  exact(item, [
    "schema", "inputId", "runId", "rootTaskId", "rootAgentId", "rootExecutionId",
    "jobContextId", "reports", "coverage", "gaps", "conflicts",
  ], context, path);
  literal(item.schema, "studio.study-planning-input.v1", context, `${path}.schema`);
  const reports = array(item.reports, context, `${path}.reports`).map((entry, index) =>
    planningReport(entry, context, `${path}.reports[${index}]`));
  if (reports.length < 2 || reports.length > OWNED_MEDIA_STUDY_LIMITS.maxPlanningReports ||
      new Set(reports.map((entry) => entry.reportId)).size !== reports.length) {
    fail(context, `${path}.reports`, "must contain at least two unique admitted, read reports within the closed limit");
  }
  const coverage = array(item.coverage, context, `${path}.coverage`).map((entry, index) => {
    const found = object(entry, context, `${path}.coverage[${index}]`);
    exact(found, ["coverageId", "range", "aggregate", "childRanges"], context, `${path}.coverage[${index}]`);
    const childRanges = array(found.childRanges, context, `${path}.coverage[${index}].childRanges`).map((child, childIndex) => {
      const candidate = object(child, context, `${path}.coverage[${index}].childRanges[${childIndex}]`);
      exact(candidate, ["reportId", "artifactId", "state", "claimIds", "reasonCode"], context, `${path}.coverage[${index}].childRanges[${childIndex}]`);
      return {
        reportId: string(candidate.reportId, context, `${path}.coverage[${index}].childRanges[${childIndex}].reportId`),
        artifactId: string(candidate.artifactId, context, `${path}.coverage[${index}].childRanges[${childIndex}].artifactId`),
        state: oneOf(candidate.state, COVERAGE_STATES, context, `${path}.coverage[${index}].childRanges[${childIndex}].state`),
        claimIds: uniqueStrings(candidate.claimIds, context, `${path}.coverage[${index}].childRanges[${childIndex}].claimIds`),
        reasonCode: candidate.reasonCode === null ? null : oneOf(candidate.reasonCode, COVERAGE_REASONS, context, `${path}.coverage[${index}].childRanges[${childIndex}].reasonCode`),
      };
    });
    return {
      coverageId: string(found.coverageId, context, `${path}.coverage[${index}].coverageId`),
      range: range(found.range, context, `${path}.coverage[${index}].range`),
      aggregate: oneOf(found.aggregate, new Set(["supported_candidate", "gap", "conflict"]), context, `${path}.coverage[${index}].aggregate`),
      childRanges,
    };
  });
  if (coverage.length === 0 || coverage.length > OWNED_MEDIA_STUDY_LIMITS.maxCoverageRanges ||
      new Set(coverage.map((entry) => entry.coverageId)).size !== coverage.length) {
    fail(context, `${path}.coverage`, "must contain unique bounded coverage identities");
  }
  const gaps = array(item.gaps, context, `${path}.gaps`).map((entry, index) => {
    const found = object(entry, context, `${path}.gaps[${index}]`);
    exact(found, ["gapId", "coverageId", "range", "reasonCodes"], context, `${path}.gaps[${index}]`);
    return {
      gapId: string(found.gapId, context, `${path}.gaps[${index}].gapId`),
      coverageId: string(found.coverageId, context, `${path}.gaps[${index}].coverageId`),
      range: range(found.range, context, `${path}.gaps[${index}].range`),
      reasonCodes: uniqueStrings(found.reasonCodes, context, `${path}.gaps[${index}].reasonCodes`)
        .map((code) => oneOf(code, COVERAGE_REASONS, context, `${path}.gaps[${index}].reasonCodes`)),
    };
  });
  const conflicts = array(item.conflicts, context, `${path}.conflicts`).map((entry, index) => {
    const found = object(entry, context, `${path}.conflicts[${index}]`);
    exact(found, ["conflictId", "coverageId", "range", "claims"], context, `${path}.conflicts[${index}]`);
    const claims = array(found.claims, context, `${path}.conflicts[${index}].claims`).map((claim, claimIndex) => {
      const candidate = object(claim, context, `${path}.conflicts[${index}].claims[${claimIndex}]`);
      exact(candidate, ["reportId", "artifactId", "claimId", "statement"], context, `${path}.conflicts[${index}].claims[${claimIndex}]`);
      return {
        reportId: string(candidate.reportId, context, `${path}.conflicts[${index}].claims[${claimIndex}].reportId`),
        artifactId: string(candidate.artifactId, context, `${path}.conflicts[${index}].claims[${claimIndex}].artifactId`),
        claimId: string(candidate.claimId, context, `${path}.conflicts[${index}].claims[${claimIndex}].claimId`),
        statement: string(candidate.statement, context, `${path}.conflicts[${index}].claims[${claimIndex}].statement`),
      };
    });
    if (claims.length < 2) fail(context, `${path}.conflicts[${index}].claims`, "must cite at least two conflicting child claims");
    return {
      conflictId: string(found.conflictId, context, `${path}.conflicts[${index}].conflictId`),
      coverageId: string(found.coverageId, context, `${path}.conflicts[${index}].coverageId`),
      range: range(found.range, context, `${path}.conflicts[${index}].range`),
      claims,
    };
  });
  return {
    schema: "studio.study-planning-input.v1",
    inputId: string(item.inputId, context, `${path}.inputId`),
    runId: string(item.runId, context, `${path}.runId`),
    rootTaskId: string(item.rootTaskId, context, `${path}.rootTaskId`),
    rootAgentId: string(item.rootAgentId, context, `${path}.rootAgentId`),
    rootExecutionId: string(item.rootExecutionId, context, `${path}.rootExecutionId`),
    jobContextId: string(item.jobContextId, context, `${path}.jobContextId`),
    reports,
    coverage,
    gaps,
    conflicts,
  } as StudyPlanningInput;
}

export function validateStudyPlanningDecisionRequest(value: unknown): StudyPlanningDecisionRequest {
  const context = "Study planning decision";
  const item = object(value, context, "request");
  exact(item, ["inputId", "coverageIds", "gapIds", "conflictIds", "outcome", "citedGapIds", "citedConflictIds", "reason"], context, "request");
  return {
    inputId: string(item.inputId, context, "request.inputId"),
    coverageIds: uniqueStrings(item.coverageIds, context, "request.coverageIds"),
    gapIds: uniqueStrings(item.gapIds, context, "request.gapIds"),
    conflictIds: uniqueStrings(item.conflictIds, context, "request.conflictIds"),
    outcome: oneOf(item.outcome, new Set(["request_follow_up", "synthesize_with_gaps", "withhold"]), context, "request.outcome"),
    citedGapIds: uniqueStrings(item.citedGapIds, context, "request.citedGapIds"),
    citedConflictIds: uniqueStrings(item.citedConflictIds, context, "request.citedConflictIds"),
    reason: string(item.reason, context, "request.reason"),
  };
}

export function validateStudyPlanningDecisionReceipt(value: unknown): StudyPlanningDecisionReceipt {
  const context = "Study planning decision receipt";
  const item = object(value, context, "receipt");
  exact(item, ["schema", "receiptId", "decisionId", "input", "modelExecutor", "decision", "nonClaims"], context, "receipt");
  literal(item.schema, "studio.study-planning-decision.receipt.v1", context, "receipt.schema");
  const modelExecutor = object(item.modelExecutor, context, "receipt.modelExecutor");
  exact(modelExecutor, ["executionId", "taskId", "agentId"], context, "receipt.modelExecutor");
  const decision = object(item.decision, context, "receipt.decision");
  exact(decision, ["outcome", "citedGapIds", "citedConflictIds", "reason"], context, "receipt.decision");
  const nonClaims = object(item.nonClaims, context, "receipt.nonClaims");
  exact(nonClaims, ["semanticCorrectness", "truthArbitration", "readiness"], context, "receipt.nonClaims");
  literal(nonClaims.semanticCorrectness, "not_assessed", context, "receipt.nonClaims.semanticCorrectness");
  literal(nonClaims.truthArbitration, "not_performed", context, "receipt.nonClaims.truthArbitration");
  literal(nonClaims.readiness, "not_decided", context, "receipt.nonClaims.readiness");
  return {
    schema: "studio.study-planning-decision.receipt.v1",
    receiptId: string(item.receiptId, context, "receipt.receiptId"),
    decisionId: string(item.decisionId, context, "receipt.decisionId"),
    input: validateStudyPlanningInput(item.input, context, "receipt.input"),
    modelExecutor: {
      executionId: string(modelExecutor.executionId, context, "receipt.modelExecutor.executionId"),
      taskId: string(modelExecutor.taskId, context, "receipt.modelExecutor.taskId"),
      agentId: string(modelExecutor.agentId, context, "receipt.modelExecutor.agentId"),
    },
    decision: {
      outcome: oneOf(decision.outcome, new Set(["request_follow_up", "synthesize_with_gaps", "withhold"]), context, "receipt.decision.outcome"),
      citedGapIds: uniqueStrings(decision.citedGapIds, context, "receipt.decision.citedGapIds"),
      citedConflictIds: uniqueStrings(decision.citedConflictIds, context, "receipt.decision.citedConflictIds"),
      reason: string(decision.reason, context, "receipt.decision.reason"),
    },
    nonClaims: { semanticCorrectness: "not_assessed", truthArbitration: "not_performed", readiness: "not_decided" },
  };
}

function studyCoverage(value: unknown, context: string, path: string): OwnedMediaStudyCoverageRange {
  const item = object(value, context, path);
  exact(item, ["coverageId", "artifactId", "trackId", "startMs", "endMs", "state", "claimIds", "reason"], context, path);
  const media = range({ artifactId: item.artifactId, trackId: item.trackId, startMs: item.startMs, endMs: item.endMs }, context, path);
  const state = oneOf<OwnedMediaStudyCoverageRange["state"]>(item.state, COVERAGE_STATES, context, `${path}.state`);
  const claimIds = uniqueStrings(item.claimIds, context, `${path}.claimIds`);
  let reason: OwnedMediaStudyCoverageRange["reason"] = null;
  if (item.reason !== null) {
    const found = object(item.reason, context, `${path}.reason`);
    exact(found, ["code", "detail"], context, `${path}.reason`);
    reason = { code: oneOf(found.code, COVERAGE_REASONS, context, `${path}.reason.code`), detail: string(found.detail, context, `${path}.reason.detail`) };
  }
  if ((state === "supported") !== (claimIds.length > 0 && reason === null)) {
    fail(context, path, "supported coverage requires claims/no reason and non-supported coverage requires no claims/one reason");
  }
  return { coverageId: string(item.coverageId, context, `${path}.coverageId`), ...media, state, claimIds, reason };
}

function studyClaim(value: unknown, context: string, path: string) {
  const item = object(value, context, path);
  exact(item, ["claimId", "artifactId", "trackId", "startMs", "endMs", "statement", "childReportCitations", "semanticCitations"], context, path);
  const media = range({ artifactId: item.artifactId, trackId: item.trackId, startMs: item.startMs, endMs: item.endMs }, context, path);
  const childReportCitations = array(item.childReportCitations, context, `${path}.childReportCitations`).map((entry, index) => {
    const found = object(entry, context, `${path}.childReportCitations[${index}]`);
    exact(found, ["reportId", "artifactId", "contentId", "admissionId", "claimId"], context, `${path}.childReportCitations[${index}]`);
    return {
      reportId: string(found.reportId, context, `${path}.childReportCitations[${index}].reportId`),
      artifactId: string(found.artifactId, context, `${path}.childReportCitations[${index}].artifactId`),
      contentId: contentId(found.contentId, context, `${path}.childReportCitations[${index}].contentId`),
      admissionId: string(found.admissionId, context, `${path}.childReportCitations[${index}].admissionId`),
      claimId: string(found.claimId, context, `${path}.childReportCitations[${index}].claimId`),
    };
  });
  const semanticCitations = array(item.semanticCitations, context, `${path}.semanticCitations`).map((entry, index) =>
    validateSemanticEvidenceCitationInput(entry, context, `${path}.semanticCitations[${index}]`));
  if (childReportCitations.length === 0 || semanticCitations.length === 0) fail(context, path, "must cite both child reports and semantic observations");
  return {
    claimId: string(item.claimId, context, `${path}.claimId`),
    ...media,
    statement: string(item.statement, context, `${path}.statement`),
    childReportCitations,
    semanticCitations,
  };
}

function validateModelStudyFields(value: unknown, context: string, path: string): OwnedMediaStudySynthesisRequest {
  const item = object(value, context, path);
  exact(item, ["planningDecisionId", "coverage", "claims", "conflicts", "limitations"], context, path);
  const coverage = array(item.coverage, context, `${path}.coverage`).map((entry, index) => studyCoverage(entry, context, `${path}.coverage[${index}]`));
  const claims = array(item.claims, context, `${path}.claims`).map((entry, index) => studyClaim(entry, context, `${path}.claims[${index}]`));
  const conflicts = array(item.conflicts, context, `${path}.conflicts`).map((entry, index) => {
    const found = object(entry, context, `${path}.conflicts[${index}]`);
    exact(found, ["conflictId", "coverageId", "status", "detail"], context, `${path}.conflicts[${index}]`);
    return {
      conflictId: string(found.conflictId, context, `${path}.conflicts[${index}].conflictId`),
      coverageId: string(found.coverageId, context, `${path}.conflicts[${index}].coverageId`),
      status: literal(found.status, "unresolved", context, `${path}.conflicts[${index}].status`),
      detail: string(found.detail, context, `${path}.conflicts[${index}].detail`),
    };
  });
  const limitations = array(item.limitations, context, `${path}.limitations`).map((entry, index) => {
    const found = object(entry, context, `${path}.limitations[${index}]`);
    exact(found, ["code", "coverageIds", "detail"], context, `${path}.limitations[${index}]`);
    return {
      code: oneOf(found.code, LIMITATION_CODES, context, `${path}.limitations[${index}].code`),
      coverageIds: uniqueStrings(found.coverageIds, context, `${path}.limitations[${index}].coverageIds`),
      detail: string(found.detail, context, `${path}.limitations[${index}].detail`),
    };
  });
  if (coverage.length === 0 || coverage.length > OWNED_MEDIA_STUDY_LIMITS.maxCoverageRanges || claims.length > OWNED_MEDIA_STUDY_LIMITS.maxClaims ||
      conflicts.length > OWNED_MEDIA_STUDY_LIMITS.maxConflicts || limitations.length > OWNED_MEDIA_STUDY_LIMITS.maxLimitations) {
    fail(context, path, "exceeds the owned-media study limits");
  }
  return { planningDecisionId: string(item.planningDecisionId, context, `${path}.planningDecisionId`), coverage, claims, conflicts, limitations } as OwnedMediaStudySynthesisRequest;
}

export function validateOwnedMediaStudySynthesisRequest(value: unknown): OwnedMediaStudySynthesisRequest {
  return validateModelStudyFields(value, "Owned-media study synthesis", "request");
}

export function validateOwnedMediaStudyProjection(value: unknown): Pick<OwnedMediaStudySynthesisRequest, "coverage" | "conflicts"> {
  const context = "Owned-media study projection";
  const item = object(value, context, "projection");
  exact(item, ["coverage", "conflicts"], context, "projection");
  const validated = validateModelStudyFields({
    planningDecisionId: "projection",
    coverage: item.coverage,
    claims: [],
    conflicts: item.conflicts,
    limitations: [],
  }, context, "projection.modelAuthored");
  return { coverage: validated.coverage, conflicts: validated.conflicts };
}

export function validateOwnedMediaStudyArtifact(value: unknown): OwnedMediaStudyArtifact {
  const context = "Owned-media study";
  const item = object(value, context, "artifact");
  exact(item, ["schema", "runId", "root", "planning", "reports", "childDispositions", "followUpHistory", "coverage", "claims", "conflicts", "limitations", "sourceArtifacts", "limits", "nonClaims"], context, "artifact");
  literal(item.schema, "studio.owned-media-study.v1", context, "artifact.schema");
  const root = object(item.root, context, "artifact.root");
  exact(root, ["taskId", "agentId", "executionId", "jobContext"], context, "artifact.root");
  assertTaskJobContext(root.jobContext, context, "artifact.root.jobContext");
  const planning = object(item.planning, context, "artifact.planning");
  exact(planning, ["decisionId", "receiptId", "receiptContentId", "outcome", "inputId"], context, "artifact.planning");
  literal(planning.outcome, "synthesize_with_gaps", context, "artifact.planning.outcome");
  const model = validateModelStudyFields({
    planningDecisionId: planning.decisionId,
    coverage: item.coverage,
    claims: item.claims,
    conflicts: item.conflicts,
    limitations: item.limitations,
  }, context, "artifact.modelAuthored");
  const reports = array(item.reports, context, "artifact.reports").map((entry, index) => planningReport(entry, context, `artifact.reports[${index}]`));
  const childDispositions = array(item.childDispositions, context, "artifact.childDispositions").map((entry, index) => {
    const found = object(entry, context, `artifact.childDispositions[${index}]`);
    exact(found, ["childTaskId", "childAgentId", "reportId", "artifactId", "outcome", "reason", "dispositionId", "admissionId"], context, `artifact.childDispositions[${index}]`);
    return structuredClone(found) as unknown as OwnedMediaStudyArtifact["childDispositions"][number];
  });
  const followUpHistory = array(item.followUpHistory, context, "artifact.followUpHistory") as OwnedMediaStudyArtifact["followUpHistory"];
  if (followUpHistory.length > OWNED_MEDIA_STUDY_LIMITS.maxFollowUps) fail(context, "artifact.followUpHistory", "exceeds its limit");
  const sourceArtifacts = array(item.sourceArtifacts, context, "artifact.sourceArtifacts").map((entry, index) => {
    const found = object(entry, context, `artifact.sourceArtifacts[${index}]`);
    exact(found, ["artifactId", "contentId"], context, `artifact.sourceArtifacts[${index}]`);
    return { artifactId: string(found.artifactId, context, `artifact.sourceArtifacts[${index}].artifactId`), contentId: contentId(found.contentId, context, `artifact.sourceArtifacts[${index}].contentId`) };
  });
  const limits = object(item.limits, context, "artifact.limits");
  for (const [key, expected] of Object.entries(OWNED_MEDIA_STUDY_LIMITS)) if (limits[key] !== expected) fail(context, `artifact.limits.${key}`, `must equal ${expected}`);
  const nonClaims = object(item.nonClaims, context, "artifact.nonClaims");
  exact(nonClaims, ["semanticCorrectness", "translationQuality", "truthArbitration", "publication"], context, "artifact.nonClaims");
  return {
    schema: "studio.owned-media-study.v1",
    runId: string(item.runId, context, "artifact.runId"),
    root: { taskId: string(root.taskId, context, "artifact.root.taskId"), agentId: string(root.agentId, context, "artifact.root.agentId"), executionId: string(root.executionId, context, "artifact.root.executionId"), jobContext: structuredClone(root.jobContext) },
    planning: { decisionId: model.planningDecisionId, receiptId: string(planning.receiptId, context, "artifact.planning.receiptId"), receiptContentId: contentId(planning.receiptContentId, context, "artifact.planning.receiptContentId"), outcome: "synthesize_with_gaps", inputId: string(planning.inputId, context, "artifact.planning.inputId") },
    reports,
    childDispositions,
    followUpHistory: structuredClone(followUpHistory),
    coverage: model.coverage,
    claims: model.claims,
    conflicts: model.conflicts,
    limitations: model.limitations,
    sourceArtifacts,
    limits: OWNED_MEDIA_STUDY_LIMITS,
    nonClaims: { semanticCorrectness: "not_assessed", translationQuality: "not_assessed", truthArbitration: "not_performed", publication: "not_authorized" },
  };
}

export function validateOwnedMediaStudyExecutorReceipt(value: unknown): asserts value is OwnedMediaStudyExecutorReceipt {
  const context = "Owned-media study executor receipt";
  const item = object(value, context, "receipt");
  exact(item, ["schema", "receiptId", "synthesisId", "execution", "planning", "output", "producer", "outcome"], context, "receipt");
  literal(item.schema, "studio.owned-media-study.executor-receipt.v1", context, "receipt.schema");
  string(item.receiptId, context, "receipt.receiptId");
  string(item.synthesisId, context, "receipt.synthesisId");
  const execution = object(item.execution, context, "receipt.execution");
  exact(execution, ["executionId", "taskId", "agentId"], context, "receipt.execution");
  string(execution.executionId, context, "receipt.execution.executionId");
  string(execution.taskId, context, "receipt.execution.taskId");
  string(execution.agentId, context, "receipt.execution.agentId");
  const planning = object(item.planning, context, "receipt.planning");
  exact(planning, ["decisionId", "receiptId", "receiptContentId"], context, "receipt.planning");
  string(planning.decisionId, context, "receipt.planning.decisionId");
  string(planning.receiptId, context, "receipt.planning.receiptId");
  contentId(planning.receiptContentId, context, "receipt.planning.receiptContentId");
  const output = object(item.output, context, "receipt.output");
  exact(output, ["artifactId", "contentId", "bytes", "schema"], context, "receipt.output");
  string(output.artifactId, context, "receipt.output.artifactId");
  contentId(output.contentId, context, "receipt.output.contentId");
  integer(output.bytes, context, "receipt.output.bytes", 1);
  literal(output.schema, "studio.owned-media-study.v1", context, "receipt.output.schema");
  const producer = object(item.producer, context, "receipt.producer");
  exact(producer, ["id", "version", "authorship"], context, "receipt.producer");
  literal(producer.id, "studio.model-root-study-synthesis", context, "receipt.producer.id");
  literal(producer.version, "1", context, "receipt.producer.version");
  literal(producer.authorship, "active_root_executor_tool_call", context, "receipt.producer.authorship");
  literal(item.outcome, "completed", context, "receipt.outcome");
}

export function validateStudyReadinessReceipt(value: unknown): asserts value is StudyReadinessReceipt {
  const context = "Study readiness receipt";
  const item = object(value, context, "receipt");
  exact(item, ["schema", "receiptId", "readinessId", "input", "reopened", "producer", "result", "nonClaims"], context, "receipt");
  literal(item.schema, "studio.study-readiness.receipt.v1", context, "receipt.schema");
  string(item.receiptId, context, "receipt.receiptId");
  string(item.readinessId, context, "receipt.readinessId");
  const input = object(item.input, context, "receipt.input");
  exact(input, ["studyId", "artifactId", "contentId", "executorReceiptId", "executorReceiptContentId", "planningDecisionId", "planningReceiptId", "planningReceiptContentId"], context, "receipt.input");
  string(input.studyId, context, "receipt.input.studyId");
  string(input.artifactId, context, "receipt.input.artifactId");
  contentId(input.contentId, context, "receipt.input.contentId");
  string(input.executorReceiptId, context, "receipt.input.executorReceiptId");
  contentId(input.executorReceiptContentId, context, "receipt.input.executorReceiptContentId");
  string(input.planningDecisionId, context, "receipt.input.planningDecisionId");
  string(input.planningReceiptId, context, "receipt.input.planningReceiptId");
  contentId(input.planningReceiptContentId, context, "receipt.input.planningReceiptContentId");
  const reopened = object(item.reopened, context, "receipt.reopened");
  exact(reopened, ["sourceArtifactIds", "semanticEvidenceArtifactIds", "reportArtifactIds", "admissionIds", "planningDecisionIds", "executorIds"], context, "receipt.reopened");
  for (const key of ["sourceArtifactIds", "semanticEvidenceArtifactIds", "reportArtifactIds", "admissionIds", "planningDecisionIds", "executorIds"] as const) uniqueStrings(reopened[key], context, `receipt.reopened.${key}`);
  const producer = object(item.producer, context, "receipt.producer");
  exact(producer, ["id", "version", "policy"], context, "receipt.producer");
  literal(producer.id, "studio.deterministic-study-readiness-audit", context, "receipt.producer.id");
  literal(producer.version, "1", context, "receipt.producer.version");
  literal(producer.policy, "closed_gap_and_integrity_gate_no_quality_score", context, "receipt.producer.policy");
  const result = object(item.result, context, "receipt.result");
  exact(result, ["outcome", "reasonCodes", "coverageIds", "conflictIds"], context, "receipt.result");
  oneOf(result.outcome, new Set(["proceed_to_caption_review", "withheld"]), context, "receipt.result.outcome");
  uniqueStrings(result.reasonCodes, context, "receipt.result.reasonCodes").forEach((code) => oneOf(code, new Set(["non_supported_root_coverage", "unresolved_conflict", "hidden_gap", "unsupported_synthesized_claim", "stored_content_integrity_failed"]), context, "receipt.result.reasonCodes"));
  uniqueStrings(result.coverageIds, context, "receipt.result.coverageIds");
  uniqueStrings(result.conflictIds, context, "receipt.result.conflictIds");
  const nonClaims = object(item.nonClaims, context, "receipt.nonClaims");
  exact(nonClaims, ["semanticCorrectness", "translationQuality", "truthArbitration"], context, "receipt.nonClaims");
  literal(nonClaims.semanticCorrectness, "not_assessed", context, "receipt.nonClaims.semanticCorrectness");
  literal(nonClaims.translationQuality, "not_assessed", context, "receipt.nonClaims.translationQuality");
  literal(nonClaims.truthArbitration, "not_performed", context, "receipt.nonClaims.truthArbitration");
}
