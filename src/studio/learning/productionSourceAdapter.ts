import type { VerifiedCaptionProductionResult } from "../runtime/production/captionProductionAudit";
import type { CaptionProductionLine } from "../runtime/production/model/captions";
import { validateCaptionProductionArtifact } from "../runtime/production/validation/captionProduction.ts";
import type {
  LearningSourceContext,
  LearningSourceProjection,
  PresentedMoment,
  PresentedText,
  ProductionPresentedMoment,
} from "./model.ts";
import {
  availableText,
  exactKeys,
  nonEmptyString,
  record,
  stringArray,
} from "./sourceAdapterPrimitives.ts";

const PRODUCTION_SIDE_KEYS = new Set(["language", "state", "text", "reasonCode"]);
const VERIFICATION_KEYS = new Set([
  "jobId", "approval", "authorityState", "integrity", "source", "study", "readiness", "reopened",
  "captionArtifactId", "captionContentId", "receiptArtifactId", "receiptId", "receiptContentId", "executor", "result",
]);
const APPROVAL_KEYS = new Set(["reviewId", "artifactId", "receiptId", "receiptContentId"]);
const VERIFIED_SOURCE_KEYS = new Set(["artifactId", "contentId", "analysisRequestId", "range"]);
const RANGE_KEYS = new Set(["startMs", "endMs"]);
const STUDY_KEYS = new Set(["studyId", "artifactId", "contentId", "executorReceiptId", "executorReceiptContentId"]);
const READINESS_KEYS = new Set(["readinessId", "artifactId", "receiptId", "receiptContentId"]);
const REOPENED_KEYS = new Set([
  "sourceArtifactIds", "semanticEvidenceArtifactIds", "reportArtifactIds", "admissionIds",
  "planningDecisionIds", "executorIds",
]);
const RESULT_KEYS = new Set([
  "status", "lineCount", "sourceAvailableCount", "targetAvailableCount", "withheldCount", "unavailableCount",
]);

function productionText(side: unknown, expectedLanguage?: "ko" | "en"): PresentedText | null {
  if (!record(side) || !exactKeys(side, PRODUCTION_SIDE_KEYS)) return null;
  if (expectedLanguage && side.language !== expectedLanguage) return null;
  if (side.state === "available") {
    return nonEmptyString(side.text) && side.reasonCode === null ? availableText(side.text) : null;
  }
  if (
    (side.state !== "withheld" && side.state !== "unavailable") ||
    side.text !== null || !nonEmptyString(side.reasonCode)
  ) return null;
  return {
    state: side.state,
    text: null,
    reasonCode: side.state === "withheld" ? "production_caption_withheld" : "production_caption_unavailable",
    upstreamReasonCode: side.reasonCode,
    detail: side.reasonCode.replaceAll("_", " "),
  };
}

function validatedVerifiedProductionResult(
  input: VerifiedCaptionProductionResult,
): VerifiedCaptionProductionResult | null {
  const value: unknown = input;
  if (!record(value) || !record(value.verification) || !record(value.artifact)) return null;
  const verification = value.verification;
  let artifact: VerifiedCaptionProductionResult["artifact"];
  try {
    artifact = validateCaptionProductionArtifact(value.artifact, "Learning verified caption source", "artifact");
  } catch {
    return null;
  }
  if (
    !exactKeys(verification, VERIFICATION_KEYS) ||
    verification.integrity !== "stored_caption_and_receipt_with_verified_study_readiness_approval" ||
    (verification.authorityState !== "unrevoked" && verification.authorityState !== "revoked_after_completion") ||
    !nonEmptyString(verification.jobId) ||
    !nonEmptyString(verification.captionArtifactId) ||
    !nonEmptyString(verification.captionContentId) ||
    !nonEmptyString(verification.receiptArtifactId) ||
    !nonEmptyString(verification.receiptId) ||
    !nonEmptyString(verification.receiptContentId) ||
    !record(verification.source) || !exactKeys(verification.source, VERIFIED_SOURCE_KEYS) ||
    !record(verification.source.range) || !exactKeys(verification.source.range, RANGE_KEYS) ||
    !record(verification.study) || !exactKeys(verification.study, STUDY_KEYS) ||
    !record(verification.readiness) || !exactKeys(verification.readiness, READINESS_KEYS) ||
    !record(verification.approval) || !exactKeys(verification.approval, APPROVAL_KEYS) ||
    !record(verification.reopened) || !exactKeys(verification.reopened, REOPENED_KEYS) ||
    !record(verification.executor) || !record(verification.result) || !exactKeys(verification.result, RESULT_KEYS) ||
    !nonEmptyString(verification.source.artifactId) ||
    !nonEmptyString(verification.source.contentId) ||
    !nonEmptyString(verification.source.analysisRequestId) ||
    !nonEmptyString(verification.study.studyId) ||
    !nonEmptyString(verification.study.artifactId) ||
    !nonEmptyString(verification.study.contentId) ||
    !nonEmptyString(verification.study.executorReceiptId) ||
    !nonEmptyString(verification.study.executorReceiptContentId) ||
    !nonEmptyString(verification.readiness.readinessId) ||
    !nonEmptyString(verification.readiness.artifactId) ||
    !nonEmptyString(verification.readiness.receiptId) ||
    !nonEmptyString(verification.readiness.receiptContentId) ||
    !Object.values(verification.approval).every(nonEmptyString) ||
    !Object.values(verification.reopened).every(stringArray) ||
    !Number.isInteger(verification.source.range.startMs) ||
    !Number.isInteger(verification.source.range.endMs) ||
    artifact.executor.executionScope !== "current_run"
  ) return null;
  if (
    artifact.jobId !== verification.jobId ||
    artifact.input.sourceArtifactId !== verification.source.artifactId ||
    artifact.input.sourceContentId !== verification.source.contentId ||
    artifact.input.analysisRequestId !== verification.source.analysisRequestId ||
    artifact.input.range.startMs !== verification.source.range.startMs ||
    artifact.input.range.endMs !== verification.source.range.endMs ||
    JSON.stringify(artifact.executor) !== JSON.stringify(verification.executor) ||
    JSON.stringify(artifact.result) !== JSON.stringify(verification.result)
  ) return null;
  for (const key of ["studyId", "artifactId", "contentId"] as const) {
    if (artifact.input.study[key] !== verification.study[key]) return null;
  }
  for (const key of ["readinessId", "artifactId", "receiptId", "receiptContentId"] as const) {
    if (artifact.input.readiness[key] !== verification.readiness[key]) return null;
  }
  return {
    verification: verification as unknown as VerifiedCaptionProductionResult["verification"],
    artifact,
  };
}

/** Accept only the audited in-memory result returned by reopenCaptionProductionResults. */
export function projectVerifiedProductionLearningSource(
  input: VerifiedCaptionProductionResult,
): LearningSourceProjection {
  const verified = validatedVerifiedProductionResult(input);
  if (!verified) return { state: "failed", reasonCode: "invalid_source_binding" };
  const { verification, artifact } = verified;
  const context: Extract<LearningSourceContext, { origin: "verified_production_caption" }> = {
    origin: "verified_production_caption",
    identities: {
      runId: artifact.runId,
      sourceArtifactId: verification.source.artifactId,
      sourceContentId: verification.source.contentId,
      analysisRequestId: verification.source.analysisRequestId,
      studyId: verification.study.studyId,
      studyArtifactId: verification.study.artifactId,
      studyContentId: verification.study.contentId,
      readinessId: verification.readiness.readinessId,
      readinessArtifactId: verification.readiness.artifactId,
      readinessReceiptId: verification.readiness.receiptId,
      readinessReceiptContentId: verification.readiness.receiptContentId,
      captionJobId: verification.jobId,
      captionArtifactId: verification.captionArtifactId,
      captionContentId: verification.captionContentId,
      captionReceiptArtifactId: verification.receiptArtifactId,
      captionReceiptId: verification.receiptId,
      captionReceiptContentId: verification.receiptContentId,
      lineIds: artifact.lines.map((line) => line.id),
    },
    rights: {
      basis: "production_private_source_policy",
      licence: null,
      attribution: null,
      mediaExport: { state: "unavailable", reasonCode: "media_export_excluded_from_p0" },
      textExport: { state: "unavailable", reasonCode: "export_adapter_missing" },
    },
    nonClaims: [
      "semantic_correctness_not_assessed",
      "translation_quality_not_assessed",
      "publication_not_authorized",
    ],
  };
  const moments = artifact.lines.map((line): ProductionPresentedMoment => ({
    lineId: line.id,
    startMs: line.startMs,
    endMs: line.endMs,
    sourceLanguage: line.source.language,
    targetLanguage: line.target.language,
    source: productionText(line.source)!,
    target: productionText(line.target)!,
    support: captionLineSupport(line),
  }));
  return { state: "ready", source: { context, moments } };
}

function captionLineSupport(line: CaptionProductionLine): PresentedMoment["support"] {
  const generalized = line.lineage.generalizedCausality?.lineage;
  const claimIds = [...new Set([...line.lineage.study.claimIds, ...(generalized?.claimIds ?? [])])].sort();
  const citationIds = [...new Set(generalized?.citationIds ?? [])].sort();
  const semanticEvidenceArtifactIds = [...new Set(
    line.lineage.study.semanticCitations.map((citation) => citation.artifactId),
  )].sort();
  const semanticEvidenceReceiptIds = [...new Set(
    line.lineage.study.semanticCitations.map((citation) => citation.receiptId),
  )].sort();
  if (
    claimIds.length === 0 && citationIds.length === 0 &&
    semanticEvidenceArtifactIds.length === 0 && semanticEvidenceReceiptIds.length === 0
  ) {
    return {
      state: "none",
      claimIds: [],
      citationIds: [],
      semanticEvidenceArtifactIds: [],
      semanticEvidenceReceiptIds: [],
    };
  }
  return {
    state: "caption_line_support",
    claimIds,
    citationIds,
    semanticEvidenceArtifactIds,
    semanticEvidenceReceiptIds,
  };
}
