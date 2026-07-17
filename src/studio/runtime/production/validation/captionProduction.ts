import type {
  CaptionExecutorDescriptor,
  CaptionProductionArtifact,
  CaptionProductionLine,
  CaptionProductionReceipt,
  CaptionProductionRequest,
  CaptionProductionStatus,
  CaptionStudyIdentity,
} from "../model.ts";
import { CAPTION_PRODUCTION_LIMITS } from "../model.ts";
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
const OUTPUT_STATUSES = new Set(["completed", "partial", "withheld", "unavailable"]);

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
  literal(item.version, "1", context, `${path}.version`);
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
      (id !== "studio.recorded-caption-fixture-adapter" || executionScope !== "test_demo_only" || recognizer === null || translator === null)) ||
    (classification === "deterministic_current_run_test_seam" &&
      (id !== "studio.deterministic-current-run-caption-test-seam" || executionScope !== "current_run" || recognizer === null || translator === null || sourceCaptionContentId !== null)) ||
    (classification === "real_recognizer_translator" &&
      (id !== "studio.openai-caption-producer" || executionScope !== "current_run" || recognizer === null || translator === null || sourceCaptionContentId !== null))
  ) fail(context, path, "executor identity, classification, and evidence must agree");
  return { id, version: "1", classification, executionScope, cognitionClaim: "none", recognizer, translator, sourceCaptionContentId };
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

function validateLine(value: unknown, context: string, path: string, allowDialogueScopeReason: boolean): CaptionProductionLine {
  const item = object(value, context, path);
  exact(item, ["id", "startMs", "endMs", "lineage", "source", "target"], context, path);
  const lineage = object(item.lineage, context, `${path}.lineage`);
  exact(lineage, ["derivation", "source", "study", "readiness", "approval", "captionExecutor"], context, `${path}.lineage`);
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
      allowDialogueScopeReason ? V2_REASON_CODES : V1_REASON_CODES,
      context,
      `${path}.source.reasonCode`,
    );
  const targetReason = target.reasonCode === null
    ? null
    : oneOf<CaptionProductionLine["target"]["reasonCode"] & string>(
      target.reasonCode,
      allowDialogueScopeReason ? V2_REASON_CODES : V1_REASON_CODES,
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
        (sourceReason !== expectedStudyReason && (!allowDialogueScopeReason || sourceReason !== "not_in_requested_dialogue_scope")) ||
        (targetReason !== expectedStudyReason && (!allowDialogueScopeReason || targetReason !== "not_in_requested_dialogue_scope")) || sourceReason !== targetReason ||
        claimIds.length !== 0 || semanticCitations.length !== 0 || childReports.length !== 0))
  ) fail(context, `${path}.lineage.study`, "does not close supported coverage/citations or a null withheld range");
  const captionExecutor = object(lineage.captionExecutor, context, `${path}.lineage.captionExecutor`);
  exact(captionExecutor, ["jobId", "id", "version", "executionScope", "cognitionClaim"], context, `${path}.lineage.captionExecutor`);
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
        version: literal(captionExecutor.version, "1", context, `${path}.lineage.captionExecutor.version`),
        executionScope: oneOf(captionExecutor.executionScope, new Set(["test_demo_only", "current_run"]), context, `${path}.lineage.captionExecutor.executionScope`),
        cognitionClaim: literal(captionExecutor.cognitionClaim, "none", context, `${path}.lineage.captionExecutor.cognitionClaim`),
      },
    },
    source: { language: literal(source.language, "ko", context, `${path}.source.language`), state: sourceState, text: sourceText, reasonCode: sourceReason },
    target: { language: literal(target.language, "en", context, `${path}.target.language`), state: targetState, text: targetText, reasonCode: targetReason },
  };
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
  exact(item, ["schema", "jobId", "runId", "input", "executor", "lines", "result"], context, path);
  const schema = oneOf<CaptionProductionArtifact["schema"]>(item.schema, new Set(["studio.caption-production.artifact.v1", "studio.caption-production.artifact.v2"]), context, `${path}.schema`);
  const input = validateCaptionProductionInput(item.input, context, `${path}.input`);
  const executor = validateCaptionExecutorDescriptor(item.executor, context, `${path}.executor`);
  const lines = array(item.lines, context, `${path}.lines`).map((line, index) =>
    validateLine(line, context, `${path}.lines[${index}]`, schema === "studio.caption-production.artifact.v2"));
  if (lines.length > CAPTION_PRODUCTION_LIMITS.maxLines || new Set(lines.map((line) => line.id)).size !== lines.length) {
    fail(context, `${path}.lines`, "exceed the line ceiling or contain duplicate identities");
  }
  let previousEnd = input.range.startMs;
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
      line.lineage.captionExecutor.jobId !== stableIdentity(item.jobId, context, `${path}.jobId`) ||
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
  return {
    schema,
    jobId: stableIdentity(item.jobId, context, `${path}.jobId`),
    runId: stableIdentity(item.runId, context, `${path}.runId`),
    input,
    executor,
    lines,
    result,
  };
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
  const schema = oneOf<CaptionProductionReceipt["schema"]>(item.schema, new Set(["studio.caption-production.receipt.v1", "studio.caption-production.receipt.v2"]), context, `${path}.schema`);
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
  literal(producer.version, schema === "studio.caption-production.receipt.v2" ? "2" : "1", context, `${path}.producer.version`);
  literal(producer.policy, schema === "studio.caption-production.receipt.v2" ? "verified_unrevoked_approval_and_dialogue_scope_only" : "verified_unrevoked_approval_only", context, `${path}.producer.policy`);
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
      reasonCode: line.reasonCode === null ? null : oneOf<NonNullable<CaptionProductionLine["target"]["reasonCode"]>>(line.reasonCode, schema === "studio.caption-production.receipt.v2" ? V2_REASON_CODES : V1_REASON_CODES, context, `${linePath}.reasonCode`),
      coverageId: line.coverageId === null ? null : stableIdentity(line.coverageId, context, `${linePath}.coverageId`),
      coverageState: oneOf<CaptionProductionLine["lineage"]["study"]["coverage"]["state"]>(line.coverageState, new Set(["supported", "withheld", "unknown", "failed", "uncovered", "conflict"]), context, `${linePath}.coverageState`),
      claimIds: array(line.claimIds, context, `${linePath}.claimIds`).map((id, claimIndex) => stableIdentity(id, context, `${linePath}.claimIds[${claimIndex}]`)),
      semanticEvidenceArtifactIds: array(line.semanticEvidenceArtifactIds, context, `${linePath}.semanticEvidenceArtifactIds`).map((id, citationIndex) => stableIdentity(id, context, `${linePath}.semanticEvidenceArtifactIds[${citationIndex}]`)),
      reportArtifactIds: array(line.reportArtifactIds, context, `${linePath}.reportArtifactIds`).map((id, reportIndex) => stableIdentity(id, context, `${linePath}.reportArtifactIds[${reportIndex}]`)),
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
      version: schema === "studio.caption-production.receipt.v2" ? "2" : "1",
      policy: schema === "studio.caption-production.receipt.v2" ? "verified_unrevoked_approval_and_dialogue_scope_only" : "verified_unrevoked_approval_only",
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
