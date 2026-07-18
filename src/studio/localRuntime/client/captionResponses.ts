import { canonicalJsonLine, identifyUtf8 } from "../../runtime/production/observability/hash.ts";
import type {
  RuntimeHostCaptionProductionResultsResponse,
  RuntimeHostCaptionProductionResponse,
  RuntimeHostCaptionQualityControlResponse,
} from "../../runtime/production/runtimeHost/model.ts";
import { validateCaptionProductionArtifact } from "../../runtime/production/validation/captionProduction.ts";
import {
  contentId,
  exact,
  fail,
  identity,
  integer,
  object,
  string,
} from "./responseGuards.ts";

function studyIdentity(value: unknown, path: string) {
  const item = object(value, path);
  exact(item, ["studyId", "artifactId", "contentId", "executorReceiptId", "executorReceiptContentId"], path);
  return {
    studyId: identity(item.studyId, `${path}.studyId`),
    artifactId: identity(item.artifactId, `${path}.artifactId`),
    contentId: contentId(item.contentId, `${path}.contentId`),
    executorReceiptId: identity(item.executorReceiptId, `${path}.executorReceiptId`),
    executorReceiptContentId: contentId(item.executorReceiptContentId, `${path}.executorReceiptContentId`),
  };
}

function readinessIdentity(value: unknown, path: string) {
  const item = object(value, path);
  exact(item, ["readinessId", "artifactId", "receiptId", "receiptContentId"], path);
  return {
    readinessId: identity(item.readinessId, `${path}.readinessId`),
    artifactId: identity(item.artifactId, `${path}.artifactId`),
    receiptId: identity(item.receiptId, `${path}.receiptId`),
    receiptContentId: contentId(item.receiptContentId, `${path}.receiptContentId`),
  };
}

function identityArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail(path, "must be an array.");
  const ids = value.map((entry, index) => identity(entry, `${path}[${index}]`));
  if (new Set(ids).size !== ids.length) fail(path, "contains duplicate identities.");
  return ids;
}

export function captionProductionResponse(
  value: unknown,
  expectedRuntimeId: string,
): RuntimeHostCaptionProductionResponse {
  const context = "Runtime host caption productions";
  const item = object(value, context);
  exact(item, ["schema", "commandId", "runtimeId", "journalHead", "captions"], context);
  if (item.schema !== "studio.local-runtime-caption-productions.v1") fail(context, "schema is unsupported.");
  const runtimeId = identity(item.runtimeId, `${context}.runtimeId`);
  if (runtimeId !== expectedRuntimeId) fail(context, "runtime identity changed.");
  if (!Array.isArray(item.captions)) fail(`${context}.captions`, "must be an array.");
  const jobIds = new Set<string>();
  const approvals = new Set<string>();
  const captions = item.captions.map((candidate, index) => {
    const captionContext = `${context}.captions[${index}]`;
    const caption = object(candidate, captionContext);
    exact(caption, [
      "jobId",
      "approval",
      "source",
      "study",
      "readiness",
      "reopened",
      "authorityState",
      "integrity",
      "captionArtifactId",
      "captionContentId",
      "receiptArtifactId",
      "receiptId",
      "receiptContentId",
      "executor",
      "result",
    ], captionContext);
    const jobId = identity(caption.jobId, `${captionContext}.jobId`);
    if (jobIds.has(jobId)) fail(`${captionContext}.jobId`, "is duplicated.");
    jobIds.add(jobId);
    const approval = object(caption.approval, `${captionContext}.approval`);
    exact(approval, ["reviewId", "artifactId", "receiptId", "receiptContentId"], `${captionContext}.approval`);
    const approvalValue = {
      reviewId: identity(approval.reviewId, `${captionContext}.approval.reviewId`),
      artifactId: identity(approval.artifactId, `${captionContext}.approval.artifactId`),
      receiptId: identity(approval.receiptId, `${captionContext}.approval.receiptId`),
      receiptContentId: contentId(approval.receiptContentId, `${captionContext}.approval.receiptContentId`),
    };
    if (approvals.has(approvalValue.reviewId)) fail(`${captionContext}.approval.reviewId`, "already has captions.");
    approvals.add(approvalValue.reviewId);
    if (caption.authorityState !== "unrevoked" && caption.authorityState !== "revoked_after_completion") {
      fail(`${captionContext}.authorityState`, "is unsupported.");
    }
    if (caption.integrity !== "stored_caption_and_receipt_with_verified_study_readiness_approval") {
      fail(`${captionContext}.integrity`, "does not carry closed caption verification.");
    }
    const source = object(caption.source, `${captionContext}.source`);
    exact(source, ["artifactId", "contentId", "analysisRequestId", "range"], `${captionContext}.source`);
    const sourceRange = object(source.range, `${captionContext}.source.range`);
    exact(sourceRange, ["startMs", "endMs"], `${captionContext}.source.range`);
    const sourceValue = {
      artifactId: identity(source.artifactId, `${captionContext}.source.artifactId`),
      contentId: contentId(source.contentId, `${captionContext}.source.contentId`),
      analysisRequestId: identity(source.analysisRequestId, `${captionContext}.source.analysisRequestId`),
      range: {
        startMs: integer(sourceRange.startMs, `${captionContext}.source.range.startMs`),
        endMs: integer(sourceRange.endMs, `${captionContext}.source.range.endMs`),
      },
    };
    if (sourceValue.range.endMs <= sourceValue.range.startMs) fail(`${captionContext}.source.range`, "must be non-empty.");
    const study = studyIdentity(caption.study, `${captionContext}.study`);
    const readiness = readinessIdentity(caption.readiness, `${captionContext}.readiness`);
    const reopened = object(caption.reopened, `${captionContext}.reopened`);
    exact(reopened, ["sourceArtifactIds", "semanticEvidenceArtifactIds", "reportArtifactIds", "admissionIds", "planningDecisionIds", "executorIds"], `${captionContext}.reopened`);
    const reopenedValue = {
      sourceArtifactIds: identityArray(reopened.sourceArtifactIds, `${captionContext}.reopened.sourceArtifactIds`),
      semanticEvidenceArtifactIds: identityArray(reopened.semanticEvidenceArtifactIds, `${captionContext}.reopened.semanticEvidenceArtifactIds`),
      reportArtifactIds: identityArray(reopened.reportArtifactIds, `${captionContext}.reopened.reportArtifactIds`),
      admissionIds: identityArray(reopened.admissionIds, `${captionContext}.reopened.admissionIds`),
      planningDecisionIds: identityArray(reopened.planningDecisionIds, `${captionContext}.reopened.planningDecisionIds`),
      executorIds: identityArray(reopened.executorIds, `${captionContext}.reopened.executorIds`),
    };
    if (!reopenedValue.sourceArtifactIds.includes(sourceValue.artifactId)) fail(`${captionContext}.reopened`, "omits the caption source.");
    const executor = object(caption.executor, `${captionContext}.executor`);
    exact(executor, ["id", "version", "classification", "executionScope", "cognitionClaim", "recognizer", "translator", "sourceCaptionContentId"], `${captionContext}.executor`);
    if (executor.version !== "1" && executor.version !== "2") {
      fail(`${captionContext}.executor.version`, "is unsupported.");
    }
    if (
      (executor.classification === "recorded_real_pipeline_fixture" && executor.id !== "studio.recorded-caption-fixture-adapter") ||
      (executor.classification === "deterministic_current_run_test_seam" && executor.id !== "studio.deterministic-current-run-caption-test-seam") ||
      (executor.classification === "real_recognizer_translator" && executor.id !== "studio.openai-caption-producer") ||
      (executor.classification !== "recorded_real_pipeline_fixture" && executor.classification !== "deterministic_current_run_test_seam" && executor.classification !== "real_recognizer_translator") ||
      (executor.classification === "recorded_real_pipeline_fixture" && executor.executionScope !== "test_demo_only") ||
      (executor.classification === "deterministic_current_run_test_seam" && executor.executionScope !== "current_run") ||
      (executor.classification === "real_recognizer_translator" && executor.executionScope !== "current_run") ||
      (executor.classification !== "real_recognizer_translator" && executor.version !== "1") ||
      executor.cognitionClaim !== "none"
    ) fail(`${captionContext}.executor`, "identity and classification do not agree.");
    const recognizer = executor.recognizer === null ? null : string(executor.recognizer, `${captionContext}.executor.recognizer`);
    const translator = executor.translator === null ? null : string(executor.translator, `${captionContext}.executor.translator`);
    const sourceCaptionContentId = executor.sourceCaptionContentId === null
      ? null
      : contentId(executor.sourceCaptionContentId, `${captionContext}.executor.sourceCaptionContentId`);
    if (
      recognizer === null || translator === null ||
      (executor.classification === "real_recognizer_translator" && sourceCaptionContentId !== null)
    ) {
      fail(`${captionContext}.executor`, "real execution evidence is inconsistent.");
    }
    const result = object(caption.result, `${captionContext}.result`);
    exact(result, ["status", "lineCount", "sourceAvailableCount", "targetAvailableCount", "withheldCount", "unavailableCount"], `${captionContext}.result`);
    if (!["completed", "partial", "withheld", "unavailable"].includes(result.status as string)) {
      fail(`${captionContext}.result.status`, "is unsupported.");
    }
    const lineCount = integer(result.lineCount, `${captionContext}.result.lineCount`);
    const sourceAvailableCount = integer(result.sourceAvailableCount, `${captionContext}.result.sourceAvailableCount`);
    const targetAvailableCount = integer(result.targetAvailableCount, `${captionContext}.result.targetAvailableCount`);
    const withheldCount = integer(result.withheldCount, `${captionContext}.result.withheldCount`);
    const unavailableCount = integer(result.unavailableCount, `${captionContext}.result.unavailableCount`);
    if (
      lineCount > 64 || sourceAvailableCount > lineCount || targetAvailableCount > lineCount ||
      withheldCount > lineCount || unavailableCount > lineCount ||
      targetAvailableCount + withheldCount > lineCount
    ) fail(`${captionContext}.result`, "counts exceed the closed line ceiling.");
    return {
      jobId,
      approval: approvalValue,
      source: sourceValue,
      study,
      readiness,
      reopened: reopenedValue,
      authorityState: caption.authorityState as "unrevoked" | "revoked_after_completion",
      integrity: "stored_caption_and_receipt_with_verified_study_readiness_approval" as const,
      captionArtifactId: identity(caption.captionArtifactId, `${captionContext}.captionArtifactId`),
      captionContentId: contentId(caption.captionContentId, `${captionContext}.captionContentId`),
      receiptArtifactId: identity(caption.receiptArtifactId, `${captionContext}.receiptArtifactId`),
      receiptId: identity(caption.receiptId, `${captionContext}.receiptId`),
      receiptContentId: contentId(caption.receiptContentId, `${captionContext}.receiptContentId`),
      executor: {
        id: executor.id as "studio.recorded-caption-fixture-adapter" | "studio.deterministic-current-run-caption-test-seam" | "studio.openai-caption-producer",
        version: executor.version as "1" | "2",
        classification: executor.classification as "recorded_real_pipeline_fixture" | "deterministic_current_run_test_seam" | "real_recognizer_translator",
        executionScope: executor.executionScope as "test_demo_only" | "current_run",
        cognitionClaim: "none" as const,
        recognizer,
        translator,
        sourceCaptionContentId,
      },
      result: {
        status: result.status as "completed" | "partial" | "withheld" | "unavailable",
        lineCount,
        sourceAvailableCount,
        targetAvailableCount,
        withheldCount,
        unavailableCount,
      },
    };
  });
  return {
    schema: "studio.local-runtime-caption-productions.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId,
    journalHead: integer(item.journalHead, `${context}.journalHead`),
    captions,
  };
}

export async function captionProductionResultsResponse(
  value: unknown,
  expectedRuntimeId: string,
): Promise<RuntimeHostCaptionProductionResultsResponse> {
  const context = "Runtime host caption production results";
  const item = object(value, context);
  exact(item, ["schema", "commandId", "runtimeId", "journalHead", "results"], context);
  if (item.schema !== "studio.local-runtime-caption-production-results.v1") {
    fail(context, "schema is unsupported.");
  }
  const runtimeId = identity(item.runtimeId, `${context}.runtimeId`);
  if (runtimeId !== expectedRuntimeId) fail(context, "runtime identity changed.");
  if (!Array.isArray(item.results)) fail(`${context}.results`, "must be an array.");
  const entries = item.results.map((candidate, index) => {
    const resultContext = `${context}.results[${index}]`;
    const result = object(candidate, resultContext);
    exact(result, ["verification", "artifact"], resultContext);
    return result;
  });
  const verifications = captionProductionResponse({
    schema: "studio.local-runtime-caption-productions.v1",
    commandId: item.commandId,
    runtimeId,
    journalHead: item.journalHead,
    captions: entries.map((entry) => entry.verification),
  }, runtimeId).captions;
  const results = await Promise.all(entries.map(async (entry, index) => {
    const resultContext = `${context}.results[${index}]`;
    const verification = verifications[index];
    const artifact = validateCaptionProductionArtifact(
      entry.artifact,
      context,
      `results[${index}].artifact`,
    );
    if (
      artifact.runId !== runtimeId ||
      artifact.jobId !== verification.jobId ||
      JSON.stringify(artifact.executor) !== JSON.stringify(verification.executor) ||
      JSON.stringify(artifact.input.study) !== JSON.stringify(verification.study) ||
      JSON.stringify(artifact.input.readiness) !== JSON.stringify(verification.readiness) ||
      artifact.input.sourceArtifactId !== verification.source.artifactId ||
      artifact.input.sourceContentId !== verification.source.contentId ||
      artifact.input.analysisRequestId !== verification.source.analysisRequestId ||
      JSON.stringify(artifact.input.range) !== JSON.stringify(verification.source.range) ||
      JSON.stringify(artifact.result) !== JSON.stringify(verification.result)
    ) {
      fail(resultContext, "verified identities, executor, or result counts do not match the artifact.");
    }
    const measuredContent = await identifyUtf8(canonicalJsonLine(artifact));
    if (measuredContent.contentId !== verification.captionContentId) {
      fail(resultContext, "artifact bytes do not match the verified caption content identity.");
    }
    return { verification, artifact };
  }));
  return {
    schema: "studio.local-runtime-caption-production-results.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId,
    journalHead: integer(item.journalHead, `${context}.journalHead`),
    results,
  };
}

export function captionQualityControlResponse(
  value: unknown,
  expectedRuntimeId: string,
): RuntimeHostCaptionQualityControlResponse {
  const context = "Runtime host caption quality controls";
  const item = object(value, context);
  exact(item, ["schema", "commandId", "runtimeId", "journalHead", "qualityControls"], context);
  if (item.schema !== "studio.local-runtime-caption-quality-controls.v1") fail(context, "schema is unsupported.");
  const runtimeId = identity(item.runtimeId, `${context}.runtimeId`);
  if (runtimeId !== expectedRuntimeId) fail(context, "runtime identity changed.");
  if (!Array.isArray(item.qualityControls)) fail(`${context}.qualityControls`, "must be an array.");
  const qcIds = new Set<string>();
  const qualityControls = item.qualityControls.map((candidate, index) => {
    const qcContext = `${context}.qualityControls[${index}]`;
    const qc = object(candidate, qcContext);
    exact(qc, [
      "qcId", "jobId", "captionArtifactId", "captionContentId", "outputArtifactId",
      "receiptId", "receiptContentId", "integrity", "policy", "outcome", "reasonCodes",
      "acceptedLineIds", "withheldLineIds",
      "candidate",
    ], qcContext);
    const qcId = identity(qc.qcId, `${qcContext}.qcId`);
    if (qcIds.has(qcId)) fail(`${qcContext}.qcId`, "is duplicated.");
    qcIds.add(qcId);
    if (qc.integrity !== "stored_independent_qc_with_verified_current_run_candidate") {
      fail(`${qcContext}.integrity`, "does not carry closed independent QC verification.");
    }
    if (qc.policy !== "structural_current_run_gate_without_semantic_quality_score") {
      fail(`${qcContext}.policy`, "claims an unsupported quality policy.");
    }
    if (qc.outcome !== "accepted" && qc.outcome !== "withheld") {
      fail(`${qcContext}.outcome`, "is unsupported.");
    }
    if (!Array.isArray(qc.reasonCodes) || qc.reasonCodes.length !== 1) {
      fail(`${qcContext}.reasonCodes`, "must contain one closed reason.");
    }
    const reasons = new Set([
      "current_run_candidate_structurally_complete",
      "recorded_fixture_test_demo_only",
      "candidate_has_unavailable_or_withheld_lines",
      "candidate_has_no_lines",
    ]);
    const reasonCode = string(qc.reasonCodes[0], `${qcContext}.reasonCodes[0]`);
    if (!reasons.has(reasonCode)) fail(`${qcContext}.reasonCodes[0]`, "is unsupported.");
    const lineIds = (value: unknown, path: string): string[] => {
      if (!Array.isArray(value)) fail(path, "must be an array.");
      const ids = value.map((entry, lineIndex) => identity(entry, `${path}[${lineIndex}]`));
      if (new Set(ids).size !== ids.length) fail(path, "contains duplicate line identities.");
      return ids;
    };
    const acceptedLineIds = lineIds(qc.acceptedLineIds, `${qcContext}.acceptedLineIds`);
    const withheldLineIds = lineIds(qc.withheldLineIds, `${qcContext}.withheldLineIds`);
    if (acceptedLineIds.some((id) => withheldLineIds.includes(id))) {
      fail(qcContext, "a line cannot be both accepted and withheld.");
    }
    if (
      (qc.outcome === "accepted" && (reasonCode !== "current_run_candidate_structurally_complete" || acceptedLineIds.length === 0 || withheldLineIds.length > 0)) ||
      (qc.outcome === "withheld" && reasonCode === "current_run_candidate_structurally_complete")
    ) fail(qcContext, "outcome, reason, and line decisions do not agree.");
    const candidateVerification = captionProductionResponse({
      schema: "studio.local-runtime-caption-productions.v1",
      commandId: item.commandId,
      runtimeId,
      journalHead: item.journalHead,
      captions: [qc.candidate],
    }, runtimeId).captions[0];
    if (
      candidateVerification.jobId !== qc.jobId ||
      candidateVerification.captionArtifactId !== qc.captionArtifactId ||
      candidateVerification.captionContentId !== qc.captionContentId
    ) fail(`${qcContext}.candidate`, "does not match the QC candidate identity.");
    return {
      qcId,
      jobId: identity(qc.jobId, `${qcContext}.jobId`),
      captionArtifactId: identity(qc.captionArtifactId, `${qcContext}.captionArtifactId`),
      captionContentId: contentId(qc.captionContentId, `${qcContext}.captionContentId`),
      outputArtifactId: identity(qc.outputArtifactId, `${qcContext}.outputArtifactId`),
      receiptId: identity(qc.receiptId, `${qcContext}.receiptId`),
      receiptContentId: contentId(qc.receiptContentId, `${qcContext}.receiptContentId`),
      integrity: "stored_independent_qc_with_verified_current_run_candidate" as const,
      policy: "structural_current_run_gate_without_semantic_quality_score" as const,
      outcome: qc.outcome as "accepted" | "withheld",
      reasonCodes: [reasonCode as "current_run_candidate_structurally_complete" | "recorded_fixture_test_demo_only" | "candidate_has_unavailable_or_withheld_lines" | "candidate_has_no_lines"],
      acceptedLineIds,
      withheldLineIds,
      candidate: candidateVerification,
    };
  });
  return {
    schema: "studio.local-runtime-caption-quality-controls.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId,
    journalHead: integer(item.journalHead, `${context}.journalHead`),
    qualityControls,
  };
}
