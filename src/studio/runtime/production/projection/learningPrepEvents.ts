import type { RuntimeProjection } from "../model.ts";
import { LEARNING_PREP_INTERRUPTED_REASON, LEARNING_PREP_LIMITS } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { canonicalSha256 } from "../canonicalIdentity.ts";
import {
  createLearningPrepGrantId,
  createLearningPrepJobId,
  createLearningPrepRequestFingerprint,
} from "../learningPrep/identity.ts";
import { invariant } from "./shared.ts";

export function applyLearningPrepEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "learning.prep_started") {
    invariant(
      event.producer.kind === "learning_prep_host",
      event,
      "learning preps must come from the bounded learning-prep host",
    );
    const { jobId, request, grant, input } = event.data;
    const matchingAttempts = Object.values(next.learningPreps)
      .filter((record) => record.requestFingerprint === grant.requestFingerprint);
    const expectedFingerprint = createLearningPrepRequestFingerprint({
      runId: next.runId,
      request,
      authority: input,
      executor: grant.executor,
      rightsScope: grant.rightsScope,
    });
    const expectedGrantId = createLearningPrepGrantId({
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
      `learning prep ${jobId} has no exact completed caption result`,
    );
    invariant(
      !Object.values(next.publishReviewRevocations).some((revocation) =>
        revocation.reviewId === caption.approvalReviewId && revocation.status !== "failed"),
      event,
      `learning prep ${jobId} cannot start from revoked caption authority`,
    );
    invariant(
      !next.learningPreps[jobId] &&
        matchingAttempts.length === grant.attempt &&
        matchingAttempts.every((record) => record.status === "failed"),
      event,
      `learning prep ${jobId} is duplicated`,
    );
    invariant(
      grant.requestFingerprint === expectedFingerprint &&
        grant.attempt < LEARNING_PREP_LIMITS.maxAttemptsPerRequest &&
        grant.grantId === expectedGrantId &&
        jobId === createLearningPrepJobId(grant.grantId) &&
        grant.runId === next.runId &&
        canonicalSha256(grant.caption) === canonicalSha256(request.caption) &&
        canonicalSha256(grant.fineTune) === canonicalSha256(request.fineTune) &&
        canonicalSha256(input.caption) === canonicalSha256(request.caption),
      event,
      `learning prep ${jobId} changed its request, grant, or input authority`,
    );
    next.learningPreps[jobId] = {
      jobId,
      attempt: grant.attempt,
      requestFingerprint: grant.requestFingerprint,
      caption: structuredClone(request.caption),
      fineTune: structuredClone(request.fineTune),
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

  if (event.type === "learning.prep_completed") {
    invariant(
      event.producer.kind === "learning_prep_host",
      event,
      "learning prep completion must come from the bounded learning-prep host",
    );
    const record = next.learningPreps[event.data.jobId];
    const artifact = next.artifacts[event.data.artifactId];
    const receiptArtifact = next.artifacts[event.data.receiptArtifactId];
    const receipt = event.data.receipt;
    invariant(record?.status === "started", event, `learning prep ${event.data.jobId} is not active`);
    invariant(
      artifact?.origin.kind === "learning_prep_output" &&
        artifact.origin.jobId === record.jobId &&
        artifact.content.contentId === event.data.contentId &&
        receiptArtifact?.origin.kind === "learning_prep_receipt" &&
        receiptArtifact.origin.jobId === record.jobId &&
        receiptArtifact.origin.prepArtifactId === artifact.id &&
        receiptArtifact.content.contentId === event.data.receiptContentId &&
        receipt.jobId === record.jobId &&
        receipt.grant.grantId === record.grantId &&
        receipt.grant.requestFingerprint === record.requestFingerprint &&
        canonicalSha256(receipt.grant.executor) === canonicalSha256(record.executor) &&
        receipt.result.artifactId === artifact.id &&
        receipt.result.contentId === artifact.content.contentId,
      event,
      `learning prep ${record.jobId} has no exact output and receipt closure`,
    );
    record.status = "completed";
    record.artifactId = artifact.id;
    record.contentId = artifact.content.contentId;
    record.receiptArtifactId = receiptArtifact.id;
    record.receiptId = receipt.receiptId;
    record.receiptContentId = receiptArtifact.content.contentId;
    record.result = structuredClone({
      status: receipt.result.status,
      armedLensCount: receipt.result.armedLensCount,
      surfacedLensCount: receipt.result.surfacedLensCount,
      abstainedLensCount: receipt.result.abstainedLensCount,
      candidateCount: receipt.result.candidateCount,
      availableCandidateCount: receipt.result.availableCandidateCount,
      withheldCandidateCount: receipt.result.withheldCandidateCount,
      unavailableCandidateCount: receipt.result.unavailableCandidateCount,
      beatCount: receipt.result.beatCount,
    });
    return true;
  }

  if (event.type === "learning.prep_failed") {
    invariant(
      event.producer.kind === "learning_prep_host" || event.producer.kind === "recovery_host",
      event,
      "learning prep failure must come from the bounded learning-prep or recovery host",
    );
    invariant(
      event.producer.kind !== "recovery_host" || event.data.reason === LEARNING_PREP_INTERRUPTED_REASON,
      event,
      "learning prep recovery must use the closed interruption reason",
    );
    const record = next.learningPreps[event.data.jobId];
    invariant(record?.status === "started", event, `learning prep ${event.data.jobId} is not active`);
    record.status = "failed";
    record.failure = event.data.reason;
    return true;
  }

  return false;
}
