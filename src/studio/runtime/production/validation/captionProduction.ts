import type {
  CaptionExecutorDescriptor,
  CaptionProductionArtifact,
  CaptionProductionLine,
  CaptionProductionReceipt,
  CaptionProductionRequest,
  CaptionProductionStatus,
} from "../model.ts";
import { CAPTION_PRODUCTION_LIMITS } from "../model.ts";
import { validatePublishReviewDecisionReceiptIdentity } from "./publishReviewDecision.ts";
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
const REASON_CODES = new Set([
  "recorded_quality_gate_withheld",
  "recognizer_unavailable",
  "recognizer_empty",
  "translator_unavailable",
  "translator_missing_line",
  "source_unavailable",
]);
const OUTPUT_STATUSES = new Set(["completed", "partial", "withheld", "unavailable"]);

function stableIdentity(value: unknown, context: string, path: string): string {
  const identity = string(value, context, path);
  if (identity.length > 200 || identity.trim() !== identity || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(identity)) {
    fail(context, path, "must be a stable path-free identity");
  }
  return identity;
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
    new Set(["recorded_real_pipeline_fixture", "real_recognizer_translator"]),
    context,
    `${path}.classification`,
  );
  const id = oneOf<CaptionExecutorDescriptor["id"]>(
    item.id,
    new Set(["studio.recorded-caption-fixture-adapter", "studio.openai-caption-producer"]),
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
  exact(item, ["sourceArtifactId", "sourceContentId", "analysisRequestId", "range", "sourceLanguage", "targetLanguage", "acceptedChildOutput", "rootPromotion"], context, path);
  const range = object(item.range, context, `${path}.range`);
  exact(range, ["startMs", "endMs"], context, `${path}.range`);
  const startMs = integer(range.startMs, context, `${path}.range.startMs`);
  const endMs = integer(range.endMs, context, `${path}.range.endMs`, 1);
  if (endMs <= startMs || endMs - startMs > CAPTION_PRODUCTION_LIMITS.maxDurationMs) {
    fail(context, `${path}.range`, "must be non-empty and within the caption duration ceiling");
  }
  const acceptedChildOutput = object(item.acceptedChildOutput, context, `${path}.acceptedChildOutput`);
  exact(acceptedChildOutput, ["artifactId", "contentId"], context, `${path}.acceptedChildOutput`);
  const rootPromotion = object(item.rootPromotion, context, `${path}.rootPromotion`);
  exact(rootPromotion, ["dispositionId", "artifactId", "contentId", "receiptId", "receiptContentId"], context, `${path}.rootPromotion`);
  return {
    sourceArtifactId: stableIdentity(item.sourceArtifactId, context, `${path}.sourceArtifactId`),
    sourceContentId: contentId(item.sourceContentId, context, `${path}.sourceContentId`),
    analysisRequestId: stableIdentity(item.analysisRequestId, context, `${path}.analysisRequestId`),
    range: { startMs, endMs },
    sourceLanguage: literal(item.sourceLanguage, "ko", context, `${path}.sourceLanguage`),
    targetLanguage: literal(item.targetLanguage, "en", context, `${path}.targetLanguage`),
    acceptedChildOutput: {
      artifactId: stableIdentity(acceptedChildOutput.artifactId, context, `${path}.acceptedChildOutput.artifactId`),
      contentId: contentId(acceptedChildOutput.contentId, context, `${path}.acceptedChildOutput.contentId`),
    },
    rootPromotion: {
      dispositionId: stableIdentity(rootPromotion.dispositionId, context, `${path}.rootPromotion.dispositionId`),
      artifactId: stableIdentity(rootPromotion.artifactId, context, `${path}.rootPromotion.artifactId`),
      contentId: contentId(rootPromotion.contentId, context, `${path}.rootPromotion.contentId`),
      receiptId: stableIdentity(rootPromotion.receiptId, context, `${path}.rootPromotion.receiptId`),
      receiptContentId: contentId(rootPromotion.receiptContentId, context, `${path}.rootPromotion.receiptContentId`),
    },
  };
}

function validateLine(value: unknown, context: string, path: string): CaptionProductionLine {
  const item = object(value, context, path);
  exact(item, ["id", "startMs", "endMs", "lineage", "source", "target"], context, path);
  const lineage = object(item.lineage, context, `${path}.lineage`);
  exact(lineage, ["derivation", "source", "acceptedChildOutput", "rootPromotion"], context, `${path}.lineage`);
  const lineageSource = object(lineage.source, context, `${path}.lineage.source`);
  exact(lineageSource, ["artifactId", "contentId", "window"], context, `${path}.lineage.source`);
  const lineageWindow = object(lineageSource.window, context, `${path}.lineage.source.window`);
  exact(lineageWindow, ["startMs", "endMs"], context, `${path}.lineage.source.window`);
  const lineageChild = object(lineage.acceptedChildOutput, context, `${path}.lineage.acceptedChildOutput`);
  exact(lineageChild, ["artifactId", "contentId"], context, `${path}.lineage.acceptedChildOutput`);
  const lineagePromotion = object(lineage.rootPromotion, context, `${path}.lineage.rootPromotion`);
  exact(lineagePromotion, ["dispositionId", "artifactId", "contentId", "receiptId", "receiptContentId"], context, `${path}.lineage.rootPromotion`);
  const source = object(item.source, context, `${path}.source`);
  exact(source, ["language", "state", "text", "reasonCode"], context, `${path}.source`);
  const target = object(item.target, context, `${path}.target`);
  exact(target, ["language", "state", "text", "reasonCode"], context, `${path}.target`);
  const sourceState = oneOf<"available" | "unavailable">(
    source.state,
    new Set(["available", "unavailable"]),
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
    : oneOf<"recognizer_unavailable" | "recognizer_empty">(
      source.reasonCode,
      new Set(["recognizer_unavailable", "recognizer_empty"]),
      context,
      `${path}.source.reasonCode`,
    );
  const targetReason = target.reasonCode === null
    ? null
    : oneOf<"recorded_quality_gate_withheld" | "recognizer_unavailable" | "recognizer_empty" | "translator_unavailable" | "translator_missing_line" | "source_unavailable">(
      target.reasonCode,
      REASON_CODES,
      context,
      `${path}.target.reasonCode`,
    );
  if (
    (sourceState === "available" && (sourceText === null || sourceReason !== null)) ||
    (sourceState === "unavailable" && (sourceText !== null || sourceReason === null)) ||
    (targetState === "available" && (targetText === null || targetReason !== null || sourceState !== "available")) ||
    (targetState !== "available" && (targetText !== null || targetReason === null)) ||
    (sourceState === "unavailable" && (targetState !== "unavailable" || targetReason !== "source_unavailable")) ||
    (sourceState === "available" && targetState === "unavailable" &&
      targetReason !== "translator_unavailable" && targetReason !== "translator_missing_line") ||
    (targetState === "withheld" && targetReason !== "recorded_quality_gate_withheld")
  ) fail(context, path, "line state, text, and closed reason do not agree");
  const startMs = integer(item.startMs, context, `${path}.startMs`);
  const endMs = integer(item.endMs, context, `${path}.endMs`, 1);
  const windowStartMs = integer(lineageWindow.startMs, context, `${path}.lineage.source.window.startMs`);
  const windowEndMs = integer(lineageWindow.endMs, context, `${path}.lineage.source.window.endMs`, 1);
  if (windowStartMs !== startMs || windowEndMs !== endMs) {
    fail(context, `${path}.lineage.source.window`, "must equal the exact caption line window");
  }
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
      acceptedChildOutput: {
        artifactId: stableIdentity(lineageChild.artifactId, context, `${path}.lineage.acceptedChildOutput.artifactId`),
        contentId: contentId(lineageChild.contentId, context, `${path}.lineage.acceptedChildOutput.contentId`),
      },
      rootPromotion: {
        dispositionId: stableIdentity(lineagePromotion.dispositionId, context, `${path}.lineage.rootPromotion.dispositionId`),
        artifactId: stableIdentity(lineagePromotion.artifactId, context, `${path}.lineage.rootPromotion.artifactId`),
        contentId: contentId(lineagePromotion.contentId, context, `${path}.lineage.rootPromotion.contentId`),
        receiptId: stableIdentity(lineagePromotion.receiptId, context, `${path}.lineage.rootPromotion.receiptId`),
        receiptContentId: contentId(lineagePromotion.receiptContentId, context, `${path}.lineage.rootPromotion.receiptContentId`),
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
  literal(item.schema, "studio.caption-production.artifact.v1", context, `${path}.schema`);
  const input = validateCaptionProductionInput(item.input, context, `${path}.input`);
  const executor = validateCaptionExecutorDescriptor(item.executor, context, `${path}.executor`);
  const lines = array(item.lines, context, `${path}.lines`).map((line, index) =>
    validateLine(line, context, `${path}.lines[${index}]`));
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
      JSON.stringify(line.lineage.acceptedChildOutput) !== JSON.stringify(input.acceptedChildOutput) ||
      JSON.stringify(line.lineage.rootPromotion) !== JSON.stringify(input.rootPromotion)
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
    schema: "studio.caption-production.artifact.v1",
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
  literal(item.schema, "studio.caption-production.receipt.v1", context, `${path}.schema`);
  const authority = object(item.authority, context, `${path}.authority`);
  exact(authority, ["approval", "verification"], context, `${path}.authority`);
  const verification = object(authority.verification, context, `${path}.authority.verification`);
  exact(verification, ["integrity", "producer", "outcome", "unrevokedAtStart"], context, `${path}.authority.verification`);
  literal(verification.integrity, "stored_review_and_verified_queued_intake", context, `${path}.authority.verification.integrity`);
  literal(verification.producer, "host_publish_review_v1", context, `${path}.authority.verification.producer`);
  literal(verification.outcome, "approve_for_caption_production", context, `${path}.authority.verification.outcome`);
  if (verification.unrevokedAtStart !== true) fail(context, `${path}.authority.verification.unrevokedAtStart`, "must be true");
  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version", "policy", "executor"], context, `${path}.producer`);
  literal(producer.id, "studio.host-caption-production", context, `${path}.producer.id`);
  literal(producer.version, "1", context, `${path}.producer.version`);
  literal(producer.policy, "verified_unrevoked_approval_only", context, `${path}.producer.policy`);
  const result = object(item.result, context, `${path}.result`);
  exact(result, ["status", "lineCount", "sourceAvailableCount", "targetAvailableCount", "withheldCount", "unavailableCount", "captionArtifactId", "captionContentId", "captionBytes"], context, `${path}.result`);
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
  return {
    schema: "studio.caption-production.receipt.v1",
    receiptId: stableIdentity(item.receiptId, context, `${path}.receiptId`),
    jobId: stableIdentity(item.jobId, context, `${path}.jobId`),
    authority: {
      approval: validatePublishReviewDecisionReceiptIdentity(authority.approval, context, `${path}.authority.approval`),
      verification: {
        integrity: "stored_review_and_verified_queued_intake",
        producer: "host_publish_review_v1",
        outcome: "approve_for_caption_production",
        unrevokedAtStart: true,
      },
    },
    input: validateCaptionProductionInput(item.input, context, `${path}.input`),
    producer: {
      id: "studio.host-caption-production",
      version: "1",
      policy: "verified_unrevoked_approval_only",
      executor: validateCaptionExecutorDescriptor(producer.executor, context, `${path}.producer.executor`),
    },
    limits: validateCaptionProductionLimits(item.limits, context, `${path}.limits`),
    result: {
      ...counts,
      captionArtifactId: stableIdentity(result.captionArtifactId, context, `${path}.result.captionArtifactId`),
      captionContentId: contentId(result.captionContentId, context, `${path}.result.captionContentId`),
      captionBytes,
    },
  };
}
