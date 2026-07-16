import type {
  MediaScope,
  ParentArtifactAdmissionReceipt,
  ParentArtifactDispositionReceipt,
  ParentArtifactDispositionRequest,
  ParentArtifactReadGrant,
  ParentArtifactReadReceipt,
  ParentArtifactReadRequest,
  StudyClaim,
  StudyCoverageRange,
  StudyCoverageState,
  StudyReportArtifact,
  StudyReportCounts,
  StudyReportSubmissionBinding,
} from "../model.ts";
import { canonicalSha256 } from "../canonicalIdentity.ts";
import { validateSemanticEvidenceCitationInput } from "./semanticEvidence.ts";
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
import { STUDY_REPORT_LIMITS } from "../model.ts";

const COVERAGE_STATES = new Set(["supported", "withheld", "unknown", "failed"]);
const REASON_CODES = new Set([
  "semantic_evidence_unavailable",
  "semantic_evidence_empty",
  "insufficient_semantic_evidence",
  "worker_withheld",
  "operation_failed",
  "unobserved_range",
]);

function mediaScope(value: unknown, context: string, path: string): MediaScope {
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

function coverageRange(value: unknown, context: string, path: string): StudyCoverageRange {
  const item = object(value, context, path);
  exact(item, ["artifactId", "trackId", "startMs", "endMs", "state", "claimIds", "reason"], context, path);
  const range = mediaScope({
    artifactId: item.artifactId,
    trackId: item.trackId,
    startMs: item.startMs,
    endMs: item.endMs,
  }, context, path);
  const state = oneOf<StudyCoverageState>(item.state, COVERAGE_STATES, context, `${path}.state`);
  const claimIds = uniqueStrings(item.claimIds, context, `${path}.claimIds`);
  let reason: StudyCoverageRange["reason"] = null;
  if (item.reason !== null) {
    const found = object(item.reason, context, `${path}.reason`);
    exact(found, ["code", "detail"], context, `${path}.reason`);
    reason = {
      code: oneOf(found.code, REASON_CODES, context, `${path}.reason.code`),
      detail: string(found.detail, context, `${path}.reason.detail`),
    };
  }
  if (state === "supported" && (claimIds.length === 0 || reason !== null)) {
    fail(context, path, "supported coverage requires structured claims and no non-supported reason");
  }
  if (state !== "supported" && (claimIds.length !== 0 || reason === null)) {
    fail(context, path, "non-supported coverage requires one closed reason and no claims");
  }
  return { ...range, state, claimIds, reason };
}

function claim(value: unknown, context: string, path: string): StudyClaim {
  const item = object(value, context, path);
  exact(item, ["claimId", "artifactId", "trackId", "startMs", "endMs", "statement", "citations"], context, path);
  const range = mediaScope({
    artifactId: item.artifactId,
    trackId: item.trackId,
    startMs: item.startMs,
    endMs: item.endMs,
  }, context, path);
  const citations = array(item.citations, context, `${path}.citations`).map((citation, index) =>
    validateSemanticEvidenceCitationInput(citation, context, `${path}.citations[${index}]`));
  if (citations.length === 0 || citations.some((citation) => citation.observations.length === 0)) {
    fail(context, `${path}.citations`, "must cite exact semantic evidence and observation identities");
  }
  return {
    claimId: string(item.claimId, context, `${path}.claimId`),
    ...range,
    statement: string(item.statement, context, `${path}.statement`),
    citations,
  };
}

function sourceIdentities(value: unknown, context: string, path: string) {
  const result = array(value, context, path).map((candidate, index) => {
    const item = object(candidate, context, `${path}[${index}]`);
    exact(item, ["artifactId", "contentId"], context, `${path}[${index}]`);
    return {
      artifactId: string(item.artifactId, context, `${path}[${index}].artifactId`),
      contentId: contentId(item.contentId, context, `${path}[${index}].contentId`),
    };
  });
  if (new Set(result.map((identity) => identity.artifactId)).size !== result.length) {
    fail(context, path, "must not repeat artifact identities");
  }
  return result;
}

function validateLimits(value: unknown, context: string, path: string): void {
  const item = object(value, context, path);
  exact(item, ["maxArtifactBytes", "maxRanges", "maxClaims", "maxCitations", "maxObservationCitations"], context, path);
  for (const [key, expected] of Object.entries(STUDY_REPORT_LIMITS)) {
    if (item[key] !== expected) fail(context, `${path}.${key}`, `must equal ${expected}`);
  }
}

/** Structural validation only. Authority and citation reopening are enforced by the host/audit. */
export function validateStudyReportArtifact(
  value: unknown,
  context = "Study report",
  path = "artifact",
): StudyReportArtifact {
  const item = object(value, context, path);
  exact(item, ["schema", "runId", "task", "parent", "outputSlot", "assignment", "coverage", "claims", "semanticEvidenceInputs", "sourceArtifacts", "limits", "nonClaims"], context, path);
  literal(item.schema, "studio.study-report.v1", context, `${path}.schema`);
  const task = object(item.task, context, `${path}.task`);
  exact(task, ["taskId", "agentId", "jobContextId"], context, `${path}.task`);
  const parent = object(item.parent, context, `${path}.parent`);
  exact(parent, ["taskId", "agentId"], context, `${path}.parent`);
  const outputSlot = object(item.outputSlot, context, `${path}.outputSlot`);
  exact(outputSlot, ["name", "artifactKind"], context, `${path}.outputSlot`);
  const assignment = object(item.assignment, context, `${path}.assignment`);
  exact(assignment, ["source", "mediaScope"], context, `${path}.assignment`);
  const source = object(assignment.source, context, `${path}.assignment.source`);
  exact(source, ["artifactId", "contentId"], context, `${path}.assignment.source`);
  const mediaScopes = array(assignment.mediaScope, context, `${path}.assignment.mediaScope`)
    .map((scope, index) => mediaScope(scope, context, `${path}.assignment.mediaScope[${index}]`));
  const coverage = array(item.coverage, context, `${path}.coverage`)
    .map((range, index) => coverageRange(range, context, `${path}.coverage[${index}]`));
  const claims = array(item.claims, context, `${path}.claims`)
    .map((entry, index) => claim(entry, context, `${path}.claims[${index}]`));
  const semanticEvidenceInputs = array(item.semanticEvidenceInputs, context, `${path}.semanticEvidenceInputs`)
    .map((entry, index) => validateSemanticEvidenceCitationInput(entry, context, `${path}.semanticEvidenceInputs[${index}]`));
  if (semanticEvidenceInputs.length === 0 || new Set(semanticEvidenceInputs.map((entry) => entry.operationId)).size !== semanticEvidenceInputs.length) {
    fail(context, `${path}.semanticEvidenceInputs`, "must bind unique authenticated current-task semantic operations");
  }
  const sources = sourceIdentities(item.sourceArtifacts, context, `${path}.sourceArtifacts`);
  validateLimits(item.limits, context, `${path}.limits`);
  const nonClaims = object(item.nonClaims, context, `${path}.nonClaims`);
  exact(nonClaims, ["correctness", "completeness", "semanticQuality"], context, `${path}.nonClaims`);
  literal(nonClaims.correctness, "not_assessed", context, `${path}.nonClaims.correctness`);
  literal(nonClaims.completeness, "partition_only", context, `${path}.nonClaims.completeness`);
  literal(nonClaims.semanticQuality, "not_assessed", context, `${path}.nonClaims.semanticQuality`);
  if (coverage.length === 0 || coverage.length > STUDY_REPORT_LIMITS.maxRanges) fail(context, `${path}.coverage`, "exceeds its closed range count");
  if (claims.length > STUDY_REPORT_LIMITS.maxClaims) fail(context, `${path}.claims`, "exceeds its claim count");
  const citationCount = claims.reduce((sum, entry) => sum + entry.citations.length, 0);
  const observationCount = claims.reduce((sum, entry) => sum + entry.citations.reduce((subtotal, citation) => subtotal + citation.observations.length, 0), 0);
  if (citationCount > STUDY_REPORT_LIMITS.maxCitations || observationCount > STUDY_REPORT_LIMITS.maxObservationCitations) {
    fail(context, `${path}.claims`, "exceeds its citation ceilings");
  }
  const claimIds = claims.map((entry) => entry.claimId);
  if (new Set(claimIds).size !== claimIds.length) fail(context, `${path}.claims`, "must not repeat claim identities");
  const referenced = coverage.flatMap((range) => range.claimIds);
  if (new Set(referenced).size !== referenced.length || referenced.length !== claims.length ||
      referenced.some((id) => !claimIds.includes(id)) || claimIds.some((id) => !referenced.includes(id))) {
    fail(context, `${path}.coverage`, "must reference every structured claim exactly once");
  }
  return {
    schema: "studio.study-report.v1",
    runId: string(item.runId, context, `${path}.runId`),
    task: {
      taskId: string(task.taskId, context, `${path}.task.taskId`),
      agentId: string(task.agentId, context, `${path}.task.agentId`),
      jobContextId: string(task.jobContextId, context, `${path}.task.jobContextId`),
    },
    parent: {
      taskId: string(parent.taskId, context, `${path}.parent.taskId`),
      agentId: string(parent.agentId, context, `${path}.parent.agentId`),
    },
    outputSlot: {
      name: string(outputSlot.name, context, `${path}.outputSlot.name`),
      artifactKind: literal(outputSlot.artifactKind, "studio.study-report.v1", context, `${path}.outputSlot.artifactKind`),
    },
    assignment: {
      source: {
        artifactId: string(source.artifactId, context, `${path}.assignment.source.artifactId`),
        contentId: contentId(source.contentId, context, `${path}.assignment.source.contentId`),
      },
      mediaScope: mediaScopes,
    },
    coverage,
    claims,
    semanticEvidenceInputs,
    sourceArtifacts: sources,
    limits: STUDY_REPORT_LIMITS,
    nonClaims: { correctness: "not_assessed", completeness: "partition_only", semanticQuality: "not_assessed" },
  };
}

/** Requires exact ordered coverage of each assigned scope. Gaps, overlap, escape, and reordering fail. */
export function validateCoveragePartition(
  coverage: readonly StudyCoverageRange[],
  assigned: readonly MediaScope[],
  context = "Study report coverage",
): void {
  for (let index = 0; index < assigned.length; index += 1) {
    const scope = assigned[index];
    const prior = assigned[index - 1];
    if (!prior) continue;
    const priorKey = `${prior.artifactId}\u0000${prior.trackId}`;
    const key = `${scope.artifactId}\u0000${scope.trackId}`;
    if (key < priorKey || (key === priorKey && scope.startMs < prior.endMs)) {
      fail(context, `assigned[${index}]`, "is reordered or overlaps another assigned range");
    }
  }
  let offset = 0;
  for (const scope of assigned) {
    let cursor = scope.startMs;
    while (offset < coverage.length) {
      const range = coverage[offset];
      if (range.artifactId !== scope.artifactId || range.trackId !== scope.trackId) break;
      if (range.startMs !== cursor) {
        fail(context, `coverage[${offset}]`, range.startMs < cursor ? "overlaps prior coverage" : "leaves an uncovered gap");
      }
      if (range.endMs > scope.endMs) fail(context, `coverage[${offset}]`, "escapes the assigned media scope");
      cursor = range.endMs;
      offset += 1;
      if (cursor === scope.endMs) break;
    }
    if (cursor !== scope.endMs) fail(context, "coverage", "does not close the entire assigned media scope");
  }
  if (offset !== coverage.length) fail(context, `coverage[${offset}]`, "escapes or reorders the assigned media scope");
}

export function deriveStudyReportCounts(report: Pick<StudyReportArtifact, "coverage" | "claims">): StudyReportCounts {
  const ranges: StudyReportCounts["ranges"] = { supported: 0, withheld: 0, unknown: 0, failed: 0 };
  const durationMs: StudyReportCounts["durationMs"] = { supported: 0, withheld: 0, unknown: 0, failed: 0 };
  for (const range of report.coverage) {
    ranges[range.state] += 1;
    durationMs[range.state] += range.endMs - range.startMs;
  }
  return {
    ranges,
    durationMs,
    claims: report.claims.length,
    citations: report.claims.reduce((sum, entry) => sum + entry.citations.length, 0),
    observationCitations: report.claims.reduce((sum, entry) =>
      sum + entry.citations.reduce((subtotal, citation) => subtotal + citation.observations.length, 0), 0),
  };
}

function outputSlot(value: unknown, context: string, path: string) {
  const item = object(value, context, path);
  exact(item, ["name", "artifactKind"], context, path);
  return {
    name: string(item.name, context, `${path}.name`),
    artifactKind: literal(item.artifactKind, "studio.study-report.v1", context, `${path}.artifactKind`),
  } as const;
}

function counts(value: unknown, context: string, path: string): StudyReportCounts {
  const item = object(value, context, path);
  exact(item, ["ranges", "durationMs", "claims", "citations", "observationCitations"], context, path);
  const map = (candidate: unknown, candidatePath: string) => {
    const found = object(candidate, context, candidatePath);
    exact(found, ["supported", "withheld", "unknown", "failed"], context, candidatePath);
    return {
      supported: integer(found.supported, context, `${candidatePath}.supported`),
      withheld: integer(found.withheld, context, `${candidatePath}.withheld`),
      unknown: integer(found.unknown, context, `${candidatePath}.unknown`),
      failed: integer(found.failed, context, `${candidatePath}.failed`),
    };
  };
  return {
    ranges: map(item.ranges, `${path}.ranges`),
    durationMs: map(item.durationMs, `${path}.durationMs`),
    claims: integer(item.claims, context, `${path}.claims`),
    citations: integer(item.citations, context, `${path}.citations`),
    observationCitations: integer(item.observationCitations, context, `${path}.observationCitations`),
  };
}

export function validateStudyReportSubmissionBinding(value: unknown, context: string, path: string): StudyReportSubmissionBinding {
  const item = object(value, context, path);
  exact(item, ["schema", "jobContextId", "outputSlot", "coverage", "claims", "counts", "output", "sourceArtifacts", "executor", "parentEdge"], context, path);
  literal(item.schema, "studio.study-report-submission.v1", context, `${path}.schema`);
  const output = object(item.output, context, `${path}.output`);
  exact(output, ["artifactId", "contentId", "bytes", "schema"], context, `${path}.output`);
  const executor = object(item.executor, context, `${path}.executor`);
  exact(executor, ["executionId", "receiptId", "receiptContentId"], context, `${path}.executor`);
  const parentEdge = object(item.parentEdge, context, `${path}.parentEdge`);
  exact(parentEdge, ["childTaskId", "childAgentId", "parentTaskId", "parentAgentId"], context, `${path}.parentEdge`);
  return {
    schema: "studio.study-report-submission.v1",
    jobContextId: string(item.jobContextId, context, `${path}.jobContextId`),
    outputSlot: outputSlot(item.outputSlot, context, `${path}.outputSlot`),
    coverage: array(item.coverage, context, `${path}.coverage`).map((entry, index) => coverageRange(entry, context, `${path}.coverage[${index}]`)),
    claims: array(item.claims, context, `${path}.claims`).map((entry, index) => claim(entry, context, `${path}.claims[${index}]`)),
    counts: counts(item.counts, context, `${path}.counts`),
    output: {
      artifactId: string(output.artifactId, context, `${path}.output.artifactId`),
      contentId: contentId(output.contentId, context, `${path}.output.contentId`),
      bytes: integer(output.bytes, context, `${path}.output.bytes`, 1),
      schema: literal(output.schema, "studio.study-report.v1", context, `${path}.output.schema`),
    },
    sourceArtifacts: sourceIdentities(item.sourceArtifacts, context, `${path}.sourceArtifacts`),
    executor: {
      executionId: string(executor.executionId, context, `${path}.executor.executionId`),
      receiptId: string(executor.receiptId, context, `${path}.executor.receiptId`),
      receiptContentId: contentId(executor.receiptContentId, context, `${path}.executor.receiptContentId`),
    },
    parentEdge: {
      childTaskId: string(parentEdge.childTaskId, context, `${path}.parentEdge.childTaskId`),
      childAgentId: string(parentEdge.childAgentId, context, `${path}.parentEdge.childAgentId`),
      parentTaskId: string(parentEdge.parentTaskId, context, `${path}.parentEdge.parentTaskId`),
      parentAgentId: string(parentEdge.parentAgentId, context, `${path}.parentEdge.parentAgentId`),
    },
  };
}

export function assertParentArtifactDispositionRequest(value: unknown): asserts value is ParentArtifactDispositionRequest {
  const item = object(value, "Parent artifact disposition", "request");
  exact(item, ["reportId", "parentTaskId", "parentAgentId", "outputArtifactId", "outcome", "reason"], "Parent artifact disposition", "request");
  string(item.reportId, "Parent artifact disposition", "request.reportId");
  string(item.parentTaskId, "Parent artifact disposition", "request.parentTaskId");
  string(item.parentAgentId, "Parent artifact disposition", "request.parentAgentId");
  string(item.outputArtifactId, "Parent artifact disposition", "request.outputArtifactId");
  oneOf(item.outcome, new Set(["accepted", "rejected"]), "Parent artifact disposition", "request.outcome");
  string(item.reason, "Parent artifact disposition", "request.reason");
}

export function validateParentArtifactReadGrant(value: unknown, context: string, path: string): ParentArtifactReadGrant {
  const item = object(value, context, path);
  exact(item, ["schema", "id", "capability", "runId", "reportId", "dispositionId", "parentTaskId", "parentAgentId", "contentScope", "maxBytes", "maxItems"], context, path);
  const contentScope = array(item.contentScope, context, `${path}.contentScope`).map((candidate, index) => {
    const scope = object(candidate, context, `${path}.contentScope[${index}]`);
    exact(scope, ["artifactId", "contentId", "schema"], context, `${path}.contentScope[${index}]`);
    return {
      artifactId: string(scope.artifactId, context, `${path}.contentScope[${index}].artifactId`),
      contentId: contentId(scope.contentId, context, `${path}.contentScope[${index}].contentId`),
      schema: literal(scope.schema, "studio.study-report.v1", context, `${path}.contentScope[${index}].schema`),
    };
  });
  if (contentScope.length === 0 || new Set(contentScope.map((scope) => scope.contentId)).size !== contentScope.length) {
    fail(context, `${path}.contentScope`, "must contain unique admitted content identities");
  }
  return {
    schema: literal(item.schema, "studio.parent-artifact-read-grant.v1", context, `${path}.schema`),
    id: string(item.id, context, `${path}.id`),
    capability: literal(item.capability, "artifact.read", context, `${path}.capability`),
    runId: string(item.runId, context, `${path}.runId`),
    reportId: string(item.reportId, context, `${path}.reportId`),
    dispositionId: string(item.dispositionId, context, `${path}.dispositionId`),
    parentTaskId: string(item.parentTaskId, context, `${path}.parentTaskId`),
    parentAgentId: string(item.parentAgentId, context, `${path}.parentAgentId`),
    contentScope,
    maxBytes: integer(item.maxBytes, context, `${path}.maxBytes`, 1),
    maxItems: integer(item.maxItems, context, `${path}.maxItems`, 1),
  };
}

export function validateParentAdmissionReceipt(value: unknown, context: string, path: string): ParentArtifactAdmissionReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "admissionId", "dispositionId", "runId", "reportId", "parent", "child", "admitted", "grant", "nonClaims"], context, path);
  const parent = object(item.parent, context, `${path}.parent`);
  exact(parent, ["taskId", "agentId"], context, `${path}.parent`);
  const child = object(item.child, context, `${path}.child`);
  exact(child, ["taskId", "agentId", "jobContextId"], context, `${path}.child`);
  const nonClaims = object(item.nonClaims, context, `${path}.nonClaims`);
  exact(nonClaims, ["semanticQuality", "parentAgreement"], context, `${path}.nonClaims`);
  const grant = validateParentArtifactReadGrant(item.grant, context, `${path}.grant`);
  const admitted = array(item.admitted, context, `${path}.admitted`).map((entry, index) => {
    const found = object(entry, context, `${path}.admitted[${index}]`);
    exact(found, ["artifactId", "contentId", "schema"], context, `${path}.admitted[${index}]`);
    return {
      artifactId: string(found.artifactId, context, `${path}.admitted[${index}].artifactId`),
      contentId: contentId(found.contentId, context, `${path}.admitted[${index}].contentId`),
      schema: literal(found.schema, "studio.study-report.v1", context, `${path}.admitted[${index}].schema`),
    };
  });
  if (admitted.length === 0) fail(context, `${path}.admitted`, "must contain accepted content");
  return {
    schema: literal(item.schema, "studio.parent-admission.receipt.v1", context, `${path}.schema`),
    receiptId: string(item.receiptId, context, `${path}.receiptId`),
    admissionId: string(item.admissionId, context, `${path}.admissionId`),
    dispositionId: string(item.dispositionId, context, `${path}.dispositionId`),
    runId: string(item.runId, context, `${path}.runId`),
    reportId: string(item.reportId, context, `${path}.reportId`),
    parent: { taskId: string(parent.taskId, context, `${path}.parent.taskId`), agentId: string(parent.agentId, context, `${path}.parent.agentId`) },
    child: { taskId: string(child.taskId, context, `${path}.child.taskId`), agentId: string(child.agentId, context, `${path}.child.agentId`), jobContextId: string(child.jobContextId, context, `${path}.child.jobContextId`) },
    admitted,
    grant,
    nonClaims: {
      semanticQuality: literal(nonClaims.semanticQuality, "not_assessed", context, `${path}.nonClaims.semanticQuality`),
      parentAgreement: literal(nonClaims.parentAgreement, "not_claimed", context, `${path}.nonClaims.parentAgreement`),
    },
  };
}

export function validateParentArtifactDispositionReceipt(value: unknown, context: string, path: string): ParentArtifactDispositionReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "dispositionId", "runId", "report", "parent", "child", "output", "executor", "decision", "admission"], context, path);
  const report = object(item.report, context, `${path}.report`);
  exact(report, ["reportId", "status", "decisionReason"], context, `${path}.report`);
  const parent = object(item.parent, context, `${path}.parent`);
  exact(parent, ["taskId", "agentId"], context, `${path}.parent`);
  const child = object(item.child, context, `${path}.child`);
  exact(child, ["taskId", "agentId", "jobContextId"], context, `${path}.child`);
  const output = object(item.output, context, `${path}.output`);
  exact(output, ["artifactId", "contentId", "bytes", "schema", "outputSlot"], context, `${path}.output`);
  const executor = object(item.executor, context, `${path}.executor`);
  exact(executor, ["executionId", "receiptId", "receiptContentId"], context, `${path}.executor`);
  const decision = object(item.decision, context, `${path}.decision`);
  exact(decision, ["outcome", "reason"], context, `${path}.decision`);
  const status = oneOf<"accepted" | "rejected">(report.status, new Set(["accepted", "rejected"]), context, `${path}.report.status`);
  const outcome = oneOf<"accepted" | "rejected">(decision.outcome, new Set(["accepted", "rejected"]), context, `${path}.decision.outcome`);
  if (status !== outcome) fail(context, path, "must match the immutable report decision");
  let admission: ParentArtifactDispositionReceipt["admission"] = null;
  if (item.admission !== null) {
    const found = object(item.admission, context, `${path}.admission`);
    exact(found, ["admissionId", "receiptId", "receiptContentId", "artifactId", "grant"], context, `${path}.admission`);
    admission = {
      admissionId: string(found.admissionId, context, `${path}.admission.admissionId`),
      receiptId: string(found.receiptId, context, `${path}.admission.receiptId`),
      receiptContentId: contentId(found.receiptContentId, context, `${path}.admission.receiptContentId`),
      artifactId: string(found.artifactId, context, `${path}.admission.artifactId`),
      grant: validateParentArtifactReadGrant(found.grant, context, `${path}.admission.grant`),
    };
  }
  if ((outcome === "accepted") !== (admission !== null)) fail(context, `${path}.admission`, "must exist only for accepted content");
  return {
    schema: literal(item.schema, "studio.parent-artifact-disposition.receipt.v1", context, `${path}.schema`),
    receiptId: string(item.receiptId, context, `${path}.receiptId`),
    dispositionId: string(item.dispositionId, context, `${path}.dispositionId`),
    runId: string(item.runId, context, `${path}.runId`),
    report: { reportId: string(report.reportId, context, `${path}.report.reportId`), status, decisionReason: string(report.decisionReason, context, `${path}.report.decisionReason`) },
    parent: { taskId: string(parent.taskId, context, `${path}.parent.taskId`), agentId: string(parent.agentId, context, `${path}.parent.agentId`) },
    child: { taskId: string(child.taskId, context, `${path}.child.taskId`), agentId: string(child.agentId, context, `${path}.child.agentId`), jobContextId: string(child.jobContextId, context, `${path}.child.jobContextId`) },
    output: { artifactId: string(output.artifactId, context, `${path}.output.artifactId`), contentId: contentId(output.contentId, context, `${path}.output.contentId`), bytes: integer(output.bytes, context, `${path}.output.bytes`, 1), schema: literal(output.schema, "studio.study-report.v1", context, `${path}.output.schema`), outputSlot: outputSlot(output.outputSlot, context, `${path}.output.outputSlot`) },
    executor: { executionId: string(executor.executionId, context, `${path}.executor.executionId`), receiptId: string(executor.receiptId, context, `${path}.executor.receiptId`), receiptContentId: contentId(executor.receiptContentId, context, `${path}.executor.receiptContentId`) },
    decision: { outcome, reason: string(decision.reason, context, `${path}.decision.reason`) },
    admission,
  };
}

export function assertParentArtifactReadRequest(value: unknown): asserts value is ParentArtifactReadRequest {
  const item = object(value, "Parent artifact read", "request");
  exact(item, ["operationId", "parentTaskId", "parentAgentId", "grantId", "contentIds"], "Parent artifact read", "request");
  string(item.operationId, "Parent artifact read", "request.operationId");
  string(item.parentTaskId, "Parent artifact read", "request.parentTaskId");
  string(item.parentAgentId, "Parent artifact read", "request.parentAgentId");
  string(item.grantId, "Parent artifact read", "request.grantId");
  const ids = uniqueStrings(item.contentIds, "Parent artifact read", "request.contentIds");
  if (ids.length === 0) fail("Parent artifact read", "request.contentIds", "must contain exact admitted content ids");
  ids.forEach((id, index) => contentId(id, "Parent artifact read", `request.contentIds[${index}]`));
}

export function validateParentArtifactReadReceipt(value: unknown, context: string, path: string): ParentArtifactReadReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "operationId", "runId", "authorization", "requestedContentIds", "returned", "consumed", "ceilings"], context, path);
  const authorization = object(item.authorization, context, `${path}.authorization`);
  exact(authorization, ["grantId", "parentTaskId", "parentAgentId", "dispositionId"], context, `${path}.authorization`);
  const returned = array(item.returned, context, `${path}.returned`).map((candidate, index) => {
    const found = object(candidate, context, `${path}.returned[${index}]`);
    exact(found, ["artifactId", "contentId", "schema", "bytes"], context, `${path}.returned[${index}]`);
    return { artifactId: string(found.artifactId, context, `${path}.returned[${index}].artifactId`), contentId: contentId(found.contentId, context, `${path}.returned[${index}].contentId`), schema: literal(found.schema, "studio.study-report.v1", context, `${path}.returned[${index}].schema`), bytes: integer(found.bytes, context, `${path}.returned[${index}].bytes`, 1) };
  });
  const consumed = object(item.consumed, context, `${path}.consumed`);
  exact(consumed, ["bytes", "items"], context, `${path}.consumed`);
  const ceilings = object(item.ceilings, context, `${path}.ceilings`);
  exact(ceilings, ["maxBytes", "maxItems"], context, `${path}.ceilings`);
  const receipt: ParentArtifactReadReceipt = {
    schema: literal(item.schema, "studio.parent-artifact-read.receipt.v1", context, `${path}.schema`),
    receiptId: string(item.receiptId, context, `${path}.receiptId`),
    operationId: string(item.operationId, context, `${path}.operationId`),
    runId: string(item.runId, context, `${path}.runId`),
    authorization: { grantId: string(authorization.grantId, context, `${path}.authorization.grantId`), parentTaskId: string(authorization.parentTaskId, context, `${path}.authorization.parentTaskId`), parentAgentId: string(authorization.parentAgentId, context, `${path}.authorization.parentAgentId`), dispositionId: string(authorization.dispositionId, context, `${path}.authorization.dispositionId`) },
    requestedContentIds: uniqueStrings(item.requestedContentIds, context, `${path}.requestedContentIds`),
    returned,
    consumed: { bytes: integer(consumed.bytes, context, `${path}.consumed.bytes`, 1), items: integer(consumed.items, context, `${path}.consumed.items`, 1) },
    ceilings: { maxBytes: integer(ceilings.maxBytes, context, `${path}.ceilings.maxBytes`, 1), maxItems: integer(ceilings.maxItems, context, `${path}.ceilings.maxItems`, 1) },
  };
  const { schema: _schema, receiptId: _receiptId, ...body } = receipt;
  if (receipt.receiptId !== `parent-artifact-read-receipt:${canonicalSha256(body)}`) {
    fail(context, `${path}.receiptId`, "does not bind the exact path-free read result");
  }
  return receipt;
}
