import type { RuntimeProjection } from "../model.ts";
import { SPAN_TRANSLATION_INTERRUPTED_REASON, SPAN_TRANSLATION_LIMITS } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { canonicalSha256 } from "../canonicalIdentity.ts";
import {
  createSpanTranslationGrantId,
  createSpanTranslationJobId,
  createSpanTranslationRequestFingerprint,
} from "../spanTranslations/identity.ts";
import { invariant } from "./shared.ts";

export function applySpanTranslationEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "translation.span_started") {
    invariant(
      event.producer.kind === "span_translation_host",
      event,
      "span translations must come from the bounded translation host",
    );
    const { jobId, request, grant, input } = event.data;
    const matchingAttempts = Object.values(next.spanTranslations)
      .filter((record) => record.requestFingerprint === grant.requestFingerprint);
    const expectedFingerprint = createSpanTranslationRequestFingerprint({
      runId: next.runId,
      request,
      authority: input,
      executor: grant.executor,
      rightsScope: grant.rightsScope,
    });
    const expectedGrantId = createSpanTranslationGrantId({
      runId: next.runId,
      requestFingerprint: expectedFingerprint,
      caption: request.caption,
      attempt: grant.attempt,
    });
    const caption = next.captionProductions[request.caption.jobId];
    invariant(
      caption?.status === "completed" &&
        caption.captionArtifactId === request.caption.artifactId &&
        caption.captionContentId === request.caption.contentId &&
        caption.receiptArtifactId === request.caption.receiptArtifactId &&
        caption.receiptId === request.caption.receiptId &&
        caption.receiptContentId === request.caption.receiptContentId,
      event,
      `span translation ${jobId} has no exact completed caption result`,
    );
    invariant(
      !Object.values(next.publishReviewRevocations).some((revocation) =>
        revocation.reviewId === caption.approvalReviewId && revocation.status !== "failed"),
      event,
      `span translation ${jobId} cannot start from revoked caption authority`,
    );
    invariant(
      !next.spanTranslations[jobId] &&
        matchingAttempts.length === grant.attempt &&
        matchingAttempts.every((record) => record.status === "failed"),
      event,
      `span translation ${jobId} is duplicated`,
    );
    invariant(
      grant.requestFingerprint === expectedFingerprint &&
        grant.attempt < SPAN_TRANSLATION_LIMITS.maxAttemptsPerRequest &&
        grant.grantId === expectedGrantId &&
        jobId === createSpanTranslationJobId(grant.grantId) &&
        grant.runId === next.runId &&
        canonicalSha256(grant.caption) === canonicalSha256(request.caption) &&
        grant.lineId === request.lineId &&
        canonicalSha256(grant.selection) === canonicalSha256(request.selection) &&
        canonicalSha256(input.caption) === canonicalSha256(request.caption) &&
        input.line.lineId === request.lineId &&
        canonicalSha256(input.selection) === canonicalSha256(request.selection),
      event,
      `span translation ${jobId} changed its request, grant, or input authority`,
    );
    next.spanTranslations[jobId] = {
      jobId,
      attempt: grant.attempt,
      requestFingerprint: grant.requestFingerprint,
      caption: structuredClone(request.caption),
      lineId: request.lineId,
      selection: structuredClone(request.selection),
      grantId: grant.grantId,
      executor: structuredClone(grant.executor),
      limits: structuredClone(grant.limits),
      status: "started",
      artifactId: null,
      contentId: null,
      receiptArtifactId: null,
      receiptId: null,
      receiptContentId: null,
      result: null,
      failure: null,
    };
    return true;
  }

  if (event.type === "translation.span_completed") {
    invariant(
      event.producer.kind === "span_translation_host",
      event,
      "span translation completion must come from the bounded translation host",
    );
    const record = next.spanTranslations[event.data.jobId];
    const artifact = next.artifacts[event.data.artifactId];
    const receiptArtifact = next.artifacts[event.data.receiptArtifactId];
    const receipt = event.data.receipt;
    invariant(record?.status === "started", event, `span translation ${event.data.jobId} is not active`);
    invariant(
      artifact?.origin.kind === "span_translation_output" &&
        artifact.origin.jobId === record.jobId &&
        artifact.content.contentId === event.data.contentId &&
        receiptArtifact?.origin.kind === "span_translation_receipt" &&
        receiptArtifact.origin.jobId === record.jobId &&
        receiptArtifact.origin.translationArtifactId === artifact.id &&
        receiptArtifact.content.contentId === event.data.receiptContentId &&
        receipt.jobId === record.jobId &&
        receipt.grant.grantId === record.grantId &&
        receipt.grant.requestFingerprint === record.requestFingerprint &&
        canonicalSha256(receipt.grant.executor) === canonicalSha256(record.executor) &&
        receipt.result.artifactId === artifact.id &&
        receipt.result.contentId === artifact.content.contentId,
      event,
      `span translation ${record.jobId} has no exact output and receipt closure`,
    );
    record.status = "completed";
    record.artifactId = artifact.id;
    record.contentId = artifact.content.contentId;
    record.receiptArtifactId = receiptArtifact.id;
    record.receiptId = receipt.receiptId;
    record.receiptContentId = receiptArtifact.content.contentId;
    record.result = structuredClone({ status: receipt.result.status });
    return true;
  }

  if (event.type === "translation.span_failed") {
    invariant(
      event.producer.kind === "span_translation_host" || event.producer.kind === "recovery_host",
      event,
      "span translation failure must come from the bounded translation or recovery host",
    );
    invariant(
      event.producer.kind !== "recovery_host" || event.data.reason === SPAN_TRANSLATION_INTERRUPTED_REASON,
      event,
      "span translation recovery must use the closed interruption reason",
    );
    const record = next.spanTranslations[event.data.jobId];
    invariant(record?.status === "started", event, `span translation ${event.data.jobId} is not active`);
    record.status = "failed";
    record.failure = event.data.reason;
    return true;
  }

  return false;
}
