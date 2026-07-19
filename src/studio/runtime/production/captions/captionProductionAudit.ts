import { createHash } from "node:crypto";

import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
  createCaptionArtifactId,
} from "../artifactStore.ts";
import type {
  CaptionExecutorDescriptor,
  CaptionProductionArtifact,
  CaptionProductionReceipt,
  CaptionProductionStatus,
  CaptionStudyIdentity,
  RuntimeProjection,
  StudyReadinessReceiptIdentity,
} from "../model.ts";
import { CAPTION_PRODUCTION_LIMITS } from "../model.ts";
import { reopenPublishReviewDecisions } from "../review/publishReviewDecisionAudit.ts";
import {
  captionLineReceiptProjection,
  captionStudyIdentity,
  closeGeneralizedCaptionLineCausality,
  deriveCaptionLineStudySupport,
  generalizedCaptionStudyIdentity,
} from "./captionStudyCausality.ts";
import { materializeCaptionProductionLines } from "./captionArtifactCompaction.ts";
import { rangeOverlapsNonDialogue } from "../../../acoustic/dialogueScopePolicy.ts";
import { reopenStudyReadiness } from "../study/studyReadinessAudit.ts";
import { reopenOwnedMediaStudy } from "../study/studySynthesisAudit.ts";
import { GeneralizedStudyReadinessHost } from "../study/generalizedStudyReadinessHost.ts";
import { generalizedReadinessReference } from "../study/generalizedStudyRuntime.ts";
import { GeneralizedCaptionCausalityHost } from "./generalizedCaptionCausality.ts";
import { RestudiedStudyReadinessHost } from "../study/restudiedStudyReadinessHost.ts";
import { restudiedReadinessReference } from "../study/restudiedStudyRuntime.ts";
import { RestudiedCaptionCausalityHost } from "./restudiedCaptionCausality.ts";
import type { RuntimeEvent } from "../protocol.ts";
import {
  validateCaptionProductionArtifact,
  validateCaptionProductionReceipt,
} from "../validation/captionProduction.ts";

export interface CaptionProductionVerification {
  jobId: string;
  approval: {
    reviewId: string;
    artifactId: string;
    receiptId: string;
    receiptContentId: string;
  };
  authorityState: "unrevoked" | "revoked_after_completion";
  integrity: "stored_caption_and_receipt_with_verified_study_readiness_approval";
  source: {
    artifactId: string;
    contentId: string;
    analysisRequestId: string;
    range: { startMs: number; endMs: number };
  };
  study: CaptionStudyIdentity;
  readiness: StudyReadinessReceiptIdentity;
  reopened: {
    sourceArtifactIds: string[];
    semanticEvidenceArtifactIds: string[];
    reportArtifactIds: string[];
    admissionIds: string[];
    planningDecisionIds: string[];
    executorIds: string[];
  };
  captionArtifactId: string;
  captionContentId: string;
  receiptArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  executor: CaptionExecutorDescriptor;
  result: {
    status: CaptionProductionStatus;
    lineCount: number;
    sourceAvailableCount: number;
    targetAvailableCount: number;
    withheldCount: number;
    unavailableCount: number;
  };
}

export interface VerifiedCaptionProductionResult {
  verification: CaptionProductionVerification;
  artifact: CaptionProductionArtifact;
}

function expectedStorageKey(contentId: string): string {
  const digest = contentId.replace(/^sha256:/, "");
  return `objects/sha256/${digest.slice(0, 2)}/${digest}`;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

async function storedJson(
  artifacts: ContentAddressedArtifactStore,
  contentId: string,
): Promise<{ value: unknown; bytes: number }> {
  const bytes = await artifacts.receiptBytes(contentId);
  if (bytes.byteLength <= 0 || bytes.byteLength > CAPTION_PRODUCTION_LIMITS.maxArtifactBytes) {
    throw new Error("Stored caption production exceeds its byte bound");
  }
  const measured = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (measured !== contentId) throw new Error("Stored caption production changed content identity");
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("Stored caption production is invalid JSON");
  }
  if (canonicalJsonContentId(value) !== contentId) {
    throw new Error("Stored caption production is not canonical JSON");
  }
  return { value, bytes: bytes.byteLength };
}

function receiptIdentity(receipt: CaptionProductionReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `caption-production-receipt:${canonicalSha256(body)}`;
}

/** Reopens immutable KO+EN artifacts and repeats the full approval/revocation integrity audit. */
export async function reopenCaptionProductionResults(
  state: RuntimeProjection,
  events: readonly RuntimeEvent[],
  artifacts: ContentAddressedArtifactStore,
): Promise<VerifiedCaptionProductionResult[]> {
  const completed = Object.values(state.captionProductions)
    .filter((job) => job.status === "completed")
    .sort((left, right) => left.id.localeCompare(right.id));
  if (completed.length === 0) return [];

  const reviews = await reopenPublishReviewDecisions(state, events, artifacts);
  const verified: VerifiedCaptionProductionResult[] = [];

  for (const job of completed) {
    if (
      !job.captionArtifactId || !job.captionContentId || !job.receiptArtifactId ||
      !job.receiptId || !job.receiptContentId || !job.resultStatus ||
      job.lineCount === null || job.sourceAvailableCount === null ||
      job.targetAvailableCount === null || job.withheldCount === null || job.unavailableCount === null
    ) throw new Error(`Completed caption production ${job.id} has an incomplete projection`);

    const approval = reviews.find((review) =>
      review.reviewId === job.approvalReviewId &&
      review.artifactId === job.approvalArtifactId &&
      review.receiptId === job.approvalReceiptId &&
      review.receiptContentId === job.approvalReceiptContentId
    );
    if (!approval || approval.outcome !== "approve_for_caption_production") {
      throw new Error(`Caption production ${job.id} no longer has its exact verified approval`);
    }
    const generalizedRecord = state.generalizedStudyReadiness[approval.readiness.readinessId] ?? null;
    const generalizedReadiness = generalizedRecord
      ? generalizedRecord.schema === "studio.study-readiness.receipt.v4"
        ? await new RestudiedStudyReadinessHost(state, artifacts).reopen(restudiedReadinessReference(generalizedRecord))
        : await new GeneralizedStudyReadinessHost(state, artifacts).reopen(generalizedReadinessReference(generalizedRecord))
      : null;
    const readiness = generalizedRecord ? null : await reopenStudyReadiness(state, artifacts, approval.readiness.readinessId);
    if (generalizedReadiness) {
      if (!generalizedReadiness.reopenedStudy || generalizedRecord!.artifactId !== approval.readiness.artifactId ||
          generalizedReadiness.readinessId !== approval.readiness.readinessId ||
          generalizedReadiness.receiptId !== approval.readiness.receiptId ||
          generalizedReadiness.receiptContentId !== approval.readiness.receiptContentId ||
          generalizedReadiness.receipt.result.outcome !== "proceed_to_caption_review") {
        throw new Error(`Caption production ${job.id} lost its exact generalized proceed-to-caption-review authority`);
      }
    } else if (!readiness || readiness.readinessId !== approval.readiness.readinessId ||
        readiness.artifactId !== approval.readiness.artifactId || readiness.receiptId !== approval.readiness.receiptId ||
        readiness.receiptContentId !== approval.readiness.receiptContentId || readiness.receipt.result.outcome !== "proceed_to_caption_review") {
      throw new Error(`Caption production ${job.id} lost its exact proceed-to-caption-review authority`);
    }
    const generalizedStudy = generalizedReadiness?.reopenedStudy ?? null;
    const study = readiness ? await reopenOwnedMediaStudy(state, artifacts, readiness.receipt.input.studyId) : null;
    const studyIdentity = generalizedStudy ? generalizedCaptionStudyIdentity(generalizedStudy) : captionStudyIdentity(study!);
    const readinessId = generalizedReadiness?.readinessId ?? readiness!.readinessId;
    const readinessArtifactId = generalizedRecord?.artifactId ?? readiness!.artifactId;
    const reopened = generalizedStudy ? {
      sourceArtifactIds: [generalizedStudy.envelope.root.source.artifactId],
      semanticEvidenceArtifactIds: [...new Set(generalizedStudy.envelope.evidenceCitations
        .filter((citation) => citation.evidenceKind === "current_run_speech")
        .map((citation) => citation.evidence.artifactId))].sort(),
      reportArtifactIds: generalizedStudy.envelope.reports.map((entry) => entry.report.artifactId).sort(),
      admissionIds: generalizedStudy.envelope.reports.map((entry) => entry.admission.admissionId).sort(),
      planningDecisionIds: [],
      executorIds: [generalizedStudy.envelope.root.executionId],
    } : study!.reopened;
    if (!sameCanonical(job.study, studyIdentity) || !sameCanonical(job.readiness, approval.readiness)) {
      throw new Error(`Caption production ${job.id} changed its exact approved study/readiness identity`);
    }

    const started = events.find((event) =>
      event.type === "caption.production_started" && event.data.jobId === job.id);
    const completion = events.find((event) =>
      event.type === "caption.production_completed" && event.data.jobId === job.id);
    const captionArtifact = state.artifacts[job.captionArtifactId];
    const receiptArtifact = state.artifacts[job.receiptArtifactId];
    const sourceArtifact = state.artifacts[job.sourceArtifactId];
    if (
      !started || started.type !== "caption.production_started" ||
      !completion || completion.type !== "caption.production_completed" ||
      !captionArtifact || captionArtifact.origin.kind !== "caption_production_output" ||
      !receiptArtifact || receiptArtifact.origin.kind !== "caption_production_receipt" ||
      !sourceArtifact || sourceArtifact.origin.kind !== "ingest" ||
      sourceArtifact.content.contentId !== job.sourceContentId
    ) throw new Error(`Caption production ${job.id} has no closed journal and artifact lineage`);
    await artifacts.resolveVerified(sourceArtifact);

    let authorityState: CaptionProductionVerification["authorityState"] = "unrevoked";
    if (approval.revocation) {
      const revocationStart = events.find((event) =>
        event.type === "publish.review.revocation_started" &&
        event.data.revocationId === approval.revocation?.revocationId);
      if (!revocationStart || revocationStart.seq <= completion.seq) {
        throw new Error(`Caption production ${job.id} overlapped or followed approval revocation`);
      }
      authorityState = "revoked_after_completion";
    }

    const expectedCaptionArtifactId = createCaptionArtifactId(state.runId, job.id, job.captionContentId);
    const expectedReceiptArtifactId = `artifact:${canonicalSha256({
      runId: state.runId,
      jobId: job.id,
      kind: "caption-production-receipt",
      contentId: job.receiptContentId,
    })}`;
    if (
      captionArtifact.id !== expectedCaptionArtifactId ||
      captionArtifact.runId !== state.runId || captionArtifact.kind !== "caption-production-output" ||
      captionArtifact.mediaClass !== "non_media" || captionArtifact.publication !== "private" ||
      captionArtifact.content.contentId !== job.captionContentId ||
      captionArtifact.storageKey !== expectedStorageKey(job.captionContentId) ||
      captionArtifact.producerTaskId !== null || captionArtifact.producerAgentId !== null ||
      captionArtifact.origin.jobId !== job.id || captionArtifact.origin.receiptId !== job.receiptId ||
      captionArtifact.origin.receiptContentId !== job.receiptContentId ||
      captionArtifact.origin.approvalReviewId !== approval.reviewId ||
      captionArtifact.origin.approvalArtifactId !== approval.artifactId ||
      captionArtifact.origin.sourceArtifactId !== job.sourceArtifactId ||
      captionArtifact.origin.studyId !== studyIdentity.studyId ||
      captionArtifact.origin.studyArtifactId !== studyIdentity.artifactId ||
      captionArtifact.origin.readinessId !== readinessId ||
      captionArtifact.origin.readinessArtifactId !== readinessArtifactId ||
      !sameCanonical(captionArtifact.sourceArtifactIds, [
        job.sourceArtifactId,
        studyIdentity.artifactId,
        readinessArtifactId,
        approval.artifactId,
      ]) ||
      receiptArtifact.id !== expectedReceiptArtifactId || receiptArtifact.runId !== state.runId ||
      receiptArtifact.kind !== "caption-production-receipt" || receiptArtifact.mediaClass !== "non_media" ||
      receiptArtifact.publication !== "private" || receiptArtifact.content.contentId !== job.receiptContentId ||
      receiptArtifact.storageKey !== expectedStorageKey(job.receiptContentId) ||
      receiptArtifact.producerTaskId !== null || receiptArtifact.producerAgentId !== null ||
      receiptArtifact.origin.jobId !== job.id || receiptArtifact.origin.receiptId !== job.receiptId ||
      receiptArtifact.origin.receiptContentId !== job.receiptContentId ||
      receiptArtifact.origin.approvalReviewId !== approval.reviewId ||
      receiptArtifact.origin.approvalArtifactId !== approval.artifactId ||
      receiptArtifact.origin.captionArtifactId !== captionArtifact.id ||
      receiptArtifact.origin.captionContentId !== captionArtifact.content.contentId ||
      receiptArtifact.origin.studyId !== studyIdentity.studyId ||
      receiptArtifact.origin.studyArtifactId !== studyIdentity.artifactId ||
      receiptArtifact.origin.readinessId !== readinessId ||
      receiptArtifact.origin.readinessArtifactId !== readinessArtifactId ||
      !sameCanonical(receiptArtifact.sourceArtifactIds, [
        captionArtifact.id,
        studyIdentity.artifactId,
        readinessArtifactId,
        approval.artifactId,
      ]) ||
      completion.data.captionArtifactId !== captionArtifact.id ||
      completion.data.captionContentId !== captionArtifact.content.contentId ||
      completion.data.receiptArtifactId !== receiptArtifact.id ||
      completion.data.receiptContentId !== receiptArtifact.content.contentId
    ) throw new Error(`Caption production ${job.id} artifact identities do not close`);

    const [storedCaption, storedReceipt] = await Promise.all([
      storedJson(artifacts, job.captionContentId),
      storedJson(artifacts, job.receiptContentId),
    ]);
    const caption = validateCaptionProductionArtifact(
      storedCaption.value,
      "Caption-production verification",
      "caption",
    );
    const receipt = validateCaptionProductionReceipt(
      storedReceipt.value,
      "Caption-production verification",
      "receipt",
    );
    const expectsDialogueScopeVersion = Boolean(readiness?.receipt.dialogueScopePolicy);
    if (generalizedStudy
      ? generalizedRecord!.schema === "studio.study-readiness.receipt.v4"
        ? caption.schema !== "studio.caption-production.artifact.v5" || receipt.schema !== "studio.caption-production.receipt.v5"
        : caption.schema !== "studio.caption-production.artifact.v3" || receipt.schema !== "studio.caption-production.receipt.v3"
      : (caption.schema === "studio.caption-production.artifact.v2") !== expectsDialogueScopeVersion ||
        (receipt.schema === "studio.caption-production.receipt.v2") !== expectsDialogueScopeVersion
    ) throw new Error(`Caption production ${job.id} does not use the contract version required by its readiness policy`);
    const captionLines = materializeCaptionProductionLines(caption);
    const restudiedCausality = generalizedRecord?.schema === "studio.study-readiness.receipt.v4"
      ? new RestudiedCaptionCausalityHost(state, artifacts)
      : null;
    const generalizedCausality = generalizedRecord && generalizedRecord.schema !== "studio.study-readiness.receipt.v4"
      ? new GeneralizedCaptionCausalityHost(state, artifacts)
      : null;
    let invalidLineCausality = false;
    for (const line of captionLines) {
      const commonInvalid = !sameCanonical(line.lineage.readiness, approval.readiness) ||
        !sameCanonical(line.lineage.approval, {
          reviewId: approval.reviewId,
          artifactId: approval.artifactId,
          receiptId: approval.receiptId,
          receiptContentId: approval.receiptContentId,
        }) || !sameCanonical(line.lineage.captionExecutor, {
          jobId: job.id,
          id: caption.executor.id,
          version: caption.executor.version,
          executionScope: caption.executor.executionScope,
          cognitionClaim: caption.executor.cognitionClaim,
        });
      if (generalizedStudy && generalizedRecord) {
        const causality = line.lineage.generalizedCausality;
        if (!causality) { invalidLineCausality = true; continue; }
        if (causality.source.state !== "withheld") {
          const unavailable = causality.source.state === "unavailable" && causality.target.state === "unavailable" &&
            causality.source.text === null && causality.target.text === null &&
            (causality.source.reasonCode === "recognizer_unavailable" || causality.source.reasonCode === "recognizer_empty") &&
            causality.target.reasonCode === "source_unavailable";
          const available = causality.source.state === "available" && causality.target.state === "available" &&
            causality.source.text !== null && causality.target.text !== null;
          if (!available && !unavailable) { invalidLineCausality = true; continue; }
          const expected = generalizedRecord.schema === "studio.study-readiness.receipt.v4"
            ? unavailable
              ? await restudiedCausality!.close({ readiness: restudiedReadinessReference(generalizedRecord), range: structuredClone(causality.range), sourceText: null, targetText: null, sourceUnavailableReason: causality.source.reasonCode as "recognizer_unavailable" | "recognizer_empty" })
              : await restudiedCausality!.close({ readiness: restudiedReadinessReference(generalizedRecord), range: structuredClone(causality.range), sourceText: causality.source.text!, targetText: causality.target.text! })
            : unavailable
              ? await generalizedCausality!.close({ readiness: generalizedReadinessReference(generalizedRecord), range: structuredClone(causality.range), sourceText: null, targetText: null, sourceUnavailableReason: causality.source.reasonCode as "recognizer_unavailable" | "recognizer_empty" })
              : await generalizedCausality!.close({ readiness: generalizedReadinessReference(generalizedRecord), range: structuredClone(causality.range), sourceText: causality.source.text!, targetText: causality.target.text! });
          if (!sameCanonical(expected, causality)) { invalidLineCausality = true; continue; }
        }
        const expectedLine = closeGeneralizedCaptionLineCausality({
          line: { id: line.id, startMs: line.startMs, endMs: line.endMs, source: line.source, target: line.target },
          state, study: generalizedStudy, studyIdentity, causality,
          readiness: approval.readiness,
          approval: { reviewId: approval.reviewId, artifactId: approval.artifactId, receiptId: approval.receiptId, receiptContentId: approval.receiptContentId },
          source: { artifactId: job.sourceArtifactId, contentId: job.sourceContentId },
          executor: line.lineage.captionExecutor,
          derivation: line.lineage.derivation,
        });
        if (commonInvalid || !sameCanonical(expectedLine, line)) invalidLineCausality = true;
      } else {
        const expectedSupport = deriveCaptionLineStudySupport(study!, line.startMs, line.endMs);
        const excluded = readiness!.receipt.dialogueScopePolicy
          ? rangeOverlapsNonDialogue(readiness!.receipt.dialogueScopePolicy, line.startMs, line.endMs)
          : false;
        const claimsExcluded = line.source.reasonCode === "not_in_requested_dialogue_scope" || line.target.reasonCode === "not_in_requested_dialogue_scope";
        if ((excluded && (
            line.source.state !== "withheld" || line.target.state !== "withheld" || line.source.text !== null || line.target.text !== null ||
            line.source.reasonCode !== "not_in_requested_dialogue_scope" || line.target.reasonCode !== "not_in_requested_dialogue_scope"
          )) || (!excluded && claimsExcluded) || commonInvalid ||
          !sameCanonical(line.lineage.study, { ...studyIdentity, ...expectedSupport })) invalidLineCausality = true;
      }
    }
    const rootTask = generalizedStudy ? state.tasks[generalizedStudy.envelope.root.taskId] : null;
    const sourceBindingValid = generalizedStudy
      ? generalizedStudy.envelope.root.source.artifactId === caption.input.sourceArtifactId &&
        generalizedStudy.envelope.root.source.contentId === caption.input.sourceContentId &&
        rootTask?.jobContext.analysisRequest.requestId === caption.input.analysisRequestId &&
        sameCanonical(rootTask.jobContext.analysisRequest.requestedRange, caption.input.range)
      : study!.envelope.root.jobContext.source.artifactId === caption.input.sourceArtifactId &&
        study!.envelope.root.jobContext.source.contentId === caption.input.sourceContentId &&
        study!.envelope.root.jobContext.analysisRequest.requestId === caption.input.analysisRequestId &&
        sameCanonical(study!.envelope.root.jobContext.analysisRequest.requestedRange, caption.input.range);
    if (
      invalidLineCausality || caption.executor.executionScope !== "current_run" ||
      captionArtifact.content.bytes !== storedCaption.bytes ||
      receiptArtifact.content.bytes !== storedReceipt.bytes ||
      caption.jobId !== job.id || caption.runId !== state.runId ||
      !sameCanonical(caption.input, started.data.input) ||
      !sameCanonical(caption.input.study, studyIdentity) ||
      !sameCanonical(caption.input.readiness, approval.readiness) ||
      !sourceBindingValid ||
      !sameCanonical(caption.executor, started.data.executor) ||
      receipt.receiptId !== receiptIdentity(receipt) || receipt.receiptId !== job.receiptId ||
      receipt.jobId !== job.id || !sameCanonical(receipt.authority.approval, started.data.request.approval) ||
      !sameCanonical(receipt.authority.approval, {
        reviewId: approval.reviewId,
        artifactId: approval.artifactId,
        receiptId: approval.receiptId,
        receiptContentId: approval.receiptContentId,
      }) ||
      !sameCanonical(receipt.authority.verification.readiness, approval.readiness) ||
      !sameCanonical(receipt.authority.verification.study, studyIdentity) ||
      !sameCanonical(receipt.input, caption.input) ||
      !sameCanonical(receipt.producer.executor, caption.executor) ||
      !sameCanonical(receipt.limits, started.data.limits) ||
      receipt.result.captionArtifactId !== captionArtifact.id ||
      receipt.result.captionContentId !== captionArtifact.content.contentId ||
      receipt.result.captionBytes !== captionArtifact.content.bytes ||
      !sameCanonical(receipt.result.lines, captionLines.map(captionLineReceiptProjection)) ||
      !sameCanonical(receipt.result.lines, job.lines) ||
      !sameCanonical(caption.result, {
        status: receipt.result.status,
        lineCount: receipt.result.lineCount,
        sourceAvailableCount: receipt.result.sourceAvailableCount,
        targetAvailableCount: receipt.result.targetAvailableCount,
        withheldCount: receipt.result.withheldCount,
        unavailableCount: receipt.result.unavailableCount,
      }) ||
      !sameCanonical(receipt, completion.data.receipt) ||
      receipt.result.status !== job.resultStatus || receipt.result.lineCount !== job.lineCount ||
      receipt.result.sourceAvailableCount !== job.sourceAvailableCount ||
      receipt.result.targetAvailableCount !== job.targetAvailableCount ||
      receipt.result.withheldCount !== job.withheldCount ||
      receipt.result.unavailableCount !== job.unavailableCount
    ) throw new Error(`Stored caption production ${job.id} changed its authority, content, or result counts`);

    verified.push({
      verification: {
        jobId: job.id,
        approval: {
          reviewId: approval.reviewId,
          artifactId: approval.artifactId,
          receiptId: approval.receiptId,
          receiptContentId: approval.receiptContentId,
        },
        source: {
          artifactId: job.sourceArtifactId,
          contentId: job.sourceContentId,
          analysisRequestId: job.analysisRequestId,
          range: structuredClone(job.range),
        },
        study: structuredClone(studyIdentity),
        readiness: structuredClone(approval.readiness),
        reopened: structuredClone(reopened),
        authorityState,
        integrity: "stored_caption_and_receipt_with_verified_study_readiness_approval",
        captionArtifactId: captionArtifact.id,
        captionContentId: captionArtifact.content.contentId,
        receiptArtifactId: receiptArtifact.id,
        receiptId: receipt.receiptId,
        receiptContentId: receiptArtifact.content.contentId,
        executor: structuredClone(caption.executor),
        result: structuredClone(caption.result),
      },
      artifact: structuredClone(caption),
    });
  }
  return verified;
}

export async function reopenCaptionProductions(
  state: RuntimeProjection,
  events: readonly RuntimeEvent[],
  artifacts: ContentAddressedArtifactStore,
): Promise<CaptionProductionVerification[]> {
  return (await reopenCaptionProductionResults(state, events, artifacts))
    .map((result) => result.verification);
}
