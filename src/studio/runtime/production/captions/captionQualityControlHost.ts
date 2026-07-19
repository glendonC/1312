import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "../artifactStore.ts";
import { reopenCaptionProductionResults } from "./captionProductionAudit.ts";
import { materializeCaptionProductionLines } from "./captionArtifactCompaction.ts";
import type { RuntimeLedger } from "../journal.ts";
import type {
  CaptionQualityControlReasonCode,
  CaptionQualityControlReceipt,
  CaptionQualityControlRequest,
} from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import {
  assertCaptionQualityControlRequest,
  validateCaptionQualityControlReceipt,
} from "../validation/captionQualityControl.ts";

export type CaptionQualityControlHostErrorCode =
  | "verified_caption_candidate_required"
  | "duplicate_quality_control"
  | "stored_lineage_invalid";

export class CaptionQualityControlHostError extends Error {
  readonly code: CaptionQualityControlHostErrorCode;

  constructor(code: CaptionQualityControlHostErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CaptionQualityControlHostError";
    this.code = code;
  }
}

export interface CaptionQualityControlHostResult {
  receipt: CaptionQualityControlReceipt;
  receiptContentId: string;
  outputArtifactId: string;
}

/** Independent structural QC gate. It emits no score and makes no semantic quality claim. */
export class CaptionQualityControlHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;

  constructor(ledger: RuntimeLedger, artifacts: ContentAddressedArtifactStore) {
    this.ledger = ledger;
    this.artifacts = artifacts;
  }

  async decide(requestValue: unknown): Promise<CaptionQualityControlHostResult> {
    const request: CaptionQualityControlRequest = assertCaptionQualityControlRequest(requestValue);
    let candidates;
    try {
      candidates = await reopenCaptionProductionResults(
        this.ledger.state(),
        await this.ledger.events(),
        this.artifacts,
      );
    } catch (error) {
      throw new CaptionQualityControlHostError(
        "stored_lineage_invalid",
        "Caption QC could not recursively verify the stored candidate and its current-run lineage",
        { cause: error },
      );
    }
    const candidate = candidates.find((item) =>
      item.verification.jobId === request.candidate.jobId &&
      item.verification.captionArtifactId === request.candidate.captionArtifactId &&
      item.verification.captionContentId === request.candidate.captionContentId &&
      item.verification.receiptId === request.candidate.captionReceiptId &&
      item.verification.receiptContentId === request.candidate.captionReceiptContentId
    );
    if (!candidate) {
      throw new CaptionQualityControlHostError(
        "verified_caption_candidate_required",
        "Caption QC requires one exact recursively verified caption candidate identity",
      );
    }
    if (Object.values(this.ledger.state().captionQualityControls).some((qc) => qc.jobId === candidate.artifact.jobId)) {
      throw new CaptionQualityControlHostError(
        "duplicate_quality_control",
        "The caption candidate already has one immutable independent QC decision",
      );
    }

    const testDemoOnly = candidate.artifact.executor.executionScope === "test_demo_only";
    const candidateLines = materializeCaptionProductionLines(candidate.artifact);
    const lines = candidateLines.map((line) => {
      const complete = !testDemoOnly &&
        line.lineage.study.coverage.state === "supported" &&
        line.lineage.study.coverage.reasonCode === null &&
        line.lineage.study.claimIds.length > 0 &&
        line.lineage.study.semanticCitations.length > 0 &&
        line.lineage.study.childReports.length > 0 &&
        line.source.state === "available" && line.target.state === "available";
      const reasonCode: CaptionQualityControlReasonCode = testDemoOnly
        ? "recorded_fixture_test_demo_only"
        : complete
          ? "current_run_candidate_structurally_complete"
          : "candidate_has_unavailable_or_withheld_lines";
      return { lineId: line.id, outcome: complete ? "accepted" as const : "withheld" as const, reasonCode };
    });
    const reasonCode: CaptionQualityControlReasonCode = testDemoOnly
      ? "recorded_fixture_test_demo_only"
      : candidateLines.length === 0
        ? "candidate_has_no_lines"
        : lines.every((line) => line.outcome === "accepted")
          ? "current_run_candidate_structurally_complete"
          : "candidate_has_unavailable_or_withheld_lines";
    const outcome = reasonCode === "current_run_candidate_structurally_complete"
      ? "accepted" as const
      : "withheld" as const;
    const qcId = `caption-quality-control:${canonicalSha256({
      runId: this.ledger.runId,
      candidate: request.candidate,
    })}`;
    const body = {
      qcId,
      input: structuredClone(request.candidate),
      lineage: {
        candidateInput: structuredClone(candidate.artifact.input),
        executor: structuredClone(candidate.artifact.executor),
        study: structuredClone(candidate.artifact.input.study),
        readiness: structuredClone(candidate.artifact.input.readiness),
        approval: structuredClone(candidateLines[0]?.lineage.approval ?? candidate.verification.approval),
      },
      producer: {
        id: "studio.host-caption-quality-control" as const,
        version: "1" as const,
        independence: "separate_from_caption_executor" as const,
        policy: "structural_current_run_gate_without_semantic_quality_score" as const,
      },
      decision: {
        outcome,
        reasonCodes: [reasonCode],
        lines,
      },
    };
    const receipt: CaptionQualityControlReceipt = {
      schema: "studio.caption-quality-control.receipt.v1",
      receiptId: `caption-quality-control-receipt:${canonicalSha256(body)}`,
      ...body,
    };
    validateCaptionQualityControlReceipt(receipt);
    const stored = await this.artifacts.storeJson(receipt);
    if (stored.content.contentId !== canonicalJsonContentId(receipt)) {
      throw new Error("Stored caption QC changed its canonical content identity");
    }
    const artifact = this.artifacts.buildCaptionQualityControlArtifact({
      runId: this.ledger.runId,
      receipt,
      storedReceipt: stored,
    });
    await this.artifacts.record(this.ledger, artifact, qcId);
    await this.ledger.transact(
      { producer: { kind: "caption_quality_control_host", id: "host-caption-quality-control" }, causationId: qcId },
      ({ state }) => {
        if (Object.values(state.captionQualityControls).some((qc) => qc.jobId === candidate.artifact.jobId)) {
          throw new CaptionQualityControlHostError(
            "duplicate_quality_control",
            "The caption candidate already has one immutable independent QC decision",
          );
        }
        return {
          pending: [{
            type: "caption.quality_control_decided",
            data: {
              qcId,
              outputArtifactId: artifact.id,
              receiptContentId: stored.content.contentId,
              receipt,
            },
          }] satisfies PendingRuntimeEvent[],
          result: undefined,
        };
      },
    );
    return { receipt, receiptContentId: stored.content.contentId, outputArtifactId: artifact.id };
  }
}
