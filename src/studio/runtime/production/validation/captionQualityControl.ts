import type {
  CaptionQualityControlReasonCode,
  CaptionQualityControlReceipt,
  CaptionQualityControlRequest,
} from "../model.ts";
import {
  array,
  contentId,
  exact,
  fail,
  literal,
  object,
  oneOf,
  string,
} from "./primitives.ts";
import {
  validateCaptionStudyIdentity,
  validateCaptionExecutorDescriptor,
  validateCaptionProductionInput,
} from "./captionProduction.ts";
import { validatePublishReviewDecisionReceiptIdentity } from "./publishReviewDecision.ts";
import { validateStudyReadinessReceiptIdentity } from "./publishReview.ts";

const OUTCOMES = new Set(["accepted", "withheld"]);
const REASONS = new Set<CaptionQualityControlReasonCode>([
  "current_run_candidate_structurally_complete",
  "recorded_fixture_test_demo_only",
  "candidate_has_unavailable_or_withheld_lines",
  "candidate_has_no_lines",
]);

function identity(value: unknown, context: string, path: string): string {
  const result = string(value, context, path);
  if (result.length > 200 || result.trim() !== result || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) {
    fail(context, path, "must be a bounded path-free identity");
  }
  return result;
}

function candidate(
  value: unknown,
  context: string,
  path: string,
): CaptionQualityControlRequest["candidate"] {
  const item = object(value, context, path);
  exact(item, ["jobId", "captionArtifactId", "captionContentId", "captionReceiptId", "captionReceiptContentId"], context, path);
  return {
    jobId: identity(item.jobId, context, `${path}.jobId`),
    captionArtifactId: identity(item.captionArtifactId, context, `${path}.captionArtifactId`),
    captionContentId: contentId(item.captionContentId, context, `${path}.captionContentId`),
    captionReceiptId: identity(item.captionReceiptId, context, `${path}.captionReceiptId`),
    captionReceiptContentId: contentId(item.captionReceiptContentId, context, `${path}.captionReceiptContentId`),
  };
}

export function assertCaptionQualityControlRequest(value: unknown): CaptionQualityControlRequest {
  const context = "Caption quality-control request";
  const item = object(value, context, "request");
  exact(item, ["candidate"], context, "request");
  return { candidate: candidate(item.candidate, context, "request.candidate") };
}

export function validateCaptionQualityControlReceipt(
  value: unknown,
  context = "Caption quality-control receipt",
  path = "receipt",
): CaptionQualityControlReceipt {
  const item = object(value, context, path);
  exact(item, ["schema", "receiptId", "qcId", "input", "lineage", "producer", "decision"], context, path);
  literal(item.schema, "studio.caption-quality-control.receipt.v1", context, `${path}.schema`);
  const lineage = object(item.lineage, context, `${path}.lineage`);
  exact(lineage, ["candidateInput", "executor", "study", "readiness", "approval"], context, `${path}.lineage`);
  const executor = validateCaptionExecutorDescriptor(lineage.executor, context, `${path}.lineage.executor`);
  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version", "independence", "policy"], context, `${path}.producer`);
  literal(producer.id, "studio.host-caption-quality-control", context, `${path}.producer.id`);
  literal(producer.version, "1", context, `${path}.producer.version`);
  literal(producer.independence, "separate_from_caption_executor", context, `${path}.producer.independence`);
  literal(producer.policy, "structural_current_run_gate_without_semantic_quality_score", context, `${path}.producer.policy`);
  const decision = object(item.decision, context, `${path}.decision`);
  exact(decision, ["outcome", "reasonCodes", "lines"], context, `${path}.decision`);
  const outcome = oneOf<"accepted" | "withheld">(decision.outcome, OUTCOMES, context, `${path}.decision.outcome`);
  const reasonCodes = array(decision.reasonCodes, context, `${path}.decision.reasonCodes`).map((reason, index) =>
    oneOf<CaptionQualityControlReasonCode>(reason, REASONS, context, `${path}.decision.reasonCodes[${index}]`));
  if (reasonCodes.length !== 1) fail(context, `${path}.decision.reasonCodes`, "must contain one closed policy reason");
  const lines = array(decision.lines, context, `${path}.decision.lines`).map((lineValue, index) => {
    const linePath = `${path}.decision.lines[${index}]`;
    const line = object(lineValue, context, linePath);
    exact(line, ["lineId", "outcome", "reasonCode"], context, linePath);
    const lineOutcome = oneOf<"accepted" | "withheld">(line.outcome, OUTCOMES, context, `${linePath}.outcome`);
    const reasonCode = oneOf<CaptionQualityControlReasonCode>(line.reasonCode, REASONS, context, `${linePath}.reasonCode`);
    if (
      (lineOutcome === "accepted" && reasonCode !== "current_run_candidate_structurally_complete") ||
      (lineOutcome === "withheld" && reasonCode === "current_run_candidate_structurally_complete") ||
      reasonCode === "candidate_has_no_lines"
    ) fail(context, linePath, "outcome and closed line reason do not agree");
    return { lineId: identity(line.lineId, context, `${linePath}.lineId`), outcome: lineOutcome, reasonCode };
  });
  if (new Set(lines.map((line) => line.lineId)).size !== lines.length) {
    fail(context, `${path}.decision.lines`, "must not repeat line identities");
  }
  if (
    (outcome === "accepted" &&
      (reasonCodes[0] !== "current_run_candidate_structurally_complete" || lines.length === 0 || lines.some((line) => line.outcome !== "accepted"))) ||
    (outcome === "withheld" && reasonCodes[0] === "current_run_candidate_structurally_complete") ||
    (reasonCodes[0] === "candidate_has_no_lines" && lines.length !== 0) ||
    (executor.executionScope === "test_demo_only" &&
      (outcome !== "withheld" || reasonCodes[0] !== "recorded_fixture_test_demo_only" || lines.some((line) => line.reasonCode !== "recorded_fixture_test_demo_only"))) ||
    (executor.executionScope === "current_run" && (
      reasonCodes[0] === "recorded_fixture_test_demo_only" ||
      (lines.length === 0 && reasonCodes[0] !== "candidate_has_no_lines") ||
      (lines.length > 0 && lines.every((line) => line.outcome === "accepted") && reasonCodes[0] !== "current_run_candidate_structurally_complete") ||
      (lines.some((line) => line.outcome === "withheld") && reasonCodes[0] !== "candidate_has_unavailable_or_withheld_lines")
    ))
  ) fail(context, `${path}.decision`, "does not satisfy the closed independent QC policy");
  return {
    schema: "studio.caption-quality-control.receipt.v1",
    receiptId: identity(item.receiptId, context, `${path}.receiptId`),
    qcId: identity(item.qcId, context, `${path}.qcId`),
    input: candidate(item.input, context, `${path}.input`),
    lineage: {
      candidateInput: validateCaptionProductionInput(lineage.candidateInput, context, `${path}.lineage.candidateInput`),
      executor,
      study: validateCaptionStudyIdentity(lineage.study, context, `${path}.lineage.study`),
      readiness: validateStudyReadinessReceiptIdentity(lineage.readiness, context, `${path}.lineage.readiness`),
      approval: validatePublishReviewDecisionReceiptIdentity(lineage.approval, context, `${path}.lineage.approval`),
    },
    producer: {
      id: "studio.host-caption-quality-control",
      version: "1",
      independence: "separate_from_caption_executor",
      policy: "structural_current_run_gate_without_semantic_quality_score",
    },
    decision: { outcome, reasonCodes, lines },
  };
}
