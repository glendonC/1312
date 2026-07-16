import type { RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { invariant } from "./shared.ts";

export function applyCaptionEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "caption.production_started") {
    invariant(event.producer.kind === "caption_production_host", event, "caption production must come from the caption host");
    const request = event.data.request;
    const approval = next.publishReviewDecisions[request.approval.reviewId];
    invariant(
      approval?.status === "completed" &&
        approval.outcome === "approve_for_caption_production" &&
        approval.artifactId === request.approval.artifactId &&
        approval.receiptId === request.approval.receiptId &&
        approval.receiptContentId === request.approval.receiptContentId,
      event,
      `caption production ${event.data.jobId} has no exact completed approval`,
    );
    invariant(
      !Object.values(next.publishReviewRevocations).some((revocation) =>
        revocation.reviewId === approval.id && revocation.status !== "failed"),
      event,
      `caption production ${event.data.jobId} cannot start from a revoked or revoking approval`,
    );
    invariant(!next.captionProductions[event.data.jobId], event, `caption production ${event.data.jobId} is duplicated`);
    invariant(
      !Object.values(next.captionProductions).some((job) => job.approvalReviewId === approval.id),
      event,
      `approval ${approval.id} already has caption-production lineage`,
    );
    const source = next.artifacts[event.data.input.sourceArtifactId];
    const childOutput = next.artifacts[event.data.input.acceptedChildOutput.artifactId];
    const promotion = next.rootOutputDispositions[event.data.input.rootPromotion.dispositionId];
    const promotionArtifact = next.artifacts[event.data.input.rootPromotion.artifactId];
    invariant(
      source?.origin.kind === "ingest" && source.content.contentId === event.data.input.sourceContentId,
      event,
      `caption production ${event.data.jobId} has no exact runtime source artifact`,
    );
    invariant(
      childOutput?.origin.kind === "worker_output" &&
        childOutput.content.contentId === event.data.input.acceptedChildOutput.contentId &&
        promotion?.outcome === "promoted_to_root" &&
        promotion.inputArtifactId === childOutput.id &&
        promotion.outputArtifactId === promotionArtifact?.id &&
        promotion.receiptId === event.data.input.rootPromotion.receiptId &&
        promotion.receiptContentId === event.data.input.rootPromotion.receiptContentId &&
        promotionArtifact?.origin.kind === "root_output_disposition" &&
        promotionArtifact.content.contentId === event.data.input.rootPromotion.contentId,
      event,
      `caption production ${event.data.jobId} has no exact accepted current-run child promotion`,
    );
    next.captionProductions[event.data.jobId] = {
      id: event.data.jobId,
      approvalReviewId: approval.id,
      approvalArtifactId: request.approval.artifactId,
      approvalReceiptId: request.approval.receiptId,
      approvalReceiptContentId: request.approval.receiptContentId,
      sourceArtifactId: source.id,
      sourceContentId: source.content.contentId,
      analysisRequestId: event.data.input.analysisRequestId,
      range: structuredClone(event.data.input.range),
      acceptedChildOutput: structuredClone(event.data.input.acceptedChildOutput),
      rootPromotion: structuredClone(event.data.input.rootPromotion),
      limits: structuredClone(event.data.limits),
      executor: structuredClone(event.data.executor),
      status: "started",
      captionArtifactId: null,
      captionContentId: null,
      receiptArtifactId: null,
      receiptId: null,
      receiptContentId: null,
      resultStatus: null,
      lineCount: null,
      sourceAvailableCount: null,
      targetAvailableCount: null,
      withheldCount: null,
      unavailableCount: null,
      failure: null,
    };
    return true;
  }

  if (event.type === "caption.production_completed") {
    invariant(event.producer.kind === "caption_production_host", event, "caption completion must come from the caption host");
    const job = next.captionProductions[event.data.jobId];
    invariant(job?.status === "started", event, `caption production ${event.data.jobId} is not active`);
    const captionArtifact = next.artifacts[event.data.captionArtifactId];
    const receiptArtifact = next.artifacts[event.data.receiptArtifactId];
    const receipt = event.data.receipt;
    invariant(
      captionArtifact?.origin.kind === "caption_production_output" &&
        captionArtifact.origin.jobId === job.id &&
        captionArtifact.content.contentId === event.data.captionContentId &&
        receiptArtifact?.origin.kind === "caption_production_receipt" &&
        receiptArtifact.origin.jobId === job.id &&
        receiptArtifact.origin.captionArtifactId === captionArtifact.id &&
        receiptArtifact.content.contentId === event.data.receiptContentId,
      event,
      `caption production ${job.id} has no exact output and receipt artifacts`,
    );
    invariant(
      receipt.jobId === job.id &&
        receipt.authority.approval.reviewId === job.approvalReviewId &&
        receipt.authority.approval.artifactId === job.approvalArtifactId &&
        receipt.authority.approval.receiptId === job.approvalReceiptId &&
        receipt.authority.approval.receiptContentId === job.approvalReceiptContentId &&
        receipt.input.sourceArtifactId === job.sourceArtifactId &&
        receipt.input.sourceContentId === job.sourceContentId &&
        receipt.input.analysisRequestId === job.analysisRequestId &&
        JSON.stringify(receipt.input.range) === JSON.stringify(job.range) &&
        JSON.stringify(receipt.input.acceptedChildOutput) === JSON.stringify(job.acceptedChildOutput) &&
        JSON.stringify(receipt.input.rootPromotion) === JSON.stringify(job.rootPromotion) &&
        JSON.stringify(receipt.limits) === JSON.stringify(job.limits) &&
        JSON.stringify(receipt.producer.executor) === JSON.stringify(job.executor) &&
        receipt.result.captionArtifactId === captionArtifact.id &&
        receipt.result.captionContentId === captionArtifact.content.contentId,
      event,
      `caption production ${job.id} receipt changed its authority, input, or executor`,
    );
    job.status = "completed";
    job.captionArtifactId = captionArtifact.id;
    job.captionContentId = captionArtifact.content.contentId;
    job.receiptArtifactId = receiptArtifact.id;
    job.receiptId = receipt.receiptId;
    job.receiptContentId = receiptArtifact.content.contentId;
    job.resultStatus = receipt.result.status;
    job.lineCount = receipt.result.lineCount;
    job.sourceAvailableCount = receipt.result.sourceAvailableCount;
    job.targetAvailableCount = receipt.result.targetAvailableCount;
    job.withheldCount = receipt.result.withheldCount;
    job.unavailableCount = receipt.result.unavailableCount;
    return true;
  }

  if (event.type === "caption.production_failed") {
    invariant(event.producer.kind === "caption_production_host", event, "caption failure must come from the caption host");
    const job = next.captionProductions[event.data.jobId];
    invariant(job?.status === "started", event, `caption production ${event.data.jobId} is not active`);
    job.status = "failed";
    job.failure = event.data.reason;
    return true;
  }

  if (event.type === "caption.quality_control_decided") {
    invariant(event.producer.kind === "caption_quality_control_host", event, "caption QC decisions must come from the independent QC host");
    const receipt = event.data.receipt;
    const job = next.captionProductions[receipt.input.jobId];
    const artifact = next.artifacts[event.data.outputArtifactId];
    invariant(job?.status === "completed", event, `caption QC ${event.data.qcId} has no completed candidate`);
    invariant(
      !next.captionQualityControls[event.data.qcId] &&
        !Object.values(next.captionQualityControls).some((qc) => qc.jobId === receipt.input.jobId),
      event,
      `caption QC ${event.data.qcId} is duplicated`,
    );
    invariant(
      receipt.qcId === event.data.qcId &&
        receipt.input.captionArtifactId === job.captionArtifactId &&
        receipt.input.captionContentId === job.captionContentId &&
        receipt.input.captionReceiptId === job.receiptId &&
        receipt.input.captionReceiptContentId === job.receiptContentId &&
        JSON.stringify(receipt.lineage.candidateInput.acceptedChildOutput) === JSON.stringify(job.acceptedChildOutput) &&
        JSON.stringify(receipt.lineage.candidateInput.rootPromotion) === JSON.stringify(job.rootPromotion) &&
        JSON.stringify(receipt.lineage.executor) === JSON.stringify(job.executor),
      event,
      `caption QC ${event.data.qcId} changed its candidate or current-run lineage`,
    );
    invariant(
      artifact?.origin.kind === "caption_quality_control" &&
        artifact.origin.qcId === receipt.qcId &&
        artifact.origin.jobId === receipt.input.jobId &&
        artifact.origin.captionArtifactId === receipt.input.captionArtifactId &&
        artifact.origin.captionContentId === receipt.input.captionContentId &&
        artifact.origin.receiptId === receipt.receiptId &&
        artifact.origin.receiptContentId === event.data.receiptContentId &&
        artifact.origin.outcome === receipt.decision.outcome &&
        artifact.content.contentId === event.data.receiptContentId,
      event,
      `caption QC ${event.data.qcId} has no exact receipt artifact`,
    );
    next.captionQualityControls[receipt.qcId] = {
      id: receipt.qcId,
      jobId: receipt.input.jobId,
      captionArtifactId: receipt.input.captionArtifactId,
      captionContentId: receipt.input.captionContentId,
      captionReceiptId: receipt.input.captionReceiptId,
      captionReceiptContentId: receipt.input.captionReceiptContentId,
      outputArtifactId: artifact.id,
      receiptId: receipt.receiptId,
      receiptContentId: artifact.content.contentId,
      outcome: receipt.decision.outcome,
      reasonCodes: [...receipt.decision.reasonCodes],
    };
    return true;
  }

  return false;
}
