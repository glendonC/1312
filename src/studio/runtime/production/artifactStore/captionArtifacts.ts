import { assertRuntimeArtifact } from "../assertions.ts";
import type {
  CaptionProductionArtifact,
  CaptionProductionReceipt,
  CaptionQualityControlReceipt,
  ContentIdentity,
  RuntimeArtifact,
} from "../model.ts";
import { canonicalSha256, createCaptionArtifactId } from "./contentIdentity.ts";

export function buildCaptionProductionArtifacts(input: {
    runId: string;
    caption: CaptionProductionArtifact;
    receipt: CaptionProductionReceipt;
    storedCaption: { content: ContentIdentity; storageKey: string };
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): { captionArtifact: RuntimeArtifact; receiptArtifact: RuntimeArtifact } {
    const approval = input.receipt.authority.approval;
    const captionArtifactId = createCaptionArtifactId(
      input.runId,
      input.caption.jobId,
      input.storedCaption.content.contentId,
    );
    if (
      input.caption.jobId !== input.receipt.jobId ||
      input.receipt.result.captionArtifactId !== captionArtifactId ||
      input.receipt.result.captionContentId !== input.storedCaption.content.contentId ||
      input.receipt.result.captionBytes !== input.storedCaption.content.bytes
    ) throw new Error("Caption receipt does not bind the exact stored caption artifact");
    const captionArtifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: captionArtifactId,
      runId: input.runId,
      kind: "caption-production-output",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedCaption.content,
      storageKey: input.storedCaption.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [
        input.caption.input.sourceArtifactId,
        input.caption.input.study.artifactId,
        input.caption.input.readiness.artifactId,
        approval.artifactId,
      ],
      producerTaskId: null,
      producerAgentId: null,
      origin: {
        kind: "caption_production_output",
        jobId: input.caption.jobId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
        approvalReviewId: approval.reviewId,
        approvalArtifactId: approval.artifactId,
        sourceArtifactId: input.caption.input.sourceArtifactId,
        studyId: input.caption.input.study.studyId,
        studyArtifactId: input.caption.input.study.artifactId,
        readinessId: input.caption.input.readiness.readinessId,
        readinessArtifactId: input.caption.input.readiness.artifactId,
      },
    };
    const receiptArtifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId: input.runId,
        jobId: input.receipt.jobId,
        kind: "caption-production-receipt",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: "caption-production-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [
        captionArtifact.id,
        input.caption.input.study.artifactId,
        input.caption.input.readiness.artifactId,
        approval.artifactId,
      ],
      producerTaskId: null,
      producerAgentId: null,
      origin: {
        kind: "caption_production_receipt",
        jobId: input.receipt.jobId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
        approvalReviewId: approval.reviewId,
        approvalArtifactId: approval.artifactId,
        captionArtifactId: captionArtifact.id,
        captionContentId: captionArtifact.content.contentId,
        studyId: input.caption.input.study.studyId,
        studyArtifactId: input.caption.input.study.artifactId,
        readinessId: input.caption.input.readiness.readinessId,
        readinessArtifactId: input.caption.input.readiness.artifactId,
      },
    };
    assertRuntimeArtifact(captionArtifact);
    assertRuntimeArtifact(receiptArtifact);
    return { captionArtifact, receiptArtifact };
  }

export function buildCaptionQualityControlArtifact(input: {
    runId: string;
    receipt: CaptionQualityControlReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId: input.runId,
        qcId: input.receipt.qcId,
        kind: "caption-quality-control-receipt",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: input.receipt.decision.outcome === "accepted"
        ? "caption-quality-control-accepted-receipt"
        : "caption-quality-control-withheld-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [
        input.receipt.input.captionArtifactId,
        input.receipt.lineage.study.artifactId,
        input.receipt.lineage.readiness.artifactId,
        input.receipt.lineage.approval.artifactId,
      ],
      producerTaskId: null,
      producerAgentId: null,
      origin: {
        kind: "caption_quality_control",
        qcId: input.receipt.qcId,
        jobId: input.receipt.input.jobId,
        captionArtifactId: input.receipt.input.captionArtifactId,
        captionContentId: input.receipt.input.captionContentId,
        studyId: input.receipt.lineage.study.studyId,
        readinessId: input.receipt.lineage.readiness.readinessId,
        approvalReviewId: input.receipt.lineage.approval.reviewId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
        outcome: input.receipt.decision.outcome,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }
