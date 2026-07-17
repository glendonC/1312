import type {
  AdmittedStudyReportV2,
  EvidenceCitationEnvelope,
  EvidenceCitationState,
  GeneralizedCoverageState,
  OwnedMediaStudyArtifactV2,
  OwnedMediaStudyClaimV2,
  OwnedMediaStudyCoverageRangeV2,
  OwnedMediaStudyExecutorReceiptV2,
  QualifiedMediaRange,
  StudyReadinessReceiptV3,
} from "../model.ts";
import { OWNED_MEDIA_STUDY_V2_LIMITS } from "../model.ts";
import { validateEvidenceCitationEnvelope } from "./evidenceCitations.ts";
import { validateGeneralizedCoveragePartition } from "./studyReportsV2.ts";
import {
  array, contentId, exact, fail, integer, literal, object, oneOf, string, uniqueStrings,
} from "./primitives.ts";

const STATES = new Set<GeneralizedCoverageState>([
  "supported", "unknown", "withheld", "unavailable", "truncated", "conflicting", "failed", "not_in_scope",
]);
const REASON_CODES = new Set([
  "evidence_unknown", "worker_withheld", "evidence_unavailable", "evidence_truncated", "evidence_conflicting",
  "operation_failed", "not_in_requested_scope",
]);
const READINESS_REASONS = new Set<StudyReadinessReceiptV3["result"]["reasonCodes"][number]>([
  "non_supported_root_coverage", "unresolved_conflict", "hidden_gap", "stored_content_integrity_failed",
]);
const READINESS_STATES = new Set<GeneralizedCoverageState | EvidenceCitationState>([
  "available", "supported", "unknown", "withheld", "unavailable", "truncated", "conflicting", "failed", "not_in_scope",
]);

function range(value: unknown, context: string, path: string): QualifiedMediaRange {
  const item = object(value, context, path);
  const startMs = integer(item.startMs, context, `${path}.startMs`);
  const endMs = integer(item.endMs, context, `${path}.endMs`, 1);
  if (endMs <= startMs) fail(context, path, "must be a non-empty half-open range");
  return { artifactId: string(item.artifactId, context, `${path}.artifactId`), trackId: string(item.trackId, context, `${path}.trackId`), startMs, endMs };
}

function sameRange(left: QualifiedMediaRange, right: QualifiedMediaRange): boolean {
  return left.artifactId === right.artifactId && left.trackId === right.trackId && left.startMs === right.startMs && left.endMs === right.endMs;
}

function reportIdentity(value: unknown, context: string, path: string): AdmittedStudyReportV2 {
  const item = object(value, context, path); exact(item, ["report", "admission"], context, path);
  const report = object(item.report, context, `${path}.report`); exact(report, ["artifactId", "contentId", "bytes", "schema"], context, `${path}.report`);
  const admission = object(item.admission, context, `${path}.admission`); exact(admission, ["admissionId", "receiptId", "receiptContentId"], context, `${path}.admission`);
  return {
    report: { artifactId: string(report.artifactId, context, `${path}.report.artifactId`), contentId: contentId(report.contentId, context, `${path}.report.contentId`), bytes: integer(report.bytes, context, `${path}.report.bytes`, 1), schema: literal(report.schema, "studio.study-report.v2", context, `${path}.report.schema`) },
    admission: { admissionId: string(admission.admissionId, context, `${path}.admission.admissionId`), receiptId: string(admission.receiptId, context, `${path}.admission.receiptId`), receiptContentId: contentId(admission.receiptContentId, context, `${path}.admission.receiptContentId`) },
  };
}

function coverage(value: unknown, context: string, path: string): OwnedMediaStudyCoverageRangeV2 {
  const item = object(value, context, path);
  exact(item, ["coverageId", "artifactId", "trackId", "startMs", "endMs", "state", "preservedStates", "rawStates", "claimIds", "citationIds", "reason"], context, path);
  const state = oneOf<GeneralizedCoverageState>(item.state, STATES, context, `${path}.state`);
  const preservedStates = uniqueStrings(item.preservedStates, context, `${path}.preservedStates`).map((entry) => oneOf<GeneralizedCoverageState>(entry, STATES, context, `${path}.preservedStates`));
  if (preservedStates.length === 0 || preservedStates.length > OWNED_MEDIA_STUDY_V2_LIMITS.maxPreservedStatesPerRange || !preservedStates.includes(state)) {
    fail(context, `${path}.preservedStates`, "must retain the output state and stay inside the closed ceiling");
  }
  const claimIds = uniqueStrings(item.claimIds, context, `${path}.claimIds`);
  let reason: OwnedMediaStudyCoverageRangeV2["reason"] = null;
  if (item.reason !== null) {
    const found = object(item.reason, context, `${path}.reason`); exact(found, ["code", "detail"], context, `${path}.reason`);
    reason = { code: oneOf(found.code, REASON_CODES, context, `${path}.reason.code`), detail: string(found.detail, context, `${path}.reason.detail`) };
  }
  if (state === "supported" && (claimIds.length === 0 || reason !== null || preservedStates.some((entry) => entry !== "supported"))) {
    fail(context, path, "supported study coverage cannot retain a weak, conflicting, failed, or out-of-scope state");
  }
  if (state !== "supported" && (claimIds.length !== 0 || reason === null)) fail(context, path, "non-supported study coverage requires no claims and one reason");
  return { coverageId: string(item.coverageId, context, `${path}.coverageId`), ...range(item, context, path), state, preservedStates, rawStates: uniqueStrings(item.rawStates, context, `${path}.rawStates`), claimIds, citationIds: uniqueStrings(item.citationIds, context, `${path}.citationIds`), reason };
}

function claim(value: unknown, context: string, path: string): OwnedMediaStudyClaimV2 {
  const item = object(value, context, path);
  exact(item, ["claimId", "artifactId", "trackId", "startMs", "endMs", "statement", "childClaims", "citationIds"], context, path);
  const childClaims = array(item.childClaims, context, `${path}.childClaims`).map((entry, index) => {
    const found = object(entry, context, `${path}.childClaims[${index}]`); exact(found, ["admissionId", "reportArtifactId", "reportContentId", "claimId"], context, `${path}.childClaims[${index}]`);
    return { admissionId: string(found.admissionId, context, `${path}.childClaims[${index}].admissionId`), reportArtifactId: string(found.reportArtifactId, context, `${path}.childClaims[${index}].reportArtifactId`), reportContentId: contentId(found.reportContentId, context, `${path}.childClaims[${index}].reportContentId`), claimId: string(found.claimId, context, `${path}.childClaims[${index}].claimId`) };
  });
  if (childClaims.length === 0) fail(context, `${path}.childClaims`, "must cite exact admitted child claims");
  const citationIds = uniqueStrings(item.citationIds, context, `${path}.citationIds`);
  if (citationIds.length === 0) fail(context, `${path}.citationIds`, "must retain exact evidence citations");
  return { claimId: string(item.claimId, context, `${path}.claimId`), ...range(item, context, path), statement: string(item.statement, context, `${path}.statement`), childClaims, citationIds };
}

function closesRange(rangeValue: QualifiedMediaRange, citations: EvidenceCitationEnvelope[]): boolean {
  const observations = citations.flatMap((citation) => citation.observations)
    .filter((entry) => entry.state === "available" && entry.locator.kind === "temporal_range")
    .map((entry) => entry.locator.kind === "temporal_range" ? entry.locator.media : null)
    .filter((entry): entry is QualifiedMediaRange => entry !== null && entry.artifactId === rangeValue.artifactId && entry.trackId === rangeValue.trackId && entry.endMs > rangeValue.startMs && entry.startMs < rangeValue.endMs)
    .map((entry) => ({ ...entry, startMs: Math.max(entry.startMs, rangeValue.startMs), endMs: Math.min(entry.endMs, rangeValue.endMs) }))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  let cursor = rangeValue.startMs;
  for (const found of observations) {
    if (found.startMs > cursor) return false;
    cursor = Math.max(cursor, found.endMs);
    if (cursor >= rangeValue.endMs) return true;
  }
  return false;
}

export function validateOwnedMediaStudyArtifactV2(value: unknown): OwnedMediaStudyArtifactV2 {
  const context = "Owned-media study v2";
  const item = object(value, context, "artifact");
  exact(item, ["schema", "runId", "root", "reports", "coverage", "claims", "evidenceCitations", "sourceArtifacts", "limits", "nonClaims"], context, "artifact");
  literal(item.schema, "studio.owned-media-study.v2", context, "artifact.schema");
  const root = object(item.root, context, "artifact.root"); exact(root, ["taskId", "agentId", "executionId", "jobContextId", "source", "mediaScope"], context, "artifact.root");
  const source = object(root.source, context, "artifact.root.source"); exact(source, ["artifactId", "contentId"], context, "artifact.root.source");
  const mediaScope = array(root.mediaScope, context, "artifact.root.mediaScope").map((entry, index) => { const found = object(entry, context, `artifact.root.mediaScope[${index}]`); exact(found, ["artifactId", "trackId", "startMs", "endMs"], context, `artifact.root.mediaScope[${index}]`); return range(found, context, `artifact.root.mediaScope[${index}]`); });
  const reports = array(item.reports, context, "artifact.reports").map((entry, index) => reportIdentity(entry, context, `artifact.reports[${index}]`));
  const coverageRanges = array(item.coverage, context, "artifact.coverage").map((entry, index) => coverage(entry, context, `artifact.coverage[${index}]`));
  const claims = array(item.claims, context, "artifact.claims").map((entry, index) => claim(entry, context, `artifact.claims[${index}]`));
  const citations = array(item.evidenceCitations, context, "artifact.evidenceCitations").map((entry, index) => validateEvidenceCitationEnvelope(entry, context, `artifact.evidenceCitations[${index}]`));
  const sources = array(item.sourceArtifacts, context, "artifact.sourceArtifacts").map((entry, index) => { const found = object(entry, context, `artifact.sourceArtifacts[${index}]`); exact(found, ["artifactId", "contentId"], context, `artifact.sourceArtifacts[${index}]`); return { artifactId: string(found.artifactId, context, `artifact.sourceArtifacts[${index}].artifactId`), contentId: contentId(found.contentId, context, `artifact.sourceArtifacts[${index}].contentId`) }; });
  const limits = object(item.limits, context, "artifact.limits"); exact(limits, Object.keys(OWNED_MEDIA_STUDY_V2_LIMITS), context, "artifact.limits"); for (const [key, expected] of Object.entries(OWNED_MEDIA_STUDY_V2_LIMITS)) if (limits[key] !== expected) fail(context, `artifact.limits.${key}`, `must equal ${expected}`);
  const nonClaims = object(item.nonClaims, context, "artifact.nonClaims"); exact(nonClaims, ["semanticCorrectness", "translationQuality", "truthArbitration", "modalityReliabilityEquivalence", "independentCorroboration", "publication"], context, "artifact.nonClaims");
  if (reports.length === 0 || reports.length > OWNED_MEDIA_STUDY_V2_LIMITS.maxReports || coverageRanges.length === 0 || coverageRanges.length > OWNED_MEDIA_STUDY_V2_LIMITS.maxCoverageRanges || claims.length > OWNED_MEDIA_STUDY_V2_LIMITS.maxClaims || citations.length > OWNED_MEDIA_STUDY_V2_LIMITS.maxCitations) fail(context, "artifact", "exceeds a closed study-v2 count ceiling");
  validateGeneralizedCoveragePartition(coverageRanges, mediaScope, "Owned-media study v2 coverage");
  const citationById = new Map(citations.map((entry) => [entry.citationId, entry])); if (citationById.size !== citations.length) fail(context, "artifact.evidenceCitations", "repeats citation identities");
  const claimById = new Map(claims.map((entry) => [entry.claimId, entry])); if (claimById.size !== claims.length) fail(context, "artifact.claims", "repeats claim identities");
  const referencedClaims = coverageRanges.flatMap((entry) => entry.claimIds); if (new Set(referencedClaims).size !== referencedClaims.length || referencedClaims.length !== claims.length || referencedClaims.some((id) => !claimById.has(id))) fail(context, "artifact.coverage", "must reference every claim exactly once");
  for (const studyClaim of claims) {
    const claimCitations = studyClaim.citationIds.map((id) => citationById.get(id)).filter((entry): entry is EvidenceCitationEnvelope => Boolean(entry));
    if (claimCitations.length !== studyClaim.citationIds.length || claimCitations.some((entry) => {
      if (entry.use !== "claim_support" || entry.target.kind !== "claim") return true;
      const targetClaimId = entry.target.claimId;
      return !studyClaim.childClaims.some((child) => child.claimId === targetClaimId);
    })) fail(context, "artifact.claims", `claim ${studyClaim.claimId} changed child citation targets`);
    if (!closesRange(studyClaim, claimCitations)) fail(context, "artifact.claims", `claim ${studyClaim.claimId} lacks range-closing speech observations`);
  }
  for (const covered of coverageRanges) {
    if (covered.state === "supported" && covered.claimIds.some((id) => !claimById.has(id))) fail(context, "artifact.coverage", "supported coverage names an absent claim");
    const coverageCitations = covered.citationIds.map((id) => citationById.get(id));
    if (coverageCitations.some((entry) => !entry || entry.target.kind !== "coverage" || !sameRange(entry.target.range, covered))) fail(context, "artifact.coverage", "coverage citation changed its exact range target");
  }
  for (const citation of citations) {
    const linked = citation.target.kind === "media_context" || claims.some((entry) => entry.citationIds.includes(citation.citationId)) || coverageRanges.some((entry) => entry.citationIds.includes(citation.citationId));
    if (!linked) fail(context, "artifact.evidenceCitations", "contains an unassociated generic citation");
  }
  const expectedSources = new Map<string, string>();
  expectedSources.set(string(source.artifactId, context, "artifact.root.source.artifactId"), contentId(source.contentId, context, "artifact.root.source.contentId"));
  for (const report of reports) expectedSources.set(report.report.artifactId, report.report.contentId);
  for (const citation of citations) { expectedSources.set(citation.evidence.artifactId, citation.evidence.contentId); if (citation.receipt.artifactId) expectedSources.set(citation.receipt.artifactId, citation.receipt.contentId); }
  const expectedSourceList = [...expectedSources.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([artifactId, foundContentId]) => ({ artifactId, contentId: foundContentId }));
  if (JSON.stringify(sources) !== JSON.stringify(expectedSourceList)) fail(context, "artifact.sourceArtifacts", "must contain exact lineage only");
  literal(nonClaims.semanticCorrectness, "not_assessed", context, "artifact.nonClaims.semanticCorrectness"); literal(nonClaims.translationQuality, "not_assessed", context, "artifact.nonClaims.translationQuality"); literal(nonClaims.truthArbitration, "not_performed", context, "artifact.nonClaims.truthArbitration"); literal(nonClaims.modalityReliabilityEquivalence, "not_claimed", context, "artifact.nonClaims.modalityReliabilityEquivalence"); literal(nonClaims.independentCorroboration, "not_assessed", context, "artifact.nonClaims.independentCorroboration"); literal(nonClaims.publication, "not_authorized", context, "artifact.nonClaims.publication");
  return { schema: "studio.owned-media-study.v2", runId: string(item.runId, context, "artifact.runId"), root: { taskId: string(root.taskId, context, "artifact.root.taskId"), agentId: string(root.agentId, context, "artifact.root.agentId"), executionId: string(root.executionId, context, "artifact.root.executionId"), jobContextId: string(root.jobContextId, context, "artifact.root.jobContextId"), source: expectedSourceList.find((entry) => entry.artifactId === source.artifactId)!, mediaScope }, reports, coverage: coverageRanges, claims, evidenceCitations: citations, sourceArtifacts: sources, limits: OWNED_MEDIA_STUDY_V2_LIMITS, nonClaims: { semanticCorrectness: "not_assessed", translationQuality: "not_assessed", truthArbitration: "not_performed", modalityReliabilityEquivalence: "not_claimed", independentCorroboration: "not_assessed", publication: "not_authorized" } };
}

function studyIdentity(value: unknown, context: string, path: string) {
  const item = object(value, context, path); exact(item, ["studyId", "artifactId", "contentId", "bytes", "schema"], context, path);
  return { studyId: string(item.studyId, context, `${path}.studyId`), artifactId: string(item.artifactId, context, `${path}.artifactId`), contentId: contentId(item.contentId, context, `${path}.contentId`), bytes: integer(item.bytes, context, `${path}.bytes`, 1), schema: literal(item.schema, "studio.owned-media-study.v2", context, `${path}.schema`) };
}

export function validateOwnedMediaStudyExecutorReceiptV2(value: unknown): OwnedMediaStudyExecutorReceiptV2 {
  const context = "Owned-media study executor receipt v2"; const item = object(value, context, "receipt"); exact(item, ["schema", "receiptId", "runId", "input", "output", "producer", "nonClaims"], context, "receipt");
  const input = object(item.input, context, "receipt.input"); exact(input, ["reportArtifactIds", "admissionIds"], context, "receipt.input");
  const producer = object(item.producer, context, "receipt.producer"); exact(producer, ["id", "version", "policy"], context, "receipt.producer");
  const nonClaims = object(item.nonClaims, context, "receipt.nonClaims"); exact(nonClaims, ["semanticCorrectness", "truthArbitration"], context, "receipt.nonClaims");
  return { schema: literal(item.schema, "studio.owned-media-study.executor-receipt.v2", context, "receipt.schema"), receiptId: string(item.receiptId, context, "receipt.receiptId"), runId: string(item.runId, context, "receipt.runId"), input: { reportArtifactIds: uniqueStrings(input.reportArtifactIds, context, "receipt.input.reportArtifactIds"), admissionIds: uniqueStrings(input.admissionIds, context, "receipt.input.admissionIds") }, output: studyIdentity(item.output, context, "receipt.output"), producer: { id: literal(producer.id, "studio.generalized-study-synthesis", context, "receipt.producer.id"), version: literal(producer.version, "2", context, "receipt.producer.version"), policy: literal(producer.policy, "preserve_all_admitted_states_and_copy_only_audited_citations", context, "receipt.producer.policy") }, nonClaims: { semanticCorrectness: literal(nonClaims.semanticCorrectness, "not_assessed", context, "receipt.nonClaims.semanticCorrectness"), truthArbitration: literal(nonClaims.truthArbitration, "not_performed", context, "receipt.nonClaims.truthArbitration") } };
}

export function validateStudyReadinessReceiptV3(value: unknown): StudyReadinessReceiptV3 {
  const context = "Study readiness receipt v3"; const item = object(value, context, "receipt"); exact(item, ["schema", "receiptId", "readinessId", "runId", "input", "reopened", "producer", "result", "nonClaims"], context, "receipt");
  const reopened = object(item.reopened, context, "receipt.reopened"); exact(reopened, ["reportArtifactIds", "admissionIds", "evidenceArtifactIds", "evidenceReceiptContentIds"], context, "receipt.reopened");
  const producer = object(item.producer, context, "receipt.producer"); exact(producer, ["id", "version", "policy"], context, "receipt.producer");
  const result = object(item.result, context, "receipt.result"); exact(result, ["outcome", "reasonCodes", "states", "coverageIds"], context, "receipt.result");
  const nonClaims = object(item.nonClaims, context, "receipt.nonClaims"); exact(nonClaims, ["semanticCorrectness", "translationQuality", "truthArbitration"], context, "receipt.nonClaims");
  return { schema: literal(item.schema, "studio.study-readiness.receipt.v3", context, "receipt.schema"), receiptId: string(item.receiptId, context, "receipt.receiptId"), readinessId: string(item.readinessId, context, "receipt.readinessId"), runId: string(item.runId, context, "receipt.runId"), input: studyIdentity(item.input, context, "receipt.input"), reopened: { reportArtifactIds: uniqueStrings(reopened.reportArtifactIds, context, "receipt.reopened.reportArtifactIds"), admissionIds: uniqueStrings(reopened.admissionIds, context, "receipt.reopened.admissionIds"), evidenceArtifactIds: uniqueStrings(reopened.evidenceArtifactIds, context, "receipt.reopened.evidenceArtifactIds"), evidenceReceiptContentIds: uniqueStrings(reopened.evidenceReceiptContentIds, context, "receipt.reopened.evidenceReceiptContentIds") }, producer: { id: literal(producer.id, "studio.deterministic-study-readiness-audit", context, "receipt.producer.id"), version: literal(producer.version, "3", context, "receipt.producer.version"), policy: literal(producer.policy, "generalized_state_integrity_and_coverage_gate_no_quality_score", context, "receipt.producer.policy") }, result: { outcome: oneOf(result.outcome, new Set(["proceed_to_caption_review", "withheld"]), context, "receipt.result.outcome"), reasonCodes: uniqueStrings(result.reasonCodes, context, "receipt.result.reasonCodes").map((entry, index) => oneOf(entry, READINESS_REASONS, context, `receipt.result.reasonCodes[${index}]`)), states: uniqueStrings(result.states, context, "receipt.result.states").map((entry, index) => oneOf<GeneralizedCoverageState | EvidenceCitationState>(entry, READINESS_STATES, context, `receipt.result.states[${index}]`)), coverageIds: uniqueStrings(result.coverageIds, context, "receipt.result.coverageIds") }, nonClaims: { semanticCorrectness: literal(nonClaims.semanticCorrectness, "not_assessed", context, "receipt.nonClaims.semanticCorrectness"), translationQuality: literal(nonClaims.translationQuality, "not_assessed", context, "receipt.nonClaims.translationQuality"), truthArbitration: literal(nonClaims.truthArbitration, "not_performed", context, "receipt.nonClaims.truthArbitration") } };
}
