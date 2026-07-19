import type {
  CaptionExecutorDescriptor,
  CaptionProductionArtifact,
  CaptionProductionArtifactV5,
  CaptionProductionLine,
  CaptionProductionReceipt,
  CaptionProductionRequest,
  CaptionProductionStatus,
  CaptionStudyIdentity,
  CaptionLineCausalityV3,
  CaptionLineCausalityV4,
  GeneralizedCoverageState,
} from "../model.ts";
import { CAPTION_PRODUCTION_LIMITS } from "../model.ts";
import {
  compactCaptionProductionArtifactV5,
  materializeCaptionProductionLines,
} from "../captions/captionArtifactCompaction.ts";
import { validatePublishReviewDecisionReceiptIdentity } from "./publishReviewDecision.ts";
import { validateStudyReadinessReceiptIdentity } from "./publishReview.ts";
import { validateSemanticEvidenceCitationInput } from "./semanticEvidence.ts";
import { validateStudyPlanningReportInput } from "./studies.ts";
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
} from "./primitives.ts";

const LINE_STATES = new Set(["available", "withheld", "unavailable"]);
const V1_REASON_CODES = new Set([
  "recorded_quality_gate_withheld",
  "recognizer_unavailable",
  "recognizer_empty",
  "translator_unavailable",
  "translator_missing_line",
  "source_unavailable",
  "study_coverage_withheld",
  "study_coverage_unknown",
  "study_coverage_failed",
  "study_coverage_conflict",
  "study_coverage_uncovered",
  "study_citation_mismatch",
]);
const V2_REASON_CODES = new Set([...V1_REASON_CODES, "not_in_requested_dialogue_scope"]);
const V3_REASON_CODES = new Set([...V2_REASON_CODES, "study_coverage_unavailable", "study_coverage_truncated", "study_readiness_withheld"]);
const OUTPUT_STATUSES = new Set(["completed", "partial", "withheld", "unavailable"]);

function canonicalStructure(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStructure).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalStructure(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableIdentity(value: unknown, context: string, path: string): string {
  const identity = string(value, context, path);
  if (identity.length > 200 || identity.trim() !== identity || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(identity)) {
    fail(context, path, "must be a stable path-free identity");
  }
  return identity;
}

export function validateCaptionStudyIdentity(
  value: unknown,
  context: string,
  path: string,
): CaptionStudyIdentity {
  const item = object(value, context, path);
  exact(item, ["studyId", "artifactId", "contentId", "executorReceiptId", "executorReceiptContentId"], context, path);
  return {
    studyId: stableIdentity(item.studyId, context, `${path}.studyId`),
    artifactId: stableIdentity(item.artifactId, context, `${path}.artifactId`),
    contentId: contentId(item.contentId, context, `${path}.contentId`),
    executorReceiptId: stableIdentity(item.executorReceiptId, context, `${path}.executorReceiptId`),
    executorReceiptContentId: contentId(item.executorReceiptContentId, context, `${path}.executorReceiptContentId`),
  };
}

function boundedText(value: unknown, context: string, path: string): string {
  const text = string(value, context, path);
  if (text.length > 4_096 || text.trim() !== text || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    fail(context, path, "must be bounded trimmed caption text");
  }
  return text;
}

function nullableContentId(value: unknown, context: string, path: string): string | null {
  return value === null ? null : contentId(value, context, path);
}

export function validateCaptionExecutorDescriptor(
  value: unknown,
  context: string,
  path: string,
): CaptionExecutorDescriptor {
  const item = object(value, context, path);
  exact(item, ["id", "version", "classification", "executionScope", "cognitionClaim", "recognizer", "translator", "sourceCaptionContentId"], context, path);
  const classification = oneOf<CaptionExecutorDescriptor["classification"]>(
    item.classification,
    new Set(["recorded_real_pipeline_fixture", "deterministic_current_run_test_seam", "real_recognizer_translator"]),
    context,
    `${path}.classification`,
  );
  const id = oneOf<CaptionExecutorDescriptor["id"]>(
    item.id,
    new Set([
      "studio.recorded-caption-fixture-adapter",
      "studio.deterministic-current-run-caption-test-seam",
      "studio.openai-caption-producer",
    ]),
    context,
    `${path}.id`,
  );
  const version = oneOf<CaptionExecutorDescriptor["version"]>(item.version, new Set(["1", "2"]), context, `${path}.version`);
  const recognizer = item.recognizer === null ? null : string(item.recognizer, context, `${path}.recognizer`);
  const translator = item.translator === null ? null : string(item.translator, context, `${path}.translator`);
  const sourceCaptionContentId = nullableContentId(item.sourceCaptionContentId, context, `${path}.sourceCaptionContentId`);
  const executionScope = oneOf<CaptionExecutorDescriptor["executionScope"]>(
    item.executionScope,
    new Set(["test_demo_only", "current_run"]),
    context,
    `${path}.executionScope`,
  );
  literal(item.cognitionClaim, "none", context, `${path}.cognitionClaim`);
  if (
    (classification === "recorded_real_pipeline_fixture" &&
      (id !== "studio.recorded-caption-fixture-adapter" || version !== "1" || executionScope !== "test_demo_only" || recognizer === null || translator === null)) ||
    (classification === "deterministic_current_run_test_seam" &&
      (id !== "studio.deterministic-current-run-caption-test-seam" || version !== "1" || executionScope !== "current_run" || recognizer === null || translator === null || sourceCaptionContentId !== null)) ||
    (classification === "real_recognizer_translator" &&
      (id !== "studio.openai-caption-producer" || executionScope !== "current_run" || recognizer === null || translator === null || sourceCaptionContentId !== null))
  ) fail(context, path, "executor identity, classification, and evidence must agree");
  return { id, version, classification, executionScope, cognitionClaim: "none", recognizer, translator, sourceCaptionContentId };
}

export function assertCaptionProductionRequest(value: unknown): CaptionProductionRequest {
  const context = "Caption-production request";
  const item = object(value, context, "request");
  exact(item, ["approval"], context, "request");
  return {
    approval: validatePublishReviewDecisionReceiptIdentity(item.approval, context, "request.approval"),
  };
}

export function validateCaptionProductionInput(value: unknown, context: string, path: string): CaptionProductionArtifact["input"] {
  const item = object(value, context, path);
  exact(item, ["sourceArtifactId", "sourceContentId", "analysisRequestId", "range", "sourceLanguage", "targetLanguage", "study", "readiness"], context, path);
  const range = object(item.range, context, `${path}.range`);
  exact(range, ["startMs", "endMs"], context, `${path}.range`);
  const startMs = integer(range.startMs, context, `${path}.range.startMs`);
  const endMs = integer(range.endMs, context, `${path}.range.endMs`, 1);
  if (endMs <= startMs || endMs - startMs > CAPTION_PRODUCTION_LIMITS.maxDurationMs) {
    fail(context, `${path}.range`, "must be non-empty and within the caption duration ceiling");
  }
  return {
    sourceArtifactId: stableIdentity(item.sourceArtifactId, context, `${path}.sourceArtifactId`),
    sourceContentId: contentId(item.sourceContentId, context, `${path}.sourceContentId`),
    analysisRequestId: stableIdentity(item.analysisRequestId, context, `${path}.analysisRequestId`),
    range: { startMs, endMs },
    sourceLanguage: literal(item.sourceLanguage, "ko", context, `${path}.sourceLanguage`),
    targetLanguage: literal(item.targetLanguage, "en", context, `${path}.targetLanguage`),
    study: validateCaptionStudyIdentity(item.study, context, `${path}.study`),
    readiness: validateStudyReadinessReceiptIdentity(item.readiness, context, `${path}.readiness`),
  };
}

function validateGeneralizedCausality(value: unknown, context: string, path: string, version: 3 | 4): CaptionLineCausalityV3 | CaptionLineCausalityV4 {
  const item = object(value, context, path);
  exact(item, ["schema", "range", "source", "target", "lineage"], context, path);
  literal(item.schema, version === 4 ? "studio.caption-line-causality.v4" : "studio.caption-line-causality.v3", context, `${path}.schema`);
  const range = object(item.range, context, `${path}.range`);
  exact(range, ["artifactId", "trackId", "startMs", "endMs"], context, `${path}.range`);
  const parsedRange = {
    artifactId: stableIdentity(range.artifactId, context, `${path}.range.artifactId`),
    trackId: stableIdentity(range.trackId, context, `${path}.range.trackId`),
    startMs: integer(range.startMs, context, `${path}.range.startMs`),
    endMs: integer(range.endMs, context, `${path}.range.endMs`, 1),
  };
  if (parsedRange.endMs <= parsedRange.startMs) fail(context, `${path}.range`, "must be non-empty");
  const parseText = <Language extends "ko" | "en">(raw: unknown, language: Language, textPath: string): {
    language: Language; state: "available" | "withheld" | "unavailable"; text: string | null; reasonCode: string | null;
  } => {
    const entry = object(raw, context, textPath);
    exact(entry, ["language", "state", "text", "reasonCode"], context, textPath);
    literal(entry.language, language, context, `${textPath}.language`);
    const state = oneOf<"available" | "withheld" | "unavailable">(
      entry.state,
      new Set(["available", "withheld", "unavailable"]),
      context,
      `${textPath}.state`,
    );
    const text = entry.text === null ? null : boundedText(entry.text, context, `${textPath}.text`);
    const reasonCode = entry.reasonCode === null ? null : string(entry.reasonCode, context, `${textPath}.reasonCode`);
    if ((state === "available") !== (text !== null && reasonCode === null)) {
      fail(context, textPath, "must bind available text or a closed withheld/unavailable reason");
    }
    return { language, state, text, reasonCode };
  };
  const source = parseText(item.source, "ko", `${path}.source`);
  const target = parseText(item.target, "en", `${path}.target`);
  if (
    source.state !== target.state ||
    (source.state === "withheld" && source.reasonCode !== target.reasonCode) ||
    (source.state === "unavailable" &&
      (!new Set(["recognizer_unavailable", "recognizer_empty"]).has(source.reasonCode ?? "") ||
        target.reasonCode !== "source_unavailable"))
  ) fail(context, path, "source and target generalized authority must agree or preserve one typed recognizer unavailability");
  const lineage = object(item.lineage, context, `${path}.lineage`);
  exact(lineage, ["study", "readiness", "coverageId", "coverageState", "preservedStates", "claimIds", "citationIds", ...(version === 4 ? ["passIds"] : [])], context, `${path}.lineage`);
  const study = object(lineage.study, context, `${path}.lineage.study`);
  exact(study, ["studyId", "artifactId", "contentId", "bytes", "schema"], context, `${path}.lineage.study`);
  const readiness = object(lineage.readiness, context, `${path}.lineage.readiness`);
  exact(readiness, ["readinessId", "receiptId", "receiptContentId"], context, `${path}.lineage.readiness`);
  const states = new Set(["supported", "unknown", "withheld", "unavailable", "truncated", "conflicting", "failed", "not_in_scope"]);
  const coverageState = oneOf<CaptionLineCausalityV3["lineage"]["coverageState"]>(lineage.coverageState, new Set([...states, "uncovered"]), context, `${path}.lineage.coverageState`);
  const preservedStates = array(lineage.preservedStates, context, `${path}.lineage.preservedStates`).map((state, index) =>
    oneOf<GeneralizedCoverageState>(state, states, context, `${path}.lineage.preservedStates[${index}]`));
  const claimIds = array(lineage.claimIds, context, `${path}.lineage.claimIds`).map((id, index) => stableIdentity(id, context, `${path}.lineage.claimIds[${index}]`));
  const citationIds = array(lineage.citationIds, context, `${path}.lineage.citationIds`).map((id, index) => stableIdentity(id, context, `${path}.lineage.citationIds[${index}]`));
  const passIds = version === 4 ? array(lineage.passIds, context, `${path}.lineage.passIds`).map((id, index) => stableIdentity(id, context, `${path}.lineage.passIds[${index}]`)) : [];
  if (source.state !== "withheld" && (coverageState !== "supported" || claimIds.length === 0 || citationIds.length === 0)) fail(context, path, "available or unavailable generalized caption state requires supported speech causality");
  if (source.state === "withheld" && (claimIds.length !== 0 || citationIds.length !== 0)) fail(context, path, "withheld generalized text cannot retain claim authority");
  const common = {
    range: parsedRange,
    source,
    target,
    lineage: {
      readiness: {
        readinessId: stableIdentity(readiness.readinessId, context, `${path}.lineage.readiness.readinessId`),
        receiptId: stableIdentity(readiness.receiptId, context, `${path}.lineage.readiness.receiptId`),
        receiptContentId: contentId(readiness.receiptContentId, context, `${path}.lineage.readiness.receiptContentId`),
      },
      coverageId: lineage.coverageId === null ? null : stableIdentity(lineage.coverageId, context, `${path}.lineage.coverageId`),
      coverageState,
      preservedStates,
      claimIds,
      citationIds,
    },
  };
  if (version === 4) return {
    schema: "studio.caption-line-causality.v4",
    ...common,
    lineage: {
      study: {
        studyId: stableIdentity(study.studyId, context, `${path}.lineage.study.studyId`),
        artifactId: stableIdentity(study.artifactId, context, `${path}.lineage.study.artifactId`),
        contentId: contentId(study.contentId, context, `${path}.lineage.study.contentId`),
        bytes: integer(study.bytes, context, `${path}.lineage.study.bytes`, 1),
        schema: literal(study.schema, "studio.owned-media-study.v3", context, `${path}.lineage.study.schema`),
      },
      ...common.lineage,
      passIds,
    },
  };
  return {
    schema: "studio.caption-line-causality.v3",
    ...common,
    lineage: {
      study: {
        studyId: stableIdentity(study.studyId, context, `${path}.lineage.study.studyId`),
        artifactId: stableIdentity(study.artifactId, context, `${path}.lineage.study.artifactId`),
        contentId: contentId(study.contentId, context, `${path}.lineage.study.contentId`),
        bytes: integer(study.bytes, context, `${path}.lineage.study.bytes`, 1),
        schema: literal(study.schema, "studio.owned-media-study.v2", context, `${path}.lineage.study.schema`),
      },
      ...common.lineage,
    },
  };
}

function validateLine(value: unknown, context: string, path: string, version: 1 | 2 | 3 | 4): CaptionProductionLine {
  const item = object(value, context, path);
  exact(item, ["id", "startMs", "endMs", "lineage", "source", "target"], context, path);
  const lineage = object(item.lineage, context, `${path}.lineage`);
  exact(lineage, version >= 3
    ? ["derivation", "source", "study", "readiness", "approval", "captionExecutor", "generalizedCausality"]
    : ["derivation", "source", "study", "readiness", "approval", "captionExecutor"], context, `${path}.lineage`);
  const lineageSource = object(lineage.source, context, `${path}.lineage.source`);
  exact(lineageSource, ["artifactId", "contentId", "window"], context, `${path}.lineage.source`);
  const lineageWindow = object(lineageSource.window, context, `${path}.lineage.source.window`);
  exact(lineageWindow, ["startMs", "endMs"], context, `${path}.lineage.source.window`);
  const source = object(item.source, context, `${path}.source`);
  exact(source, ["language", "state", "text", "reasonCode"], context, `${path}.source`);
  const target = object(item.target, context, `${path}.target`);
  exact(target, ["language", "state", "text", "reasonCode"], context, `${path}.target`);
  const sourceState = oneOf<CaptionProductionLine["source"]["state"]>(
    source.state,
    LINE_STATES,
    context,
    `${path}.source.state`,
  );
  const targetState = oneOf<CaptionProductionLine["target"]["state"]>(
    target.state,
    LINE_STATES,
    context,
    `${path}.target.state`,
  );
  const sourceText = source.text === null ? null : boundedText(source.text, context, `${path}.source.text`);
  const targetText = target.text === null ? null : boundedText(target.text, context, `${path}.target.text`);
  const sourceReason = source.reasonCode === null
    ? null
    : oneOf<CaptionProductionLine["source"]["reasonCode"] & string>(
      source.reasonCode,
      version >= 3 ? V3_REASON_CODES : version === 2 ? V2_REASON_CODES : V1_REASON_CODES,
      context,
      `${path}.source.reasonCode`,
    );
  const targetReason = target.reasonCode === null
    ? null
    : oneOf<CaptionProductionLine["target"]["reasonCode"] & string>(
      target.reasonCode,
      version >= 3 ? V3_REASON_CODES : version === 2 ? V2_REASON_CODES : V1_REASON_CODES,
      context,
      `${path}.target.reasonCode`,
    );
  if (
    (sourceState === "available" && (sourceText === null || sourceReason !== null)) ||
    (sourceState !== "available" && (sourceText !== null || sourceReason === null)) ||
    (targetState === "available" && (targetText === null || targetReason !== null || sourceState !== "available")) ||
    (targetState !== "available" && (targetText !== null || targetReason === null)) ||
    (sourceState === "unavailable" && (targetState !== "unavailable" || targetReason !== "source_unavailable")) ||
    (sourceState === "withheld" && (targetState !== "withheld" || targetReason !== sourceReason)) ||
    (sourceState === "available" && targetState === "unavailable" &&
      targetReason !== "translator_unavailable" && targetReason !== "translator_missing_line") ||
    (sourceState === "available" && targetState === "withheld" && targetReason !== "recorded_quality_gate_withheld")
  ) fail(context, path, "line state, text, and closed reason do not agree");
  const startMs = integer(item.startMs, context, `${path}.startMs`);
  const endMs = integer(item.endMs, context, `${path}.endMs`, 1);
  const windowStartMs = integer(lineageWindow.startMs, context, `${path}.lineage.source.window.startMs`);
  const windowEndMs = integer(lineageWindow.endMs, context, `${path}.lineage.source.window.endMs`, 1);
  if (windowStartMs !== startMs || windowEndMs !== endMs) {
    fail(context, `${path}.lineage.source.window`, "must equal the exact caption line window");
  }
  const studyValue = object(lineage.study, context, `${path}.lineage.study`);
  exact(studyValue, [
    "studyId", "artifactId", "contentId", "executorReceiptId", "executorReceiptContentId",
    "coverage", "claimIds", "semanticCitations", "childReports",
  ], context, `${path}.lineage.study`);
  const studyIdentity = validateCaptionStudyIdentity({
    studyId: studyValue.studyId,
    artifactId: studyValue.artifactId,
    contentId: studyValue.contentId,
    executorReceiptId: studyValue.executorReceiptId,
    executorReceiptContentId: studyValue.executorReceiptContentId,
  }, context, `${path}.lineage.study`);
  const coverage = object(studyValue.coverage, context, `${path}.lineage.study.coverage`);
  exact(coverage, ["coverageId", "state", "reasonCode"], context, `${path}.lineage.study.coverage`);
  const coverageState = oneOf<CaptionProductionLine["lineage"]["study"]["coverage"]["state"]>(
    coverage.state,
    new Set(["supported", "withheld", "unknown", "failed", "uncovered", "conflict"]),
    context,
    `${path}.lineage.study.coverage.state`,
  );
  const coverageReason = coverage.reasonCode === null ? null : oneOf<NonNullable<CaptionProductionLine["lineage"]["study"]["coverage"]["reasonCode"]>>(
    coverage.reasonCode,
    new Set([
      "semantic_evidence_unavailable", "semantic_evidence_empty", "insufficient_semantic_evidence",
      "worker_withheld", "operation_failed", "unobserved_range", "explicit_study_gap",
      "unresolved_conflict", "child_failure", "rejected_input", "uncovered", "citation_mismatch",
    ]),
    context,
    `${path}.lineage.study.coverage.reasonCode`,
  );
  const claimIds = array(studyValue.claimIds, context, `${path}.lineage.study.claimIds`)
    .map((claimId, index) => stableIdentity(claimId, context, `${path}.lineage.study.claimIds[${index}]`));
  const semanticCitations = array(studyValue.semanticCitations, context, `${path}.lineage.study.semanticCitations`)
    .map((citation, index) => validateSemanticEvidenceCitationInput(citation, context, `${path}.lineage.study.semanticCitations[${index}]`));
  const childReports = array(studyValue.childReports, context, `${path}.lineage.study.childReports`)
    .map((report, index) => validateStudyPlanningReportInput(report, context, `${path}.lineage.study.childReports[${index}]`));
  if (
    new Set(claimIds).size !== claimIds.length ||
    new Set(semanticCitations.map((citation) => citation.artifactId)).size !== semanticCitations.length ||
    new Set(childReports.map((report) => report.artifactId)).size !== childReports.length
  ) fail(context, `${path}.lineage.study`, "must not repeat causal claim, semantic-evidence, or child-report identities");
  const expectedStudyReason = coverageState === "withheld" ? "study_coverage_withheld"
    : coverageState === "unknown" ? "study_coverage_unknown"
      : coverageState === "failed" ? "study_coverage_failed"
        : coverageState === "conflict" ? "study_coverage_conflict"
          : coverageState === "uncovered" ? "study_coverage_uncovered"
            : coverageReason === "citation_mismatch" ? "study_citation_mismatch"
              : null;
  const hasLineObservation = semanticCitations.some((citation) => citation.observations.some((observation) =>
    observation.startMs <= startMs && observation.endMs >= endMs));
  if (
    (coverageState === "supported" && coverageReason === null &&
      (claimIds.length === 0 || semanticCitations.length === 0 || childReports.length === 0 || !hasLineObservation)) ||
    (coverageState === "supported" && coverageReason !== null && coverageReason !== "citation_mismatch") ||
    (coverageState !== "supported" && coverageReason === null) ||
    (expectedStudyReason !== null &&
      (sourceState !== "withheld" || targetState !== "withheld" ||
        (sourceReason !== expectedStudyReason && (version === 1 || sourceReason !== "not_in_requested_dialogue_scope") && version < 3) ||
        (targetReason !== expectedStudyReason && (version === 1 || targetReason !== "not_in_requested_dialogue_scope") && version < 3) || sourceReason !== targetReason ||
        claimIds.length !== 0 || semanticCitations.length !== 0 || childReports.length !== 0))
  ) fail(context, `${path}.lineage.study`, "does not close supported coverage/citations or a null withheld range");
  const captionExecutor = object(lineage.captionExecutor, context, `${path}.lineage.captionExecutor`);
  exact(captionExecutor, ["jobId", "id", "version", "executionScope", "cognitionClaim"], context, `${path}.lineage.captionExecutor`);
  const generalizedCausality = version >= 3
    ? validateGeneralizedCausality(lineage.generalizedCausality, context, `${path}.lineage.generalizedCausality`, version === 4 ? 4 : 3)
    : undefined;
  if (generalizedCausality && (
    generalizedCausality.range.startMs !== startMs || generalizedCausality.range.endMs !== endMs ||
    generalizedCausality.source.state !== sourceState || generalizedCausality.source.text !== sourceText || generalizedCausality.source.reasonCode !== sourceReason ||
    generalizedCausality.target.state !== targetState || generalizedCausality.target.text !== targetText || generalizedCausality.target.reasonCode !== targetReason
  )) fail(context, `${path}.lineage.generalizedCausality`, "must exactly authorize the persisted line text and state");
  return {
    id: stableIdentity(item.id, context, `${path}.id`),
    startMs,
    endMs,
    lineage: {
      derivation: oneOf<CaptionProductionLine["lineage"]["derivation"]>(
        lineage.derivation,
        new Set(["recorded_fixture_test_demo_only", "current_run_source_execution"]),
        context,
        `${path}.lineage.derivation`,
      ),
      source: {
        artifactId: stableIdentity(lineageSource.artifactId, context, `${path}.lineage.source.artifactId`),
        contentId: contentId(lineageSource.contentId, context, `${path}.lineage.source.contentId`),
        window: { startMs: windowStartMs, endMs: windowEndMs },
      },
      study: {
        ...studyIdentity,
        coverage: {
          coverageId: coverage.coverageId === null ? null : stableIdentity(coverage.coverageId, context, `${path}.lineage.study.coverage.coverageId`),
          state: coverageState,
          reasonCode: coverageReason,
        },
        claimIds,
        semanticCitations,
        childReports,
      },
      readiness: validateStudyReadinessReceiptIdentity(lineage.readiness, context, `${path}.lineage.readiness`),
      approval: validatePublishReviewDecisionReceiptIdentity(lineage.approval, context, `${path}.lineage.approval`),
      captionExecutor: {
        jobId: stableIdentity(captionExecutor.jobId, context, `${path}.lineage.captionExecutor.jobId`),
        id: oneOf(captionExecutor.id, new Set([
          "studio.recorded-caption-fixture-adapter",
          "studio.deterministic-current-run-caption-test-seam",
          "studio.openai-caption-producer",
        ]), context, `${path}.lineage.captionExecutor.id`),
        version: oneOf(captionExecutor.version, new Set(["1", "2"]), context, `${path}.lineage.captionExecutor.version`),
        executionScope: oneOf(captionExecutor.executionScope, new Set(["test_demo_only", "current_run"]), context, `${path}.lineage.captionExecutor.executionScope`),
        cognitionClaim: literal(captionExecutor.cognitionClaim, "none", context, `${path}.lineage.captionExecutor.cognitionClaim`),
      },
      ...(generalizedCausality ? { generalizedCausality } : {}),
    },
    source: { language: literal(source.language, "ko", context, `${path}.source.language`), state: sourceState, text: sourceText, reasonCode: sourceReason },
    target: { language: literal(target.language, "en", context, `${path}.target.language`), state: targetState, text: targetText, reasonCode: targetReason },
  };
}

function structurallyExactV5(value: unknown, context: string, path: string): CaptionProductionArtifactV5 {
  const item = object(value, context, path);
  exact(item, ["schema", "jobId", "runId", "input", "executor", "sharedLineage", "lines", "result"], context, path);
  literal(item.schema, "studio.caption-production.artifact.v5", context, `${path}.schema`);
  const shared = object(item.sharedLineage, context, `${path}.sharedLineage`);
  exact(shared, ["derivation", "source", "study", "readiness", "approval", "captionExecutor", "generalizedCausality", "evidence"], context, `${path}.sharedLineage`);
  const sharedSource = object(shared.source, context, `${path}.sharedLineage.source`);
  exact(sharedSource, ["artifactId", "contentId"], context, `${path}.sharedLineage.source`);
  const generalized = object(shared.generalizedCausality, context, `${path}.sharedLineage.generalizedCausality`);
  exact(generalized, ["schema", "study", "readiness"], context, `${path}.sharedLineage.generalizedCausality`);
  const evidence = object(shared.evidence, context, `${path}.sharedLineage.evidence`);
  exact(evidence, ["semanticCitations", "childReports"], context, `${path}.sharedLineage.evidence`);
  array(evidence.semanticCitations, context, `${path}.sharedLineage.evidence.semanticCitations`)
    .forEach((entry, index) => object(entry, context, `${path}.sharedLineage.evidence.semanticCitations[${index}]`));
  array(evidence.childReports, context, `${path}.sharedLineage.evidence.childReports`)
    .forEach((entry, index) => object(entry, context, `${path}.sharedLineage.evidence.childReports[${index}]`));
  const lines = array(item.lines, context, `${path}.lines`);
  if (lines.length === 0) fail(context, `${path}.lines`, "v5 shared causality requires at least one exact line closure");
  lines.forEach((value, index) => {
    const linePath = `${path}.lines[${index}]`;
    const line = object(value, context, linePath);
    exact(line, ["id", "startMs", "endMs", "lineage", "source", "target"], context, linePath);
    const lineage = object(line.lineage, context, `${linePath}.lineage`);
    exact(lineage, ["study", "generalizedCausality"], context, `${linePath}.lineage`);
    const study = object(lineage.study, context, `${linePath}.lineage.study`);
    exact(study, ["coverage", "claimIds", "semanticCitationIndexes", "childReportIndexes"], context, `${linePath}.lineage.study`);
    const coverage = object(study.coverage, context, `${linePath}.lineage.study.coverage`);
    exact(coverage, ["coverageId", "state", "reasonCode"], context, `${linePath}.lineage.study.coverage`);
    const compactCausality = object(lineage.generalizedCausality, context, `${linePath}.lineage.generalizedCausality`);
    exact(compactCausality, ["trackId", "coverageId", "coverageState", "preservedStates", "claimIds", "citationIds", "passIds"], context, `${linePath}.lineage.generalizedCausality`);
    object(line.source, context, `${linePath}.source`);
    object(line.target, context, `${linePath}.target`);
  });
  return structuredClone(item) as unknown as CaptionProductionArtifactV5;
}

export function deriveCaptionProductionResult(lines: readonly CaptionProductionLine[]): CaptionProductionArtifact["result"] {
  const sourceAvailableCount = lines.filter((line) => line.source.state === "available").length;
  const targetAvailableCount = lines.filter((line) => line.target.state === "available").length;
  const withheldCount = lines.filter((line) => line.target.state === "withheld").length;
  const unavailableCount = lines.filter((line) => line.source.state === "unavailable" || line.target.state === "unavailable").length;
  let status: CaptionProductionStatus;
  if (lines.length === 0 || sourceAvailableCount === 0) status = "unavailable";
  else if (targetAvailableCount === lines.length) status = "completed";
  else if (targetAvailableCount === 0 && withheldCount > 0 && unavailableCount === 0) status = "withheld";
  else status = "partial";
  return { status, lineCount: lines.length, sourceAvailableCount, targetAvailableCount, withheldCount, unavailableCount };
}

function validateResult(value: unknown, context: string, path: string): CaptionProductionArtifact["result"] {
  const item = object(value, context, path);
  exact(item, ["status", "lineCount", "sourceAvailableCount", "targetAvailableCount", "withheldCount", "unavailableCount"], context, path);
  const result = {
    status: oneOf<CaptionProductionStatus>(item.status, OUTPUT_STATUSES, context, `${path}.status`),
    lineCount: integer(item.lineCount, context, `${path}.lineCount`),
    sourceAvailableCount: integer(item.sourceAvailableCount, context, `${path}.sourceAvailableCount`),
    targetAvailableCount: integer(item.targetAvailableCount, context, `${path}.targetAvailableCount`),
    withheldCount: integer(item.withheldCount, context, `${path}.withheldCount`),
    unavailableCount: integer(item.unavailableCount, context, `${path}.unavailableCount`),
  };
  if (
    result.lineCount > CAPTION_PRODUCTION_LIMITS.maxLines ||
    result.sourceAvailableCount > result.lineCount ||
    result.targetAvailableCount > result.lineCount ||
    result.withheldCount > result.lineCount ||
    result.unavailableCount > result.lineCount ||
    result.targetAvailableCount + result.withheldCount > result.lineCount
  ) fail(context, path, "counts exceed the caption line ceiling");
  return result;
}

export function validateCaptionProductionArtifact(
  value: unknown,
  context = "Caption-production artifact",
  path = "artifact",
): CaptionProductionArtifact {
  const item = object(value, context, path);
  const schema = oneOf<CaptionProductionArtifact["schema"]>(item.schema, new Set(["studio.caption-production.artifact.v1", "studio.caption-production.artifact.v2", "studio.caption-production.artifact.v3", "studio.caption-production.artifact.v4", "studio.caption-production.artifact.v5"]), context, `${path}.schema`);
  if (schema !== "studio.caption-production.artifact.v5") {
    exact(item, ["schema", "jobId", "runId", "input", "executor", "lines", "result"], context, path);
  }
  const input = validateCaptionProductionInput(item.input, context, `${path}.input`);
  const executor = validateCaptionExecutorDescriptor(item.executor, context, `${path}.executor`);
  const compactV5 = schema === "studio.caption-production.artifact.v5"
    ? structurallyExactV5(item, context, path)
    : null;
  let materialized: CaptionProductionLine[];
  try {
    materialized = compactV5 ? materializeCaptionProductionLines(compactV5) : item.lines as CaptionProductionLine[];
  } catch (error) {
    fail(context, `${path}.sharedLineage`, error instanceof Error ? error.message : "cannot materialize compact causal references");
  }
  const lines = materialized.map((line, index) =>
    validateLine(line, context, `${path}.lines[${index}]`, schema === "studio.caption-production.artifact.v4" || schema === "studio.caption-production.artifact.v5" ? 4 : schema === "studio.caption-production.artifact.v3" ? 3 : schema === "studio.caption-production.artifact.v2" ? 2 : 1));
  if (lines.length > CAPTION_PRODUCTION_LIMITS.maxLines || new Set(lines.map((line) => line.id)).size !== lines.length) {
    fail(context, `${path}.lines`, "exceed the line ceiling or contain duplicate identities");
  }
  let previousEnd = input.range.startMs;
  const jobId = stableIdentity(item.jobId, context, `${path}.jobId`);
  const runId = stableIdentity(item.runId, context, `${path}.runId`);
  for (const [index, line] of lines.entries()) {
    if (line.startMs < input.range.startMs || line.endMs > input.range.endMs || line.endMs <= line.startMs || line.startMs < previousEnd) {
      fail(context, `${path}.lines[${index}]`, "must be ordered, non-overlapping, and inside the approved analysis range");
    }
    const expectedDerivation = executor.executionScope === "test_demo_only"
      ? "recorded_fixture_test_demo_only"
      : "current_run_source_execution";
    if (
      line.lineage.derivation !== expectedDerivation ||
      line.lineage.source.artifactId !== input.sourceArtifactId ||
      line.lineage.source.contentId !== input.sourceContentId ||
      JSON.stringify({
        studyId: line.lineage.study.studyId,
        artifactId: line.lineage.study.artifactId,
        contentId: line.lineage.study.contentId,
        executorReceiptId: line.lineage.study.executorReceiptId,
        executorReceiptContentId: line.lineage.study.executorReceiptContentId,
      }) !== JSON.stringify(input.study) ||
      JSON.stringify(line.lineage.readiness) !== JSON.stringify(input.readiness) ||
      line.lineage.captionExecutor.jobId !== jobId ||
      line.lineage.captionExecutor.id !== executor.id ||
      line.lineage.captionExecutor.version !== executor.version ||
      line.lineage.captionExecutor.executionScope !== executor.executionScope ||
      line.lineage.captionExecutor.cognitionClaim !== executor.cognitionClaim
    ) fail(context, `${path}.lines[${index}].lineage`, "does not match the current run input and executor scope");
    previousEnd = line.endMs;
  }
  const encoder = new TextEncoder();
  const sourceBytes = lines.reduce((total, line) => total + encoder.encode(line.source.text ?? "").byteLength, 0);
  const targetBytes = lines.reduce((total, line) => total + encoder.encode(line.target.text ?? "").byteLength, 0);
  if (sourceBytes > CAPTION_PRODUCTION_LIMITS.maxSourceBytes || targetBytes > CAPTION_PRODUCTION_LIMITS.maxTargetBytes) {
    fail(context, `${path}.lines`, "exceed the source or target text byte ceiling");
  }
  const result = validateResult(item.result, context, `${path}.result`);
  if (JSON.stringify(result) !== JSON.stringify(deriveCaptionProductionResult(lines))) {
    fail(context, `${path}.result`, "does not match the timed line states");
  }
  if (compactV5) {
    const first = lines[0];
    const causality = first.lineage.generalizedCausality;
    if (!causality || causality.schema !== "studio.caption-line-causality.v4") {
      fail(context, `${path}.sharedLineage.generalizedCausality`, "must materialize one v4 causality closure");
    }
    const normalized = compactCaptionProductionArtifactV5({
      jobId,
      runId,
      input,
      executor,
      lines,
      result,
      sharedLineage: {
        derivation: first.lineage.derivation,
        source: {
          artifactId: first.lineage.source.artifactId,
          contentId: first.lineage.source.contentId,
        },
        study: {
          studyId: first.lineage.study.studyId,
          artifactId: first.lineage.study.artifactId,
          contentId: first.lineage.study.contentId,
          executorReceiptId: first.lineage.study.executorReceiptId,
          executorReceiptContentId: first.lineage.study.executorReceiptContentId,
        },
        readiness: structuredClone(first.lineage.readiness),
        approval: structuredClone(first.lineage.approval),
        captionExecutor: structuredClone(first.lineage.captionExecutor),
        generalizedCausality: {
          schema: causality.schema,
          study: structuredClone(causality.lineage.study),
          readiness: structuredClone(causality.lineage.readiness),
        },
      },
    });
    if (canonicalStructure(normalized) !== canonicalStructure(compactV5)) {
      fail(context, path, "does not use the unique canonical shared-lineage representation");
    }
    return normalized;
  }
  return { schema, jobId, runId, input, executor, lines, result } as CaptionProductionArtifact;
}

export function validateCaptionProductionLimits(value: unknown, context: string, path: string): typeof CAPTION_PRODUCTION_LIMITS {
  const item = object(value, context, path);
  exact(item, Object.keys(CAPTION_PRODUCTION_LIMITS), context, path);
  for (const [key, expected] of Object.entries(CAPTION_PRODUCTION_LIMITS)) {
    if (item[key] !== expected) fail(context, `${path}.${key}`, `must equal ${expected}`);
  }
  return CAPTION_PRODUCTION_LIMITS;
}

export function validateCaptionProductionReceipt(
  value: unknown,
  context = "Caption-production receipt",
  path = "receipt",
): CaptionProductionReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "jobId", "authority", "input", "producer", "limits", "result"], context, path);
  const schema = oneOf<CaptionProductionReceipt["schema"]>(item.schema, new Set(["studio.caption-production.receipt.v1", "studio.caption-production.receipt.v2", "studio.caption-production.receipt.v3", "studio.caption-production.receipt.v4", "studio.caption-production.receipt.v5"]), context, `${path}.schema`);
  const authority = object(item.authority, context, `${path}.authority`);
  exact(authority, ["approval", "verification"], context, `${path}.authority`);
  const verification = object(authority.verification, context, `${path}.authority.verification`);
  exact(verification, ["integrity", "producer", "outcome", "readiness", "study", "unrevokedAtStart"], context, `${path}.authority.verification`);
  literal(verification.integrity, "stored_review_and_verified_queued_intake", context, `${path}.authority.verification.integrity`);
  literal(verification.producer, "host_publish_review_v1", context, `${path}.authority.verification.producer`);
  literal(verification.outcome, "approve_for_caption_production", context, `${path}.authority.verification.outcome`);
  if (verification.unrevokedAtStart !== true) fail(context, `${path}.authority.verification.unrevokedAtStart`, "must be true");
  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version", "policy", "executor"], context, `${path}.producer`);
  literal(producer.id, "studio.host-caption-production", context, `${path}.producer.id`);
  const producerVersion = schema === "studio.caption-production.receipt.v5" ? "5" : schema === "studio.caption-production.receipt.v4" ? "4" : schema === "studio.caption-production.receipt.v3" ? "3" : schema === "studio.caption-production.receipt.v2" ? "2" : "1";
  const producerPolicy = schema === "studio.caption-production.receipt.v5" ? "verified_unrevoked_approval_and_shared_restudied_causality_v5_only" : schema === "studio.caption-production.receipt.v4" ? "verified_unrevoked_approval_and_restudied_causality_v4_only" : schema === "studio.caption-production.receipt.v3" ? "verified_unrevoked_approval_and_generalized_causality_v3_only" : schema === "studio.caption-production.receipt.v2" ? "verified_unrevoked_approval_and_dialogue_scope_only" : "verified_unrevoked_approval_only";
  literal(producer.version, producerVersion, context, `${path}.producer.version`);
  literal(producer.policy, producerPolicy, context, `${path}.producer.policy`);
  const result = object(item.result, context, `${path}.result`);
  exact(result, ["status", "lineCount", "sourceAvailableCount", "targetAvailableCount", "withheldCount", "unavailableCount", "captionArtifactId", "captionContentId", "captionBytes", "lines"], context, `${path}.result`);
  const counts = validateResult({
    status: result.status,
    lineCount: result.lineCount,
    sourceAvailableCount: result.sourceAvailableCount,
    targetAvailableCount: result.targetAvailableCount,
    withheldCount: result.withheldCount,
    unavailableCount: result.unavailableCount,
  }, context, `${path}.result`);
  const captionBytes = integer(result.captionBytes, context, `${path}.result.captionBytes`, 1);
  if (captionBytes > CAPTION_PRODUCTION_LIMITS.maxArtifactBytes) {
    fail(context, `${path}.result.captionBytes`, "exceeds the caption artifact byte ceiling");
  }
  const lines = array(result.lines, context, `${path}.result.lines`).map((value, index) => {
    const linePath = `${path}.result.lines[${index}]`;
    const line = object(value, context, linePath);
    exact(line, [
      "lineId", "startMs", "endMs", "sourceState", "targetState", "reasonCode", "coverageId",
      "coverageState", "claimIds", "semanticEvidenceArtifactIds", "reportArtifactIds",
      ...(schema === "studio.caption-production.receipt.v3" || schema === "studio.caption-production.receipt.v4" || schema === "studio.caption-production.receipt.v5" ? ["generalizedCausality"] : []),
    ], context, linePath);
    const startMs = integer(line.startMs, context, `${linePath}.startMs`);
    const endMs = integer(line.endMs, context, `${linePath}.endMs`, 1);
    if (endMs <= startMs) fail(context, linePath, "must retain a non-empty timed line range");
    return {
      lineId: stableIdentity(line.lineId, context, `${linePath}.lineId`),
      startMs,
      endMs,
      sourceState: oneOf<CaptionProductionLine["source"]["state"]>(line.sourceState, LINE_STATES, context, `${linePath}.sourceState`),
      targetState: oneOf<CaptionProductionLine["target"]["state"]>(line.targetState, LINE_STATES, context, `${linePath}.targetState`),
      reasonCode: line.reasonCode === null ? null : oneOf<NonNullable<CaptionProductionLine["target"]["reasonCode"]>>(line.reasonCode, schema === "studio.caption-production.receipt.v3" || schema === "studio.caption-production.receipt.v4" || schema === "studio.caption-production.receipt.v5" ? V3_REASON_CODES : schema === "studio.caption-production.receipt.v2" ? V2_REASON_CODES : V1_REASON_CODES, context, `${linePath}.reasonCode`),
      coverageId: line.coverageId === null ? null : stableIdentity(line.coverageId, context, `${linePath}.coverageId`),
      coverageState: oneOf<CaptionProductionLine["lineage"]["study"]["coverage"]["state"]>(line.coverageState, new Set(["supported", "withheld", "unknown", "failed", "uncovered", "conflict"]), context, `${linePath}.coverageState`),
      claimIds: array(line.claimIds, context, `${linePath}.claimIds`).map((id, claimIndex) => stableIdentity(id, context, `${linePath}.claimIds[${claimIndex}]`)),
      semanticEvidenceArtifactIds: array(line.semanticEvidenceArtifactIds, context, `${linePath}.semanticEvidenceArtifactIds`).map((id, citationIndex) => stableIdentity(id, context, `${linePath}.semanticEvidenceArtifactIds[${citationIndex}]`)),
      reportArtifactIds: array(line.reportArtifactIds, context, `${linePath}.reportArtifactIds`).map((id, reportIndex) => stableIdentity(id, context, `${linePath}.reportArtifactIds[${reportIndex}]`)),
      ...(schema === "studio.caption-production.receipt.v3" || schema === "studio.caption-production.receipt.v4" || schema === "studio.caption-production.receipt.v5" ? { generalizedCausality: validateGeneralizedCausality(line.generalizedCausality, context, `${linePath}.generalizedCausality`, schema === "studio.caption-production.receipt.v4" || schema === "studio.caption-production.receipt.v5" ? 4 : 3) } : {}),
    };
  });
  if (lines.length !== counts.lineCount || new Set(lines.map((line) => line.lineId)).size !== lines.length) {
    fail(context, `${path}.result.lines`, "must retain every unique timed line identity exactly once");
  }
  const input = validateCaptionProductionInput(item.input, context, `${path}.input`);
  const verifiedReadiness = validateStudyReadinessReceiptIdentity(verification.readiness, context, `${path}.authority.verification.readiness`);
  const verifiedStudy = validateCaptionStudyIdentity(verification.study, context, `${path}.authority.verification.study`);
  if (JSON.stringify(verifiedReadiness) !== JSON.stringify(input.readiness) || JSON.stringify(verifiedStudy) !== JSON.stringify(input.study)) {
    fail(context, `${path}.authority.verification`, "must bind the exact caption study and readiness input");
  }
  return {
    schema,
    receiptId: stableIdentity(item.receiptId, context, `${path}.receiptId`),
    jobId: stableIdentity(item.jobId, context, `${path}.jobId`),
    authority: {
      approval: validatePublishReviewDecisionReceiptIdentity(authority.approval, context, `${path}.authority.approval`),
      verification: {
        integrity: "stored_review_and_verified_queued_intake",
        producer: "host_publish_review_v1",
        outcome: "approve_for_caption_production",
        readiness: verifiedReadiness,
        study: verifiedStudy,
        unrevokedAtStart: true,
      },
    },
    input,
    producer: {
      id: "studio.host-caption-production",
      version: producerVersion,
      policy: producerPolicy,
      executor: validateCaptionExecutorDescriptor(producer.executor, context, `${path}.producer.executor`),
    },
    limits: validateCaptionProductionLimits(item.limits, context, `${path}.limits`),
    result: {
      ...counts,
      captionArtifactId: stableIdentity(result.captionArtifactId, context, `${path}.result.captionArtifactId`),
      captionContentId: contentId(result.captionContentId, context, `${path}.result.captionContentId`),
      captionBytes,
      lines,
    },
  };
}
