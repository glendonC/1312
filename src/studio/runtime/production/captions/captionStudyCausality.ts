import { canonicalSha256 } from "../artifactStore.ts";
import type { VerifiedOwnedMediaStudy } from "../study/studySynthesisAudit.ts";
import type {
  CaptionLineCausalityV3,
  CaptionLineReasonCode,
  CaptionLineStudySupport,
  CaptionProductionLine,
  CaptionStudyIdentity,
  PublishReviewDecisionReceiptIdentity,
  StudyReadinessReceiptIdentity,
  RuntimeProjection,
} from "../model.ts";
import type { GeneralizedStudySynthesisResult } from "../study/generalizedStudySynthesisHost.ts";
import type { DialogueScopePolicy } from "../../../acoustic/dialogueScopePolicy.ts";
import { rangeOverlapsNonDialogue } from "../../../acoustic/dialogueScopePolicy.ts";

function uniqueByIdentity<T>(values: readonly T[], identity: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = identity(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map((value) => structuredClone(value));
}

export function captionStudyIdentity(study: VerifiedOwnedMediaStudy): CaptionStudyIdentity {
  return {
    studyId: study.record.id,
    artifactId: study.artifact.id,
    contentId: study.artifact.content.contentId,
    executorReceiptId: study.executorReceipt.receiptId,
    executorReceiptContentId: study.record.executorReceiptContentId,
  };
}

export function generalizedCaptionStudyIdentity(study: GeneralizedStudySynthesisResult): CaptionStudyIdentity {
  return {
    studyId: study.study.studyId,
    artifactId: study.study.artifactId,
    contentId: study.study.contentId,
    executorReceiptId: study.executorReceiptId,
    executorReceiptContentId: study.executorReceiptContentId,
  };
}

function generalizedSupport(
  state: RuntimeProjection,
  study: GeneralizedStudySynthesisResult,
  causality: CaptionLineCausalityV3,
): CaptionLineStudySupport {
  const coverage = causality.lineage.coverageId
    ? study.envelope.coverage.find((entry) => entry.coverageId === causality.lineage.coverageId)
    : null;
  const coverageState: CaptionLineStudySupport["coverage"]["state"] = causality.lineage.coverageState === "supported"
    ? "supported"
    : causality.lineage.coverageState === "conflicting"
      ? "conflict"
      : causality.lineage.coverageState === "failed"
        ? "failed"
        : causality.lineage.coverageState === "unknown"
          ? "unknown"
          : causality.lineage.coverageState === "uncovered"
            ? "uncovered"
            : "withheld";
  const reasonCode = coverageState === "supported" ? null
    : coverageState === "conflict" ? "unresolved_conflict" as const
      : coverageState === "uncovered" ? "uncovered" as const
        : coverage?.reason?.code ?? "uncovered" as const;
  const citationIds = new Set(causality.lineage.citationIds);
  const semanticCitations = study.envelope.evidenceCitations
    .filter((citation) => citationIds.has(citation.citationId))
    .map((citation) => {
      if (citation.evidenceKind !== "current_run_speech" || citation.use !== "claim_support" || !citation.operationId) {
        throw new Error("Generalized caption text retained a non-speech claim citation");
      }
      return {
        operationId: citation.operationId,
        artifactId: citation.evidence.artifactId,
        contentId: citation.evidence.contentId,
        receiptId: citation.receipt.receiptId,
        receiptContentId: citation.receipt.contentId,
        observations: citation.observations.flatMap((observation) =>
          observation.state === "available" && observation.locator.kind === "temporal_range"
            ? [{ observationId: observation.observationId, startMs: observation.locator.media.startMs, endMs: observation.locator.media.endMs }]
            : []),
      };
    });
  const admissionIds = new Set(study.envelope.claims
    .filter((claim) => causality.lineage.claimIds.includes(claim.claimId))
    .flatMap((claim) => claim.childClaims.map((child) => child.admissionId)));
  const childReports = [...admissionIds].map((admissionId) => {
    const admission = state.generalizedParentArtifactAdmissions[admissionId];
    const read = Object.values(state.generalizedParentArtifactReads).find((entry) => entry.admissionId === admissionId);
    if (!admission || !read) throw new Error("Generalized caption causality lost an admitted/read child report");
    return {
      reportId: admission.reportId,
      childTaskId: admission.childTaskId,
      childAgentId: admission.childAgentId,
      artifactId: admission.report.artifactId,
      contentId: admission.report.contentId,
      dispositionId: admission.admissionId,
      dispositionReceiptId: admission.receiptId,
      dispositionReceiptContentId: admission.receiptContentId,
      admissionId: admission.admissionId,
      admissionReceiptId: admission.receiptId,
      admissionReceiptContentId: admission.receiptContentId,
      readOperationId: read.id,
      readReceiptId: read.receiptId,
    };
  });
  return {
    coverage: { coverageId: causality.lineage.coverageId, state: coverageState, reasonCode },
    claimIds: [...causality.lineage.claimIds],
    semanticCitations,
    childReports,
  };
}

export function closeGeneralizedCaptionLineCausality(input: {
  line: Omit<CaptionProductionLine, "lineage">;
  state: RuntimeProjection;
  study: GeneralizedStudySynthesisResult;
  studyIdentity: CaptionStudyIdentity;
  causality: CaptionLineCausalityV3;
  readiness: StudyReadinessReceiptIdentity;
  approval: PublishReviewDecisionReceiptIdentity;
  source: { artifactId: string; contentId: string };
  executor: CaptionProductionLine["lineage"]["captionExecutor"];
  derivation: CaptionProductionLine["lineage"]["derivation"];
}): CaptionProductionLine {
  const support = generalizedSupport(input.state, input.study, input.causality);
  const knownReasons = new Set<CaptionLineReasonCode>([
    "not_in_requested_dialogue_scope", "study_coverage_conflict", "study_coverage_truncated",
    "study_coverage_unavailable", "study_coverage_failed", "study_coverage_withheld",
    "study_coverage_unknown", "study_coverage_uncovered", "study_readiness_withheld",
  ]);
  const reasonCode = input.causality.source.reasonCode;
  if (reasonCode !== null && !knownReasons.has(reasonCode as CaptionLineReasonCode)) {
    throw new Error("Generalized caption causality returned an unknown closed reason");
  }
  const typedReason = reasonCode as CaptionLineReasonCode | null;
  return {
    ...structuredClone(input.line),
    source: { ...structuredClone(input.causality.source), reasonCode: typedReason },
    target: { ...structuredClone(input.causality.target), reasonCode: typedReason },
    lineage: {
      derivation: input.derivation,
      source: {
        artifactId: input.source.artifactId,
        contentId: input.source.contentId,
        window: { startMs: input.line.startMs, endMs: input.line.endMs },
      },
      study: { ...structuredClone(input.studyIdentity), ...support },
      readiness: structuredClone(input.readiness),
      approval: structuredClone(input.approval),
      captionExecutor: structuredClone(input.executor),
      generalizedCausality: structuredClone(input.causality),
    },
  };
}

export function deriveCaptionLineStudySupport(
  study: VerifiedOwnedMediaStudy,
  startMs: number,
  endMs: number,
): CaptionLineStudySupport {
  const covering = study.envelope.coverage.filter((range) =>
    range.startMs <= startMs && range.endMs >= endMs);
  if (covering.length !== 1) {
    return {
      coverage: { coverageId: null, state: "uncovered", reasonCode: "uncovered" },
      claimIds: [], semanticCitations: [], childReports: [],
    };
  }
  const coverage = covering[0];
  const conflicted = study.envelope.conflicts.some((conflict) => conflict.coverageId === coverage.coverageId);
  if (conflicted || coverage.state !== "supported") {
    return {
      coverage: {
        coverageId: coverage.coverageId,
        state: conflicted ? "conflict" : coverage.state,
        reasonCode: conflicted ? "unresolved_conflict" : coverage.reason?.code ?? "uncovered",
      },
      claimIds: [], semanticCitations: [], childReports: [],
    };
  }

  const claims = coverage.claimIds
    .map((claimId) => study.envelope.claims.find((claim) => claim.claimId === claimId))
    .filter((claim): claim is NonNullable<typeof claim> => claim !== undefined)
    .filter((claim) => claim.startMs <= startMs && claim.endMs >= endMs);
  const supportedClaims = claims.filter((claim) => claim.semanticCitations.some((citation) =>
    citation.observations.some((observation) => observation.startMs <= startMs && observation.endMs >= endMs)));
  const childReportIds = new Set(supportedClaims.flatMap((claim) =>
    claim.childReportCitations.map((citation) => citation.reportId)));
  const childReports = study.envelope.reports.filter((report) => childReportIds.has(report.reportId));
  const citedReportsClose = supportedClaims.every((claim) => claim.childReportCitations.length > 0 &&
    claim.childReportCitations.every((citation) => childReports.some((report) =>
      report.reportId === citation.reportId && report.artifactId === citation.artifactId &&
      report.contentId === citation.contentId && report.admissionId === citation.admissionId)));
  if (supportedClaims.length === 0 || childReports.length === 0 || !citedReportsClose) {
    return {
      coverage: { coverageId: coverage.coverageId, state: "supported", reasonCode: "citation_mismatch" },
      claimIds: [], semanticCitations: [], childReports: [],
    };
  }
  return {
    coverage: { coverageId: coverage.coverageId, state: "supported", reasonCode: null },
    claimIds: supportedClaims.map((claim) => claim.claimId),
    semanticCitations: uniqueByIdentity(
      supportedClaims.flatMap((claim) => claim.semanticCitations),
      (citation) => canonicalSha256(citation),
    ),
    childReports: uniqueByIdentity(childReports, (report) => report.artifactId),
  };
}

function withheldReason(support: CaptionLineStudySupport): CaptionLineReasonCode | null {
  if (support.coverage.state === "supported") {
    return support.coverage.reasonCode === "citation_mismatch" ? "study_citation_mismatch" : null;
  }
  if (support.coverage.state === "withheld") return "study_coverage_withheld";
  if (support.coverage.state === "unknown") return "study_coverage_unknown";
  if (support.coverage.state === "failed") return "study_coverage_failed";
  if (support.coverage.state === "conflict") return "study_coverage_conflict";
  return "study_coverage_uncovered";
}

export function closeCaptionLineCausality(input: {
  line: Omit<CaptionProductionLine, "lineage">;
  study: VerifiedOwnedMediaStudy;
  studyIdentity: CaptionStudyIdentity;
  readiness: StudyReadinessReceiptIdentity;
  approval: PublishReviewDecisionReceiptIdentity;
  source: { artifactId: string; contentId: string };
  executor: CaptionProductionLine["lineage"]["captionExecutor"];
  derivation: CaptionProductionLine["lineage"]["derivation"];
}): CaptionProductionLine {
  const support = deriveCaptionLineStudySupport(input.study, input.line.startMs, input.line.endMs);
  const reason = withheldReason(support);
  const line = reason === null ? structuredClone(input.line) : {
    ...structuredClone(input.line),
    source: { language: "ko" as const, state: "withheld" as const, text: null, reasonCode: reason },
    target: { language: "en" as const, state: "withheld" as const, text: null, reasonCode: reason },
  };
  return {
    ...line,
    lineage: {
      derivation: input.derivation,
      source: {
        artifactId: input.source.artifactId,
        contentId: input.source.contentId,
        window: { startMs: line.startMs, endMs: line.endMs },
      },
      study: { ...structuredClone(input.studyIdentity), ...support },
      readiness: structuredClone(input.readiness),
      approval: structuredClone(input.approval),
      captionExecutor: structuredClone(input.executor),
    },
  };
}

export function captionLineReceiptProjection(line: CaptionProductionLine) {
  return {
    lineId: line.id,
    startMs: line.startMs,
    endMs: line.endMs,
    sourceState: line.source.state,
    targetState: line.target.state,
    reasonCode: line.target.reasonCode ?? line.source.reasonCode,
    coverageId: line.lineage.study.coverage.coverageId,
    coverageState: line.lineage.study.coverage.state,
    claimIds: [...line.lineage.study.claimIds],
    semanticEvidenceArtifactIds: line.lineage.study.semanticCitations.map((citation) => citation.artifactId),
    reportArtifactIds: line.lineage.study.childReports.map((report) => report.artifactId),
    ...(line.lineage.generalizedCausality
      ? { generalizedCausality: structuredClone(line.lineage.generalizedCausality) }
      : {}),
  };
}

/** Authoritative post-executor text boundary; any overlap with excluded scope withholds the whole line. */
export function enforceCaptionDialogueScope(line: CaptionProductionLine, policy: DialogueScopePolicy | undefined): CaptionProductionLine {
  if (!policy || !rangeOverlapsNonDialogue(policy, line.startMs, line.endMs)) return structuredClone(line);
  return {
    ...structuredClone(line),
    source: { language: "ko", state: "withheld", text: null, reasonCode: "not_in_requested_dialogue_scope" },
    target: { language: "en", state: "withheld", text: null, reasonCode: "not_in_requested_dialogue_scope" },
  };
}
