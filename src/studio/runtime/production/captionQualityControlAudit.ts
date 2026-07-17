import { createHash } from "node:crypto";

import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "./artifactStore.ts";
import { reopenCaptionProductionResults } from "./captionProductionAudit.ts";
import type { CaptionProductionVerification } from "./captionProductionAudit.ts";
import type {
  CaptionQualityControlOutcome,
  CaptionQualityControlReasonCode,
  RuntimeProjection,
} from "./model.ts";
import type { RuntimeEvent } from "./protocol.ts";
import { validateCaptionQualityControlReceipt } from "./validation/captionQualityControl.ts";

export interface CaptionQualityControlVerification {
  qcId: string;
  jobId: string;
  captionArtifactId: string;
  captionContentId: string;
  outputArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  integrity: "stored_independent_qc_with_verified_current_run_candidate";
  policy: "structural_current_run_gate_without_semantic_quality_score";
  outcome: CaptionQualityControlOutcome;
  reasonCodes: CaptionQualityControlReasonCode[];
  acceptedLineIds: string[];
  withheldLineIds: string[];
  candidate: CaptionProductionVerification;
}

function expectedStorageKey(contentId: string): string {
  const digest = contentId.replace(/^sha256:/, "");
  return `objects/sha256/${digest.slice(0, 2)}/${digest}`;
}

/** Reopens the QC receipt and repeats candidate, promotion, executor-scope, and line-state checks. */
export async function reopenCaptionQualityControls(
  state: RuntimeProjection,
  events: readonly RuntimeEvent[],
  artifacts: ContentAddressedArtifactStore,
): Promise<CaptionQualityControlVerification[]> {
  const candidates = await reopenCaptionProductionResults(state, events, artifacts);
  const verified: CaptionQualityControlVerification[] = [];
  for (const record of Object.values(state.captionQualityControls).sort((left, right) => left.id.localeCompare(right.id))) {
    const candidate = candidates.find((item) =>
      item.verification.jobId === record.jobId &&
      item.verification.captionArtifactId === record.captionArtifactId &&
      item.verification.captionContentId === record.captionContentId &&
      item.verification.receiptId === record.captionReceiptId &&
      item.verification.receiptContentId === record.captionReceiptContentId
    );
    const artifact = state.artifacts[record.outputArtifactId];
    const event = events.find((candidateEvent) =>
      candidateEvent.type === "caption.quality_control_decided" && candidateEvent.data.qcId === record.id);
    if (
      !candidate || !artifact || artifact.origin.kind !== "caption_quality_control" ||
      !event || event.type !== "caption.quality_control_decided"
    ) throw new Error(`Caption QC ${record.id} lost its verified candidate or journal lineage`);
    await artifacts.resolveVerified(artifact);
    const bytes = await artifacts.receiptBytes(record.receiptContentId);
    if (bytes.byteLength <= 0 || bytes.byteLength > 128 * 1024) {
      throw new Error(`Caption QC ${record.id} exceeds its bounded receipt contract`);
    }
    const measured = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (measured !== record.receiptContentId) throw new Error(`Caption QC ${record.id} changed content identity`);
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      throw new Error(`Caption QC ${record.id} is invalid JSON`);
    }
    if (canonicalJsonContentId(value) !== record.receiptContentId) {
      throw new Error(`Caption QC ${record.id} is not canonical JSON`);
    }
    const receipt = validateCaptionQualityControlReceipt(value);
    const body = structuredClone(receipt) as unknown as Record<string, unknown>;
    delete body.schema;
    delete body.receiptId;
    const expectedReceiptId = `caption-quality-control-receipt:${canonicalSha256(body)}`;
    const expectedArtifactId = `artifact:${canonicalSha256({
      runId: state.runId,
      qcId: record.id,
      kind: "caption-quality-control-receipt",
      contentId: record.receiptContentId,
    })}`;
    const lineById = new Map(candidate.artifact.lines.map((line) => [line.id, line]));
    const expectedTestDemo = candidate.artifact.executor.executionScope === "test_demo_only";
    const invalidLine = receipt.decision.lines.some((line) => {
      const source = lineById.get(line.lineId);
      if (!source) return true;
      const complete = !expectedTestDemo &&
        source.lineage.study.coverage.state === "supported" &&
        source.lineage.study.coverage.reasonCode === null &&
        source.lineage.study.claimIds.length > 0 &&
        source.lineage.study.semanticCitations.length > 0 &&
        source.lineage.study.childReports.length > 0 &&
        source.source.state === "available" && source.target.state === "available";
      return complete
        ? line.outcome !== "accepted" || line.reasonCode !== "current_run_candidate_structurally_complete"
        : line.outcome !== "withheld" || line.reasonCode !== (
            expectedTestDemo ? "recorded_fixture_test_demo_only" : "candidate_has_unavailable_or_withheld_lines"
          );
    });
    if (
      receipt.receiptId !== expectedReceiptId || receipt.receiptId !== record.receiptId ||
      receipt.qcId !== record.id ||
      canonicalSha256(receipt.input) !== canonicalSha256({
        jobId: record.jobId,
        captionArtifactId: record.captionArtifactId,
        captionContentId: record.captionContentId,
        captionReceiptId: record.captionReceiptId,
        captionReceiptContentId: record.captionReceiptContentId,
      }) ||
      canonicalSha256(receipt.lineage.candidateInput) !== canonicalSha256(candidate.artifact.input) ||
      canonicalSha256(receipt.lineage.executor) !== canonicalSha256(candidate.artifact.executor) ||
      canonicalSha256(receipt.lineage.study) !== canonicalSha256(candidate.verification.study) ||
      canonicalSha256(receipt.lineage.readiness) !== canonicalSha256(candidate.verification.readiness) ||
      canonicalSha256(receipt.lineage.approval) !== canonicalSha256(candidate.verification.approval) ||
      receipt.decision.lines.length !== candidate.artifact.lines.length || invalidLine ||
      artifact.id !== expectedArtifactId || artifact.id !== event.data.outputArtifactId ||
      artifact.runId !== state.runId || artifact.mediaClass !== "non_media" || artifact.publication !== "private" ||
      artifact.content.contentId !== record.receiptContentId ||
      artifact.storageKey !== expectedStorageKey(record.receiptContentId) ||
      artifact.origin.qcId !== record.id || artifact.origin.jobId !== record.jobId ||
      artifact.origin.studyId !== candidate.verification.study.studyId ||
      artifact.origin.readinessId !== candidate.verification.readiness.readinessId ||
      artifact.origin.approvalReviewId !== candidate.verification.approval.reviewId ||
      canonicalSha256(artifact.sourceArtifactIds) !== canonicalSha256([
        candidate.verification.captionArtifactId,
        candidate.verification.study.artifactId,
        candidate.verification.readiness.artifactId,
        candidate.verification.approval.artifactId,
      ]) ||
      artifact.origin.receiptId !== receipt.receiptId ||
      artifact.origin.outcome !== receipt.decision.outcome ||
      canonicalSha256(receipt) !== canonicalSha256(event.data.receipt) ||
      receipt.decision.outcome !== record.outcome ||
      canonicalSha256(receipt.decision.reasonCodes) !== canonicalSha256(record.reasonCodes)
    ) throw new Error(`Caption QC ${record.id} changed its independent decision or current-run lineage`);
    verified.push({
      qcId: record.id,
      jobId: record.jobId,
      captionArtifactId: record.captionArtifactId,
      captionContentId: record.captionContentId,
      outputArtifactId: artifact.id,
      receiptId: record.receiptId,
      receiptContentId: record.receiptContentId,
      integrity: "stored_independent_qc_with_verified_current_run_candidate",
      policy: "structural_current_run_gate_without_semantic_quality_score",
      outcome: record.outcome,
      reasonCodes: [...record.reasonCodes],
      acceptedLineIds: receipt.decision.lines.filter((line) => line.outcome === "accepted").map((line) => line.lineId),
      withheldLineIds: receipt.decision.lines.filter((line) => line.outcome === "withheld").map((line) => line.lineId),
      candidate: structuredClone(candidate.verification),
    });
  }
  return verified;
}
