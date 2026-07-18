import type { RuntimeProjection } from "../model.ts";
import { LANGUAGE_EXPLANATION_INTERRUPTED_REASON, LANGUAGE_EXPLANATION_LIMITS } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { canonicalSha256 } from "../canonicalIdentity.ts";
import {
  createLanguageExplanationGrantId,
  createLanguageExplanationJobId,
  createLanguageExplanationRequestFingerprint,
} from "../languageExplanations/identity.ts";
import { invariant } from "./shared.ts";

export function applyLanguageExplanationEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "language.explanation_started") {
    invariant(
      event.producer.kind === "language_explanation_host",
      event,
      "language explanations must come from the bounded explanation host",
    );
    const { jobId, request, grant, input } = event.data;
    const matchingAttempts = Object.values(next.languageExplanations)
      .filter((record) => record.requestFingerprint === grant.requestFingerprint);
    const expectedFingerprint = createLanguageExplanationRequestFingerprint({
      runId: next.runId,
      request,
      authority: input,
      executor: grant.executor,
      rightsScope: grant.rightsScope,
    });
    const expectedGrantId = createLanguageExplanationGrantId({
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
      `language explanation ${jobId} has no exact completed caption result`,
    );
    invariant(
      !Object.values(next.publishReviewRevocations).some((revocation) =>
        revocation.reviewId === caption.approvalReviewId && revocation.status !== "failed"),
      event,
      `language explanation ${jobId} cannot start from revoked caption authority`,
    );
    invariant(
      !next.languageExplanations[jobId] &&
        matchingAttempts.length === grant.attempt &&
        matchingAttempts.every((record) => record.status === "failed"),
      event,
      `language explanation ${jobId} is duplicated`,
    );
    invariant(
      grant.requestFingerprint === expectedFingerprint &&
        grant.attempt < LANGUAGE_EXPLANATION_LIMITS.maxAttemptsPerRequest &&
        grant.grantId === expectedGrantId &&
        jobId === createLanguageExplanationJobId(grant.grantId) &&
        grant.runId === next.runId &&
        canonicalSha256(grant.caption) === canonicalSha256(request.caption) &&
        grant.lineId === request.lineId &&
        canonicalSha256(grant.selection) === canonicalSha256(request.selection) &&
        canonicalSha256(grant.facetKinds) === canonicalSha256(request.facetKinds) &&
        canonicalSha256(input.caption) === canonicalSha256(request.caption) &&
        input.line.lineId === request.lineId &&
        canonicalSha256(input.selection) === canonicalSha256(request.selection),
      event,
      `language explanation ${jobId} changed its request, grant, or input authority`,
    );
    next.languageExplanations[jobId] = {
      jobId,
      attempt: grant.attempt,
      requestFingerprint: grant.requestFingerprint,
      caption: structuredClone(request.caption),
      lineId: request.lineId,
      selection: structuredClone(request.selection),
      facetKinds: [...request.facetKinds],
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

  if (event.type === "language.explanation_completed") {
    invariant(
      event.producer.kind === "language_explanation_host",
      event,
      "language explanation completion must come from the bounded explanation host",
    );
    const record = next.languageExplanations[event.data.jobId];
    const artifact = next.artifacts[event.data.artifactId];
    const receiptArtifact = next.artifacts[event.data.receiptArtifactId];
    const receipt = event.data.receipt;
    invariant(record?.status === "started", event, `language explanation ${event.data.jobId} is not active`);
    invariant(
      artifact?.origin.kind === "language_explanation_output" &&
        artifact.origin.jobId === record.jobId &&
        artifact.content.contentId === event.data.contentId &&
        receiptArtifact?.origin.kind === "language_explanation_receipt" &&
        receiptArtifact.origin.jobId === record.jobId &&
        receiptArtifact.origin.explanationArtifactId === artifact.id &&
        receiptArtifact.content.contentId === event.data.receiptContentId &&
        receipt.jobId === record.jobId &&
        receipt.grant.grantId === record.grantId &&
        receipt.grant.requestFingerprint === record.requestFingerprint &&
        canonicalSha256(receipt.grant.executor) === canonicalSha256(record.executor) &&
        receipt.result.artifactId === artifact.id &&
        receipt.result.contentId === artifact.content.contentId,
      event,
      `language explanation ${record.jobId} has no exact output and receipt closure`,
    );
    record.status = "completed";
    record.artifactId = artifact.id;
    record.contentId = artifact.content.contentId;
    record.receiptArtifactId = receiptArtifact.id;
    record.receiptId = receipt.receiptId;
    record.receiptContentId = receiptArtifact.content.contentId;
    record.result = structuredClone({
      status: receipt.result.status,
      requestedFacetCount: receipt.result.requestedFacetCount,
      availableFacetCount: receipt.result.availableFacetCount,
      withheldFacetCount: receipt.result.withheldFacetCount,
      unavailableFacetCount: receipt.result.unavailableFacetCount,
    });
    return true;
  }

  if (event.type === "language.explanation_failed") {
    invariant(
      event.producer.kind === "language_explanation_host" || event.producer.kind === "recovery_host",
      event,
      "language explanation failure must come from the bounded explanation or recovery host",
    );
    invariant(
      event.producer.kind !== "recovery_host" || event.data.reason === LANGUAGE_EXPLANATION_INTERRUPTED_REASON,
      event,
      "language explanation recovery must use the closed interruption reason",
    );
    const record = next.languageExplanations[event.data.jobId];
    invariant(record?.status === "started", event, `language explanation ${event.data.jobId} is not active`);
    record.status = "failed";
    record.failure = event.data.reason;
    return true;
  }

  return false;
}
