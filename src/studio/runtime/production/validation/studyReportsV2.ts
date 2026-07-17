import type {
  EvidenceCitationKind,
  EvidenceCitationEnvelope,
  EvidenceCitationState,
  EvidenceCitationUse,
  GeneralizedCoverageRange,
  GeneralizedCoverageReasonCode,
  GeneralizedCoverageState,
  GeneralizedStudyClaim,
  ParentArtifactAdmissionReceiptV2,
  ParentArtifactReadReceiptV2,
  QualifiedMediaRange,
  StudyReportArtifactV2,
} from "../model.ts";
import { STUDY_REPORT_V2_LIMITS } from "../model.ts";
import { validateSupportedClaimCitationClosure } from "../evidenceCitations/audit.ts";
import { validateEvidenceCitationEnvelope } from "./evidenceCitations.ts";
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

const STATES = new Set<GeneralizedCoverageState>([
  "supported", "unknown", "withheld", "unavailable", "truncated", "conflicting", "failed", "not_in_scope",
]);
const REASONS = new Set<GeneralizedCoverageReasonCode>([
  "evidence_unknown", "worker_withheld", "evidence_unavailable", "evidence_truncated", "evidence_conflicting",
  "operation_failed", "not_in_requested_scope",
]);
const CITATION_KINDS = new Set<EvidenceCitationKind>([
  "current_run_speech", "acoustic_range", "frame_sample", "ocr_span", "speaker_turn", "external_document_span",
]);
const CITATION_STATES = new Set<EvidenceCitationState>([
  "available", "unknown", "withheld", "unavailable", "truncated", "conflicting", "failed", "not_in_scope",
]);
const CITATION_USES = new Set<EvidenceCitationUse>([
  "claim_support", "coverage_qualification", "cite_only",
]);

function range(value: unknown, context: string, path: string): QualifiedMediaRange {
  const item = object(value, context, path);
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

function sameRange(left: QualifiedMediaRange, right: QualifiedMediaRange): boolean {
  return left.artifactId === right.artifactId && left.trackId === right.trackId && left.startMs === right.startMs && left.endMs === right.endMs;
}

function coverage(value: unknown, context: string, path: string): GeneralizedCoverageRange {
  const item = object(value, context, path);
  exact(item, ["artifactId", "trackId", "startMs", "endMs", "state", "claimIds", "citationIds", "rawStates", "reason"], context, path);
  const state = oneOf<GeneralizedCoverageState>(item.state, STATES, context, `${path}.state`);
  const claimIds = uniqueStrings(item.claimIds, context, `${path}.claimIds`);
  const citationIds = uniqueStrings(item.citationIds, context, `${path}.citationIds`);
  const rawStates = uniqueStrings(item.rawStates, context, `${path}.rawStates`);
  let reason: GeneralizedCoverageRange["reason"] = null;
  if (item.reason !== null) {
    const found = object(item.reason, context, `${path}.reason`);
    exact(found, ["code", "detail"], context, `${path}.reason`);
    reason = {
      code: oneOf(found.code, REASONS, context, `${path}.reason.code`),
      detail: string(found.detail, context, `${path}.reason.detail`),
    };
  }
  if (state === "supported" && (claimIds.length === 0 || reason !== null || rawStates.length !== 0)) {
    fail(context, path, "supported coverage requires claims and no abstention reason/raw state");
  }
  if (state !== "supported" && (claimIds.length !== 0 || reason === null)) {
    fail(context, path, "non-supported coverage requires no claims and one closed reason");
  }
  if (state === "not_in_scope" && reason?.code !== "not_in_requested_scope") {
    fail(context, `${path}.reason`, "not-in-scope coverage requires the exact policy reason");
  }
  return { ...range(item, context, path), state, claimIds, citationIds, rawStates, reason };
}

function claim(value: unknown, context: string, path: string): GeneralizedStudyClaim {
  const item = object(value, context, path);
  exact(item, ["claimId", "artifactId", "trackId", "startMs", "endMs", "statement", "citationIds"], context, path);
  const citationIds = uniqueStrings(item.citationIds, context, `${path}.citationIds`);
  if (citationIds.length === 0) fail(context, `${path}.citationIds`, "must name exact generalized evidence citations");
  return {
    claimId: string(item.claimId, context, `${path}.claimId`),
    ...range(item, context, path),
    statement: string(item.statement, context, `${path}.statement`),
    citationIds,
  };
}

function sourceIdentities(value: unknown, context: string, path: string) {
  const result = array(value, context, path).map((entry, index) => {
    const item = object(entry, context, `${path}[${index}]`);
    exact(item, ["artifactId", "contentId"], context, `${path}[${index}]`);
    return {
      artifactId: string(item.artifactId, context, `${path}[${index}].artifactId`),
      contentId: contentId(item.contentId, context, `${path}[${index}].contentId`),
    };
  });
  if (new Set(result.map((entry) => entry.artifactId)).size !== result.length) fail(context, path, "must not repeat artifact identities");
  return result;
}

export function validateGeneralizedCoveragePartition(
  values: readonly QualifiedMediaRange[],
  assigned: readonly QualifiedMediaRange[],
  context = "Generalized coverage",
): void {
  let offset = 0;
  for (const scope of assigned) {
    let cursor = scope.startMs;
    while (offset < values.length) {
      const found = values[offset];
      if (found.artifactId !== scope.artifactId || found.trackId !== scope.trackId) break;
      if (found.startMs !== cursor || found.endMs > scope.endMs) fail(context, `coverage[${offset}]`, "leaves a gap, overlaps, or escapes assignment");
      cursor = found.endMs;
      offset += 1;
      if (cursor === scope.endMs) break;
    }
    if (cursor !== scope.endMs) fail(context, "coverage", "does not close the assigned scope");
  }
  if (offset !== values.length) fail(context, `coverage[${offset}]`, "escapes or reorders the assigned scope");
}

export function validateStudyReportArtifactV2(
  value: unknown,
  context = "Study report v2",
  path = "artifact",
): StudyReportArtifactV2 {
  const item = object(value, context, path);
  exact(item, [
    "schema", "runId", "task", "parent", "assignment", "coverage", "claims", "evidenceCitations",
    "sourceArtifacts", "limits", "nonClaims",
  ], context, path);
  literal(item.schema, "studio.study-report.v2", context, `${path}.schema`);
  const task = object(item.task, context, `${path}.task`);
  exact(task, ["taskId", "agentId", "executionId", "jobContextId"], context, `${path}.task`);
  const parent = object(item.parent, context, `${path}.parent`);
  exact(parent, ["taskId", "agentId"], context, `${path}.parent`);
  const assignment = object(item.assignment, context, `${path}.assignment`);
  exact(assignment, ["source", "mediaScope"], context, `${path}.assignment`);
  const assignmentSource = object(assignment.source, context, `${path}.assignment.source`);
  exact(assignmentSource, ["artifactId", "contentId"], context, `${path}.assignment.source`);
  const validatedAssignmentSource = {
    artifactId: string(assignmentSource.artifactId, context, `${path}.assignment.source.artifactId`),
    contentId: contentId(assignmentSource.contentId, context, `${path}.assignment.source.contentId`),
  };
  const mediaScope = array(assignment.mediaScope, context, `${path}.assignment.mediaScope`)
    .map((entry, index) => {
      const found = object(entry, context, `${path}.assignment.mediaScope[${index}]`);
      exact(found, ["artifactId", "trackId", "startMs", "endMs"], context, `${path}.assignment.mediaScope[${index}]`);
      return range(found, context, `${path}.assignment.mediaScope[${index}]`);
    });
  const coverageRanges = array(item.coverage, context, `${path}.coverage`)
    .map((entry, index) => coverage(entry, context, `${path}.coverage[${index}]`));
  const claims = array(item.claims, context, `${path}.claims`)
    .map((entry, index) => claim(entry, context, `${path}.claims[${index}]`));
  const citations = array(item.evidenceCitations, context, `${path}.evidenceCitations`)
    .map((entry, index) => validateEvidenceCitationEnvelope(entry, context, `${path}.evidenceCitations[${index}]`));
  const sources = sourceIdentities(item.sourceArtifacts, context, `${path}.sourceArtifacts`);
  const limits = object(item.limits, context, `${path}.limits`);
  exact(limits, Object.keys(STUDY_REPORT_V2_LIMITS), context, `${path}.limits`);
  for (const [key, expected] of Object.entries(STUDY_REPORT_V2_LIMITS)) {
    if (limits[key] !== expected) fail(context, `${path}.limits.${key}`, `must equal ${expected}`);
  }
  const nonClaims = object(item.nonClaims, context, `${path}.nonClaims`);
  exact(nonClaims, ["correctness", "completeness", "semanticQuality", "modalityReliabilityEquivalence", "independentCorroboration"], context, `${path}.nonClaims`);
  literal(nonClaims.correctness, "not_assessed", context, `${path}.nonClaims.correctness`);
  literal(nonClaims.completeness, "partition_only", context, `${path}.nonClaims.completeness`);
  literal(nonClaims.semanticQuality, "not_assessed", context, `${path}.nonClaims.semanticQuality`);
  literal(nonClaims.modalityReliabilityEquivalence, "not_claimed", context, `${path}.nonClaims.modalityReliabilityEquivalence`);
  literal(nonClaims.independentCorroboration, "not_assessed", context, `${path}.nonClaims.independentCorroboration`);
  if (coverageRanges.length === 0 || coverageRanges.length > STUDY_REPORT_V2_LIMITS.maxRanges ||
      claims.length > STUDY_REPORT_V2_LIMITS.maxClaims || citations.length > STUDY_REPORT_V2_LIMITS.maxCitations ||
      citations.reduce((sum, citation) => sum + citation.observations.length, 0) > STUDY_REPORT_V2_LIMITS.maxObservationCitations) {
    fail(context, path, "exceeds a closed report-v2 count ceiling");
  }
  validateGeneralizedCoveragePartition(coverageRanges, mediaScope, `${context} coverage`);
  const citationById = new Map(citations.map((entry) => [entry.citationId, entry]));
  if (citationById.size !== citations.length) fail(context, `${path}.evidenceCitations`, "must not repeat citation identities");
  const claimById = new Map(claims.map((entry) => [entry.claimId, entry]));
  if (claimById.size !== claims.length) fail(context, `${path}.claims`, "must not repeat claim identities");
  const referencedClaims = coverageRanges.flatMap((entry) => entry.claimIds);
  if (new Set(referencedClaims).size !== referencedClaims.length || referencedClaims.length !== claims.length ||
      referencedClaims.some((id) => !claimById.has(id))) fail(context, `${path}.coverage`, "must reference each claim exactly once");
  for (const candidate of claims) {
    const supporting = candidate.citationIds.map((id) => citationById.get(id));
    if (supporting.some((entry) => !entry)) fail(context, `${path}.claims`, `claim ${candidate.claimId} names an absent citation`);
    const typed = supporting as EvidenceCitationEnvelope[];
    if (typed.some((entry) => entry.target.kind !== "claim" || entry.target.claimId !== candidate.claimId || !sameRange(entry.target.range, candidate))) {
      fail(context, `${path}.claims`, `claim ${candidate.claimId} citation target changed`);
    }
    validateSupportedClaimCitationClosure(candidate.claimId, candidate, typed);
  }
  for (const covered of coverageRanges) {
    const linked = covered.citationIds.map((id) => citationById.get(id));
    if (linked.some((entry) => !entry) || linked.some((entry) => entry!.target.kind !== "coverage" || !sameRange(entry!.target.range, covered))) {
      fail(context, `${path}.coverage`, "coverage citation targets must close the exact range");
    }
    if (covered.state === "supported") {
      for (const claimId of covered.claimIds) {
        const found = claimById.get(claimId);
        if (!found || !sameRange(found, covered)) fail(context, `${path}.coverage`, "supported claim changed its exact coverage range");
      }
    }
  }
  for (const citation of citations) {
    if (citation.target.kind === "claim" && !claimById.get(citation.target.claimId)?.citationIds.includes(citation.citationId)) {
      fail(context, `${path}.evidenceCitations`, "claim citation is not linked by its exact target claim");
    }
    if (citation.target.kind === "coverage") {
      const coverageTarget = citation.target.range;
      if (!coverageRanges.some((entry) => sameRange(entry, coverageTarget) && entry.citationIds.includes(citation.citationId))) {
        fail(context, `${path}.evidenceCitations`, "coverage citation is not linked by its exact target range");
      }
    }
  }
  const expectedSources = new Map<string, string>();
  expectedSources.set(validatedAssignmentSource.artifactId, validatedAssignmentSource.contentId);
  for (const citation of citations) {
    expectedSources.set(citation.evidence.artifactId, citation.evidence.contentId);
    if (citation.receipt.artifactId) expectedSources.set(citation.receipt.artifactId, citation.receipt.contentId);
  }
  const expectedSourceList = [...expectedSources.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([artifactId, foundContentId]) => ({ artifactId, contentId: foundContentId }));
  if (JSON.stringify(sources) !== JSON.stringify(expectedSourceList)) {
    fail(context, `${path}.sourceArtifacts`, "must be exact lineage only; it cannot add generic support sources");
  }
  return {
    schema: "studio.study-report.v2",
    runId: string(item.runId, context, `${path}.runId`),
    task: {
      taskId: string(task.taskId, context, `${path}.task.taskId`),
      agentId: string(task.agentId, context, `${path}.task.agentId`),
      executionId: string(task.executionId, context, `${path}.task.executionId`),
      jobContextId: string(task.jobContextId, context, `${path}.task.jobContextId`),
    },
    parent: {
      taskId: string(parent.taskId, context, `${path}.parent.taskId`),
      agentId: string(parent.agentId, context, `${path}.parent.agentId`),
    },
    assignment: {
      source: validatedAssignmentSource,
      mediaScope,
    },
    coverage: coverageRanges,
    claims,
    evidenceCitations: citations,
    sourceArtifacts: sources,
    limits: STUDY_REPORT_V2_LIMITS,
    nonClaims: {
      correctness: "not_assessed", completeness: "partition_only", semanticQuality: "not_assessed",
      modalityReliabilityEquivalence: "not_claimed", independentCorroboration: "not_assessed",
    },
  };
}

function studyIdentity(value: unknown, context: string, path: string) {
  const item = object(value, context, path);
  exact(item, ["artifactId", "contentId", "bytes", "schema"], context, path);
  return {
    artifactId: string(item.artifactId, context, `${path}.artifactId`),
    contentId: contentId(item.contentId, context, `${path}.contentId`),
    bytes: integer(item.bytes, context, `${path}.bytes`, 1),
    schema: literal(item.schema, "studio.study-report.v2", context, `${path}.schema`),
  };
}

export function validateParentArtifactAdmissionReceiptV2(value: unknown): ParentArtifactAdmissionReceiptV2 {
  const context = "Parent admission v2";
  const item = object(value, context, "receipt");
  exact(item, ["schema", "receiptId", "admissionId", "runId", "report", "task", "parent", "auditedCitations", "coverage", "producer", "nonClaims"], context, "receipt");
  literal(item.schema, "studio.parent-admission.receipt.v2", context, "receipt.schema");
  const task = object(item.task, context, "receipt.task"); exact(task, ["taskId", "agentId", "executionId", "jobContextId"], context, "receipt.task");
  const parent = object(item.parent, context, "receipt.parent"); exact(parent, ["taskId", "agentId"], context, "receipt.parent");
  const producer = object(item.producer, context, "receipt.producer"); exact(producer, ["id", "version", "policy"], context, "receipt.producer");
  const nonClaims = object(item.nonClaims, context, "receipt.nonClaims"); exact(nonClaims, ["semanticQuality", "parentAgreement", "truthArbitration"], context, "receipt.nonClaims");
  const auditedCitations = array(item.auditedCitations, context, "receipt.auditedCitations").map((entry, index) => {
    const found = object(entry, context, `receipt.auditedCitations[${index}]`); exact(found, ["citationId", "evidenceKind", "use", "upstreamState"], context, `receipt.auditedCitations[${index}]`);
    return {
      citationId: string(found.citationId, context, `receipt.auditedCitations[${index}].citationId`),
      evidenceKind: oneOf<EvidenceCitationKind>(found.evidenceKind, CITATION_KINDS, context, `receipt.auditedCitations[${index}].evidenceKind`),
      use: oneOf<EvidenceCitationUse>(found.use, CITATION_USES, context, `receipt.auditedCitations[${index}].use`),
      upstreamState: oneOf<EvidenceCitationState>(found.upstreamState, CITATION_STATES, context, `receipt.auditedCitations[${index}].upstreamState`),
    };
  });
  const covered = array(item.coverage, context, "receipt.coverage").map((entry, index) => {
    const found = object(entry, context, `receipt.coverage[${index}]`); exact(found, ["range", "state", "rawStates"], context, `receipt.coverage[${index}]`);
    return { range: range(found.range, context, `receipt.coverage[${index}].range`), state: oneOf<GeneralizedCoverageState>(found.state, STATES, context, `receipt.coverage[${index}].state`), rawStates: uniqueStrings(found.rawStates, context, `receipt.coverage[${index}].rawStates`) };
  });
  return {
    schema: "studio.parent-admission.receipt.v2",
    receiptId: string(item.receiptId, context, "receipt.receiptId"), admissionId: string(item.admissionId, context, "receipt.admissionId"), runId: string(item.runId, context, "receipt.runId"),
    report: studyIdentity(item.report, context, "receipt.report"),
    task: { taskId: string(task.taskId, context, "receipt.task.taskId"), agentId: string(task.agentId, context, "receipt.task.agentId"), executionId: string(task.executionId, context, "receipt.task.executionId"), jobContextId: string(task.jobContextId, context, "receipt.task.jobContextId") },
    parent: { taskId: string(parent.taskId, context, "receipt.parent.taskId"), agentId: string(parent.agentId, context, "receipt.parent.agentId") },
    auditedCitations, coverage: covered,
    producer: { id: literal(producer.id, "studio.generalized-evidence-admission", context, "receipt.producer.id"), version: literal(producer.version, "2", context, "receipt.producer.version"), policy: literal(producer.policy, "audit_each_kind_and_preserve_exact_states", context, "receipt.producer.policy") },
    nonClaims: { semanticQuality: literal(nonClaims.semanticQuality, "not_assessed", context, "receipt.nonClaims.semanticQuality"), parentAgreement: literal(nonClaims.parentAgreement, "not_claimed", context, "receipt.nonClaims.parentAgreement"), truthArbitration: literal(nonClaims.truthArbitration, "not_performed", context, "receipt.nonClaims.truthArbitration") },
  };
}

export function validateParentArtifactReadReceiptV2(value: unknown): ParentArtifactReadReceiptV2 {
  const context = "Parent artifact read v2";
  const item = object(value, context, "receipt"); exact(item, ["schema", "receiptId", "operationId", "runId", "admission", "returned", "producer"], context, "receipt");
  const admission = object(item.admission, context, "receipt.admission"); exact(admission, ["admissionId", "receiptId", "receiptContentId"], context, "receipt.admission");
  const producer = object(item.producer, context, "receipt.producer"); exact(producer, ["id", "version", "policy"], context, "receipt.producer");
  return {
    schema: literal(item.schema, "studio.parent-artifact-read.receipt.v2", context, "receipt.schema"), receiptId: string(item.receiptId, context, "receipt.receiptId"), operationId: string(item.operationId, context, "receipt.operationId"), runId: string(item.runId, context, "receipt.runId"),
    admission: { admissionId: string(admission.admissionId, context, "receipt.admission.admissionId"), receiptId: string(admission.receiptId, context, "receipt.admission.receiptId"), receiptContentId: contentId(admission.receiptContentId, context, "receipt.admission.receiptContentId") },
    returned: studyIdentity(item.returned, context, "receipt.returned"),
    producer: { id: literal(producer.id, "studio.generalized-evidence-read", context, "receipt.producer.id"), version: literal(producer.version, "2", context, "receipt.producer.version"), policy: literal(producer.policy, "content_addressed_admitted_report_only", context, "receipt.producer.policy") },
  };
}
