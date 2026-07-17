import { canonicalSha256 } from "./artifactStore.ts";
import type { VerifiedOwnedMediaStudy } from "./studySynthesisAudit.ts";
import type {
  CaptionLineReasonCode,
  CaptionLineStudySupport,
  CaptionProductionLine,
  CaptionStudyIdentity,
  PublishReviewDecisionReceiptIdentity,
  StudyReadinessReceiptIdentity,
} from "./model.ts";

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
  };
}
