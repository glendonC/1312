import type { RuntimeEvent } from "../protocol.ts";
import { validateRuntimeArtifact } from "./artifacts.ts";
import { assertEvidenceReadRequest, validateEvidenceReadReceipt } from "./evidence.ts";
import { assertEvidenceAssessmentRequest, validateEvidenceAssessmentReceipt } from "./assessment.ts";
import { assertEvidenceDecisionRequest, validateEvidenceDecisionReceipt } from "./decision.ts";
import {
  assertFrameSampleRequest,
  validateFrameSamplingLimits,
  validateFrameSamplingReceipt,
} from "./frames.ts";
import { assertOcrRequest, validateOcrLimits, validateOcrReceipt } from "./ocr.ts";
import { assertSpeakerOverlapRequest, validateSpeakerOverlapLimits, validateSpeakerOverlapReceipt } from "./speakers.ts";
import { assertConditionalSeparationRequest, validateConditionalSeparationLimits, validateConditionalSeparationReceipt, validateConditionalSeparationTrigger, validateRawStemComparisonReceipt } from "./separation.ts";
import { assertResearchRequest, validateResearchAllowedDomains, validateResearchExhaustionReceipt, validateResearchGapBinding, validateResearchLimits, validateResearchSearchReceipt, validateResearchSnapshotReceipt, validateRestudiedResearchRequestInput } from "./research.ts";
import {
  validatePublishReviewIntakeReceipt,
  validateStudyReadinessReceiptIdentity,
} from "./publishReview.ts";
import {
  assertPublishReviewDecisionRequest,
  assertPublishReviewRevocationRequest,
  validatePublishReviewDecisionReceipt,
  validatePublishReviewRevocationReceipt,
} from "./publishReviewDecision.ts";
import {
  assertCaptionProductionRequest,
  validateCaptionExecutorDescriptor,
  validateCaptionProductionInput,
  validateCaptionProductionLimits,
  validateCaptionProductionReceipt,
} from "./captionProduction.ts";
import { validateCaptionQualityControlReceipt } from "./captionQualityControl.ts";
import {
  validateExecutorSpanReceipt,
  validateModelUsageReceipt,
} from "./execution.ts";
import { validateReportRecord } from "./handoffs.ts";
import { validateRootOutputDispositionReceipt } from "./rootHandoff.ts";
import {
  assertParentArtifactReadRequest,
  validateParentAdmissionReceipt,
  validateParentArtifactDispositionReceipt,
  validateParentArtifactReadReceipt,
} from "./studyReports.ts";
import {
  validateParentArtifactAdmissionReceiptV2,
  validateParentArtifactReadReceiptV2,
} from "./studyReportsV2.ts";
import {
  validateOwnedMediaStudyExecutorReceipt,
  validateOwnedMediaStudyProjection,
  validateStudyPlanningDecisionReceipt,
  validateStudyReadinessReceipt,
} from "./studies.ts";
import {
  validateOwnedMediaStudyExecutorReceiptV2,
  validateStudyReadinessReceiptV3,
} from "./studiesV2.ts";
import {
  validateRangePassRequestReceipt,
  validateRangePassTerminalReceipt,
  validateOwnedMediaStudyExecutorReceiptV3,
  validateStudyReadinessReceiptV4,
} from "./studiesV3.ts";
import {
  assertMediaExtractRequest,
  assertMediaSeekRequest,
  validateMediaOperationReceipt,
} from "./media.ts";
import {
  assertSpeechTranscribeRequest,
  validateCurrentRunRecognizerDescriptor,
  validateSemanticEvidenceLimits,
  validateSemanticMediaEvidenceReceipt,
} from "./semanticEvidence.ts";
import {
  array,
  boolean,
  contentId,
  exact,
  fail,
  integer,
  isoTimestamp,
  literal,
  nullableString,
  object,
  oneOf,
  string,
  uniqueStrings,
} from "./primitives.ts";
import {
  TASK_STATUSES,
  assertAgentRecord,
  assertSpawnRequestInput,
  assertTaskRecord,
  validateGrants,
} from "./scheduling.ts";

const REJECTIONS = new Set([
  "requester_not_authorized",
  "max_depth",
  "max_active_workers",
  "run_budget",
  "duplicate_owner",
  "missing_output_contract",
  "dependency_unavailable",
  "scope_violation",
  "capability_not_grantable",
  "restudy_duplicate_work",
  "restudy_range_pass_cap",
  "restudy_producer_pass_cap",
  "separation_duplicate_work",
  "research_duplicate_work",
]);

export function assertRuntimeEvent(
  value: unknown,
  context = "Runtime event",
): asserts value is RuntimeEvent {
  const item = object(value, context, "event");
  exact(
    item,
    [
      "schema",
      "runId",
      "seq",
      "eventId",
      "recordedAt",
      "producer",
      "causationId",
      "correlationId",
      "type",
      "data",
    ],
    context,
    "event",
  );
  literal(item.schema, "studio.runtime.event.v1", context, "event.schema");
  string(item.runId, context, "event.runId");
  integer(item.seq, context, "event.seq", 1);
  string(item.eventId, context, "event.eventId");
  isoTimestamp(item.recordedAt, context, "event.recordedAt");
  const producer = object(item.producer, context, "event.producer");
  exact(producer, ["kind", "id"], context, "event.producer");
  oneOf(
    producer.kind,
    new Set(["scheduler", "registry", "artifact_store", "media_host", "frame_host", "ocr_host", "speaker_host", "separation_host", "research_host", "semantic_evidence_host", "evidence_host", "assessment_host", "decision_host", "publish_review_intake_host", "publish_review_host", "caption_production_host", "caption_quality_control_host", "handoff_host", "admission_host", "artifact_read_host", "study_planning_host", "study_restudy_host", "study_synthesis_host", "study_audit_host", "launcher", "recovery_host"]),
    context,
    "event.producer.kind",
  );
  string(producer.id, context, "event.producer.id");
  nullableString(item.causationId, context, "event.causationId");
  nullableString(item.correlationId, context, "event.correlationId");
  const type = string(item.type, context, "event.type");
  const data = object(item.data, context, "event.data");

  if (type === "artifact.recorded") {
    exact(data, ["artifact"], context, "event.data");
    validateRuntimeArtifact(data.artifact, context, "event.data.artifact");
  } else if (type === "task.created") {
    exact(data, ["task"], context, "event.data");
    assertTaskRecord(data.task, context, "event.data.task");
  } else if (type === "spawn.requested") {
    exact(
      data,
      ["requestId", "requestedByTaskId", "requestedByAgentId", "authoredByExecutionId", "toolCallId", "input"],
      context,
      "event.data",
    );
    string(data.requestId, context, "event.data.requestId");
    string(data.requestedByTaskId, context, "event.data.requestedByTaskId");
    string(data.requestedByAgentId, context, "event.data.requestedByAgentId");
    nullableString(data.authoredByExecutionId, context, "event.data.authoredByExecutionId");
    nullableString(data.toolCallId, context, "event.data.toolCallId");
    if ((data.authoredByExecutionId === null) !== (data.toolCallId === null)) {
      fail(context, "event.data", "must carry executor authorship and tool-call identity together");
    }
    assertSpawnRequestInput(data.input, context);
  } else if (type === "spawn.decided") {
    exact(
      data,
      ["requestId", "accepted", "rejection", "taskId", "agentId", "grants"],
      context,
      "event.data",
    );
    string(data.requestId, context, "event.data.requestId");
    const accepted = boolean(data.accepted, context, "event.data.accepted");
    const rejection = data.rejection === null
      ? null
      : oneOf<string>(data.rejection, REJECTIONS, context, "event.data.rejection");
    const taskId = nullableString(data.taskId, context, "event.data.taskId");
    const agentId = nullableString(data.agentId, context, "event.data.agentId");
    const acceptedGrants = validateGrants(data.grants, context, "event.data.grants");
    if (
      accepted &&
      (rejection !== null || taskId === null || agentId === null || acceptedGrants.length === 0)
    ) {
      fail(
        context,
        "event.data",
        "accepted decisions require identities and grants without rejection",
      );
    }
    if (
      !accepted &&
      (rejection === null || taskId !== null || agentId !== null || acceptedGrants.length !== 0)
    ) {
      fail(context, "event.data", "rejected decisions require only a rejection");
    }
  } else if (type === "agent.registered") {
    exact(data, ["agent"], context, "event.data");
    assertAgentRecord(data.agent, context, "event.data.agent");
  } else if (type === "task.launch_claimed") {
    exact(data, ["claim"], context, "event.data");
    const claim = object(data.claim, context, "event.data.claim");
    exact(claim, ["id", "requestId", "taskId", "agentId", "executorKind", "claimedAt", "executionId"], context, "event.data.claim");
    string(claim.id, context, "event.data.claim.id");
    string(claim.requestId, context, "event.data.claim.requestId");
    string(claim.taskId, context, "event.data.claim.taskId");
    string(claim.agentId, context, "event.data.claim.agentId");
    oneOf(claim.executorKind, new Set(["codex", "deterministic_test"]), context, "event.data.claim.executorKind");
    isoTimestamp(claim.claimedAt, context, "event.data.claim.claimedAt");
    nullableString(claim.executionId, context, "event.data.claim.executionId");
  } else if (type === "orchestrator.tool_called") {
    exact(data, ["callId", "executionId", "taskId", "tool"], context, "event.data");
    string(data.callId, context, "event.data.callId");
    string(data.executionId, context, "event.data.executionId");
    string(data.taskId, context, "event.data.taskId");
    oneOf(data.tool, new Set(["task_spawn_request", "task_reports_wait", "report_disposition", "artifact_read", "study_planning_decision", "study_restudy_request", "study_separation_request", "study_research_request", "study_synthesize"]), context, "event.data.tool");
  } else if (type === "reports.wait_started") {
    exact(data, ["waitId", "executionId", "parentTaskId"], context, "event.data");
    string(data.waitId, context, "event.data.waitId");
    string(data.executionId, context, "event.data.executionId");
    string(data.parentTaskId, context, "event.data.parentTaskId");
  } else if (type === "reports.wait_returned") {
    exact(data, ["waitId", "result", "failure", "children"], context, "event.data");
    string(data.waitId, context, "event.data.waitId");
    const result = oneOf<string>(data.result, new Set(["all_terminal", "closed_failure"]), context, "event.data.result");
    const failure = data.failure === null ? null : oneOf<string>(data.failure, new Set(["no_children", "child_interrupted", "child_failed"]), context, "event.data.failure");
    if ((result === "all_terminal") !== (failure === null)) fail(context, "event.data", "wait result and failure disagree");
    const children = array(data.children, context, "event.data.children");
    const taskIds: string[] = [];
    for (const [index, childValue] of children.entries()) {
      const child = object(childValue, context, `event.data.children[${index}]`);
      exact(child, ["taskId", "status", "reportId", "artifactIds", "failure"], context, `event.data.children[${index}]`);
      taskIds.push(string(child.taskId, context, `event.data.children[${index}].taskId`));
      const status = oneOf<string>(child.status, new Set(["reported", "completed", "failed", "withheld", "interrupted"]), context, `event.data.children[${index}].status`);
      nullableString(child.reportId, context, `event.data.children[${index}].reportId`);
      uniqueStrings(child.artifactIds, context, `event.data.children[${index}].artifactIds`);
      if (child.failure === null) {
        if (status === "failed" || status === "withheld" || status === "interrupted") fail(context, `event.data.children[${index}].failure`, "is required for a failed child");
      } else {
        const childFailure = object(child.failure, context, `event.data.children[${index}].failure`);
        exact(childFailure, ["state", "reason"], context, `event.data.children[${index}].failure`);
        oneOf(childFailure.state, new Set(["failed", "withheld", "interrupted"]), context, `event.data.children[${index}].failure.state`);
        string(childFailure.reason, context, `event.data.children[${index}].failure.reason`);
        if (childFailure.state !== status) fail(context, `event.data.children[${index}].failure.state`, "must match child status");
      }
    }
    if (new Set(taskIds).size !== taskIds.length) fail(context, "event.data.children", "must not repeat child tasks");
  } else if (type === "orchestrator.decision_recorded") {
    exact(data, ["decision"], context, "event.data");
    const decision = object(data.decision, context, "event.data.decision");
    exact(decision, ["executionId", "taskId", "outcome", "reason"], context, "event.data.decision");
    string(decision.executionId, context, "event.data.decision.executionId");
    string(decision.taskId, context, "event.data.decision.taskId");
    oneOf(decision.outcome, new Set(["completed", "no_request", "withheld"]), context, "event.data.decision.outcome");
    string(decision.reason, context, "event.data.decision.reason");
  } else if (type === "runtime.interrupted") {
    exact(data, ["reason", "taskIds", "executionIds"], context, "event.data");
    string(data.reason, context, "event.data.reason");
    const taskIds = uniqueStrings(data.taskIds, context, "event.data.taskIds");
    const executionIds = uniqueStrings(data.executionIds, context, "event.data.executionIds");
    if (taskIds.length === 0 && executionIds.length === 0) fail(context, "event.data", "must close at least one ambiguous identity");
  } else if (type === "task.transitioned") {
    exact(data, ["taskId", "agentId", "status", "reason"], context, "event.data");
    string(data.taskId, context, "event.data.taskId");
    string(data.agentId, context, "event.data.agentId");
    oneOf(data.status, TASK_STATUSES, context, "event.data.status");
    nullableString(data.reason, context, "event.data.reason");
  } else if (type === "executor.started") {
    exact(data, ["executionId", "taskId", "agentId", "launchClaimId", "startedAt"], context, "event.data");
    string(data.executionId, context, "event.data.executionId");
    string(data.taskId, context, "event.data.taskId");
    string(data.agentId, context, "event.data.agentId");
    string(data.launchClaimId, context, "event.data.launchClaimId");
    isoTimestamp(data.startedAt, context, "event.data.startedAt");
  } else if (type === "model.usage_recorded") {
    exact(data, ["receipt"], context, "event.data");
    validateModelUsageReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "executor.finished") {
    exact(data, ["receipt"], context, "event.data");
    validateExecutorSpanReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "media.operation_started") {
    exact(data, ["capability", "request", "grantId"], context, "event.data");
    const capability = oneOf<"media.extract" | "media.seek">(
      data.capability,
      new Set(["media.extract", "media.seek"]),
      context,
      "event.data.capability",
    );
    if (capability === "media.extract") assertMediaExtractRequest(data.request, context);
    else assertMediaSeekRequest(data.request, context);
    string(data.grantId, context, "event.data.grantId");
  } else if (type === "media.operation_completed") {
    exact(data, ["operationId", "outputArtifactId", "receipt"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    validateMediaOperationReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "media.operation_failed") {
    exact(data, ["operationId", "reason"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    string(data.reason, context, "event.data.reason");
  } else if (type === "media.frames_sampling_started") {
    exact(data, ["request", "scope", "sourceContentId", "executionId", "launchClaimId", "requestFingerprint", "limits"], context, "event.data");
    assertFrameSampleRequest(data.request, context);
    const scope = object(data.scope, context, "event.data.scope");
    exact(scope, ["artifactId", "trackId", "startMs", "endMs"], context, "event.data.scope");
    string(scope.artifactId, context, "event.data.scope.artifactId");
    string(scope.trackId, context, "event.data.scope.trackId");
    const startMs = integer(scope.startMs, context, "event.data.scope.startMs");
    const endMs = integer(scope.endMs, context, "event.data.scope.endMs", 1);
    if (endMs <= startMs) fail(context, "event.data.scope", "must be a non-empty range");
    contentId(data.sourceContentId, context, "event.data.sourceContentId");
    string(data.executionId, context, "event.data.executionId");
    string(data.launchClaimId, context, "event.data.launchClaimId");
    string(data.requestFingerprint, context, "event.data.requestFingerprint");
    validateFrameSamplingLimits(data.limits, context, "event.data.limits");
  } else if (type === "media.frames_sampling_completed") {
    exact(data, ["operationId", "manifestArtifactId", "receiptArtifactId", "frameArtifactIds", "receiptContentId", "receipt"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    string(data.manifestArtifactId, context, "event.data.manifestArtifactId");
    string(data.receiptArtifactId, context, "event.data.receiptArtifactId");
    const frameArtifactIds = uniqueStrings(data.frameArtifactIds, context, "event.data.frameArtifactIds");
    if (frameArtifactIds.length === 0) fail(context, "event.data.frameArtifactIds", "must name sampled frames");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateFrameSamplingReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "media.frames_sampling_failed") {
    exact(data, ["operationId", "reason"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    oneOf(data.reason, new Set(["source_drift", "video_track_unavailable", "frame_unavailable", "duplicate_actual_frame", "decoded_frame_oversized", "decoder_timeout", "decoder_failed"]), context, "event.data.reason");
  } else if (type === "media.frames_ocr_started") {
    exact(data, ["request", "scope", "sourceContentId", "executionId", "launchClaimId", "requestFingerprint", "limits"], context, "event.data");
    assertOcrRequest(data.request, context);
    const scope = object(data.scope, context, "event.data.scope");
    exact(scope, ["artifactId", "trackId", "startMs", "endMs"], context, "event.data.scope");
    string(scope.artifactId, context, "event.data.scope.artifactId");
    string(scope.trackId, context, "event.data.scope.trackId");
    const startMs = integer(scope.startMs, context, "event.data.scope.startMs");
    const endMs = integer(scope.endMs, context, "event.data.scope.endMs", 1);
    if (endMs <= startMs) fail(context, "event.data.scope", "must be a non-empty range");
    contentId(data.sourceContentId, context, "event.data.sourceContentId");
    string(data.executionId, context, "event.data.executionId");
    string(data.launchClaimId, context, "event.data.launchClaimId");
    string(data.requestFingerprint, context, "event.data.requestFingerprint");
    validateOcrLimits(data.limits, context, "event.data.limits");
  } else if (type === "media.frames_ocr_completed") {
    exact(data, ["operationId", "outputArtifactId", "receiptArtifactId", "receiptContentId", "receipt"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    string(data.receiptArtifactId, context, "event.data.receiptArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateOcrReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "media.frames_ocr_failed") {
    exact(data, ["operationId", "reason"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    oneOf(data.reason, new Set(["frame_lineage_unavailable", "input_oversized", "model_unavailable", "runtime_drift", "recognizer_timeout", "recognizer_failed", "artifact_oversized"]), context, "event.data.reason");
  } else if (type === "media.speakers_started") {
    exact(data, ["request", "scope", "sourceContentId", "executionId", "launchClaimId", "requestFingerprint", "limits"], context, "event.data");
    assertSpeakerOverlapRequest(data.request, context);
    const scope = object(data.scope, context, "event.data.scope");
    exact(scope, ["artifactId", "trackId", "startMs", "endMs"], context, "event.data.scope");
    string(scope.artifactId, context, "event.data.scope.artifactId");
    string(scope.trackId, context, "event.data.scope.trackId");
    const startMs = integer(scope.startMs, context, "event.data.scope.startMs");
    const endMs = integer(scope.endMs, context, "event.data.scope.endMs", 1);
    if (endMs <= startMs) fail(context, "event.data.scope", "must be a non-empty range");
    contentId(data.sourceContentId, context, "event.data.sourceContentId");
    string(data.executionId, context, "event.data.executionId");
    string(data.launchClaimId, context, "event.data.launchClaimId");
    string(data.requestFingerprint, context, "event.data.requestFingerprint");
    validateSpeakerOverlapLimits(data.limits, context, "event.data.limits");
  } else if (type === "media.speakers_completed") {
    exact(data, ["operationId", "outputArtifactId", "receiptArtifactId", "receiptContentId", "receipt"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    string(data.receiptArtifactId, context, "event.data.receiptArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateSpeakerOverlapReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "media.speakers_failed") {
    exact(data, ["operationId", "reason"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    oneOf(data.reason, new Set(["source_unavailable", "input_oversized", "model_unavailable", "runtime_drift", "decoder_failed", "diarizer_timeout", "diarizer_failed", "artifact_oversized"]), context, "event.data.reason");
  } else if (type === "media.conditional_separation_started") {
    exact(data, ["request", "scope", "sourceContentId", "executionId", "launchClaimId", "requestFingerprint", "trigger", "limits"], context, "event.data");
    assertConditionalSeparationRequest(data.request, context);
    const scope = object(data.scope, context, "event.data.scope");
    exact(scope, ["artifactId", "trackId", "startMs", "endMs"], context, "event.data.scope");
    string(scope.artifactId, context, "event.data.scope.artifactId");
    string(scope.trackId, context, "event.data.scope.trackId");
    const startMs = integer(scope.startMs, context, "event.data.scope.startMs");
    const endMs = integer(scope.endMs, context, "event.data.scope.endMs", 1);
    if (endMs <= startMs) fail(context, "event.data.scope", "must be a non-empty range");
    contentId(data.sourceContentId, context, "event.data.sourceContentId");
    string(data.executionId, context, "event.data.executionId");
    string(data.launchClaimId, context, "event.data.launchClaimId");
    string(data.requestFingerprint, context, "event.data.requestFingerprint");
    validateConditionalSeparationTrigger(data.trigger, context, "event.data.trigger");
    validateConditionalSeparationLimits(data.limits, context, "event.data.limits");
  } else if (type === "media.conditional_separation_completed") {
    exact(data, ["operationId", "stemArtifactIds", "receiptArtifactId", "receiptContentId", "receipt", "comparisonArtifactId", "comparisonReceiptArtifactId", "comparisonReceiptContentId", "comparisonReceipt"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    const stemIds = array(data.stemArtifactIds, context, "event.data.stemArtifactIds").map((entry, index) => string(entry, context, `event.data.stemArtifactIds[${index}]`));
    if (stemIds.length !== 2 || new Set(stemIds).size !== 2) fail(context, "event.data.stemArtifactIds", "must identify two unique stems");
    string(data.receiptArtifactId, context, "event.data.receiptArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateConditionalSeparationReceipt(data.receipt, context, "event.data.receipt");
    string(data.comparisonArtifactId, context, "event.data.comparisonArtifactId");
    string(data.comparisonReceiptArtifactId, context, "event.data.comparisonReceiptArtifactId");
    contentId(data.comparisonReceiptContentId, context, "event.data.comparisonReceiptContentId");
    validateRawStemComparisonReceipt(data.comparisonReceipt, context, "event.data.comparisonReceipt");
  } else if (type === "media.conditional_separation_failed") {
    exact(data, ["operationId", "reason"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    oneOf(data.reason, new Set(["source_unavailable", "input_oversized", "trigger_invalid", "model_unavailable", "runtime_drift", "decoder_failed", "separator_timeout", "separator_failed", "recognizer_failed", "artifact_oversized"]), context, "event.data.reason");
  } else if (type === "research.request_input_recorded") {
    exact(data, ["input"], context, "event.data");
    validateRestudiedResearchRequestInput(data.input, context, "event.data.input");
  } else if (type === "research.operation_started") {
    exact(data, ["request", "gap", "executionId", "launchClaimId", "requestFingerprint", "limits", "allowedDomains"], context, "event.data");
    assertResearchRequest(data.request, context);
    validateResearchGapBinding(data.gap, context, "event.data.gap");
    string(data.executionId, context, "event.data.executionId");
    string(data.launchClaimId, context, "event.data.launchClaimId");
    string(data.requestFingerprint, context, "event.data.requestFingerprint");
    validateResearchLimits(data.limits, context, "event.data.limits");
    validateResearchAllowedDomains(data.allowedDomains, context, "event.data.allowedDomains");
  } else if (type === "research.operation_completed") {
    exact(data, ["operationId", "op", "receiptArtifactId", "receiptContentId", "receipt", "documentArtifactId", "extractionArtifactId"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    const researchOp = oneOf<"search" | "document_snapshot">(data.op, new Set(["search", "document_snapshot"]), context, "event.data.op");
    string(data.receiptArtifactId, context, "event.data.receiptArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    if (researchOp === "search") {
      if (data.documentArtifactId !== null || data.extractionArtifactId !== null) {
        fail(context, "event.data", "search completions carry no document artifacts");
      }
      const receipt = validateResearchSearchReceipt(data.receipt, context);
      if (!("executionId" in receipt.authorization)) fail(context, "event.data.receipt.authorization", "journaled research receipts require executor lineage");
    } else {
      string(data.documentArtifactId, context, "event.data.documentArtifactId");
      string(data.extractionArtifactId, context, "event.data.extractionArtifactId");
      const receipt = validateResearchSnapshotReceipt(data.receipt, context);
      if (!("executionId" in receipt.authorization)) fail(context, "event.data.receipt.authorization", "journaled research receipts require executor lineage");
    }
  } else if (type === "research.operation_failed") {
    exact(data, ["operationId", "reason"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    oneOf(data.reason, new Set(["destination_not_allowed", "private_destination", "scheme_not_allowed", "credentials_in_url", "port_not_allowed", "url_too_long", "redirect_limit_exceeded", "mime_not_allowed", "byte_limit_exceeded", "wall_timeout", "fetch_failed", "provider_result_invalid", "artifact_oversized"]), context, "event.data.reason");
  } else if (type === "research.exhaustion_recorded") {
    exact(data, ["outputArtifactId", "receiptContentId", "receipt"], context, "event.data");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateResearchExhaustionReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "semantic.evidence_started") {
    exact(data, ["request", "grantId", "executionId", "launchClaimId", "sourceContentId", "producer", "limits"], context, "event.data");
    assertSpeechTranscribeRequest(data.request, context);
    string(data.grantId, context, "event.data.grantId");
    string(data.executionId, context, "event.data.executionId");
    string(data.launchClaimId, context, "event.data.launchClaimId");
    contentId(data.sourceContentId, context, "event.data.sourceContentId");
    validateCurrentRunRecognizerDescriptor(data.producer, context, "event.data.producer");
    validateSemanticEvidenceLimits(data.limits, context, "event.data.limits");
  } else if (type === "semantic.evidence_completed") {
    exact(data, ["operationId", "outputArtifactId", "outputContentId", "receiptContentId", "receipt"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    contentId(data.outputContentId, context, "event.data.outputContentId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateSemanticMediaEvidenceReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "semantic.evidence_failed") {
    exact(data, ["operationId", "reason"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    string(data.reason, context, "event.data.reason");
  } else if (type === "evidence.read_started") {
    exact(
      data,
      ["request", "grantId", "evidenceKind", "sourceArtifactId", "startMs", "endMs", "maxBytes", "maxItems"],
      context,
      "event.data",
    );
    assertEvidenceReadRequest(data.request, context);
    string(data.grantId, context, "event.data.grantId");
    oneOf(data.evidenceKind, new Set(["speech_activity", "language_ranges", "acoustic_ranges"]), context, "event.data.evidenceKind");
    string(data.sourceArtifactId, context, "event.data.sourceArtifactId");
    const startMs = integer(data.startMs, context, "event.data.startMs");
    const endMs = integer(data.endMs, context, "event.data.endMs", 1);
    if (endMs <= startMs) fail(context, "event.data", "must contain a non-empty evidence window");
    integer(data.maxBytes, context, "event.data.maxBytes", 1);
    integer(data.maxItems, context, "event.data.maxItems", 1);
  } else if (type === "evidence.read_completed") {
    exact(data, ["operationId", "receiptContentId", "receipt"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateEvidenceReadReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "evidence.read_failed") {
    exact(data, ["operationId", "reason"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    string(data.reason, context, "event.data.reason");
  } else if (type === "analysis.evidence.assessment_started") {
    exact(data, ["request", "grantId", "maxReadReceipts", "maxClaims", "maxCitations", "maxTokens"], context, "event.data");
    assertEvidenceAssessmentRequest(data.request, context);
    string(data.grantId, context, "event.data.grantId");
    integer(data.maxReadReceipts, context, "event.data.maxReadReceipts", 1);
    integer(data.maxClaims, context, "event.data.maxClaims", 1);
    integer(data.maxCitations, context, "event.data.maxCitations", 1);
    integer(data.maxTokens, context, "event.data.maxTokens", 1);
  } else if (type === "analysis.evidence.assessment_completed") {
    exact(data, ["operationId", "outputArtifactId", "receiptContentId", "receipt"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateEvidenceAssessmentReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "analysis.evidence.assessment_failed") {
    exact(data, ["operationId", "reason"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    string(data.reason, context, "event.data.reason");
  } else if (type === "analysis.evidence.decision_started") {
    exact(data, ["request", "grantId", "maxAuditedAssessments"], context, "event.data");
    assertEvidenceDecisionRequest(data.request, context);
    string(data.grantId, context, "event.data.grantId");
    integer(data.maxAuditedAssessments, context, "event.data.maxAuditedAssessments", 1);
  } else if (type === "analysis.evidence.decision_completed") {
    exact(data, ["operationId", "outputArtifactId", "receiptContentId", "receipt"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateEvidenceDecisionReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "analysis.evidence.decision_failed") {
    exact(data, ["operationId", "reason"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    string(data.reason, context, "event.data.reason");
  } else if (type === "publish.review.intake_started") {
    exact(data, ["intakeId", "readiness"], context, "event.data");
    string(data.intakeId, context, "event.data.intakeId");
    validateStudyReadinessReceiptIdentity(data.readiness, context, "event.data.readiness");
  } else if (type === "publish.review.intake_completed") {
    exact(data, ["intakeId", "outputArtifactId", "receiptContentId", "receipt"], context, "event.data");
    string(data.intakeId, context, "event.data.intakeId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validatePublishReviewIntakeReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "publish.review.intake_failed") {
    exact(data, ["intakeId", "reason"], context, "event.data");
    string(data.intakeId, context, "event.data.intakeId");
    string(data.reason, context, "event.data.reason");
  } else if (type === "publish.review.decision_started") {
    exact(data, ["reviewId", "request", "reviewerLabel"], context, "event.data");
    string(data.reviewId, context, "event.data.reviewId");
    assertPublishReviewDecisionRequest(data.request);
    string(data.reviewerLabel, context, "event.data.reviewerLabel");
  } else if (type === "publish.review.decision_completed") {
    exact(data, ["reviewId", "outputArtifactId", "receiptContentId", "receipt"], context, "event.data");
    string(data.reviewId, context, "event.data.reviewId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validatePublishReviewDecisionReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "publish.review.decision_failed") {
    exact(data, ["reviewId", "reason"], context, "event.data");
    string(data.reviewId, context, "event.data.reviewId");
    string(data.reason, context, "event.data.reason");
  } else if (type === "publish.review.revocation_started") {
    exact(data, ["revocationId", "request", "reviewerLabel"], context, "event.data");
    string(data.revocationId, context, "event.data.revocationId");
    assertPublishReviewRevocationRequest(data.request);
    string(data.reviewerLabel, context, "event.data.reviewerLabel");
  } else if (type === "publish.review.revocation_completed") {
    exact(data, ["revocationId", "outputArtifactId", "receiptContentId", "receipt"], context, "event.data");
    string(data.revocationId, context, "event.data.revocationId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validatePublishReviewRevocationReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "publish.review.revocation_failed") {
    exact(data, ["revocationId", "reason"], context, "event.data");
    string(data.revocationId, context, "event.data.revocationId");
    string(data.reason, context, "event.data.reason");
  } else if (type === "caption.production_started") {
    exact(data, ["jobId", "request", "input", "limits", "executor"], context, "event.data");
    string(data.jobId, context, "event.data.jobId");
    assertCaptionProductionRequest(data.request);
    validateCaptionProductionInput(data.input, context, "event.data.input");
    validateCaptionProductionLimits(data.limits, context, "event.data.limits");
    validateCaptionExecutorDescriptor(data.executor, context, "event.data.executor");
  } else if (type === "caption.production_completed") {
    exact(data, ["jobId", "captionArtifactId", "captionContentId", "receiptArtifactId", "receiptContentId", "receipt"], context, "event.data");
    string(data.jobId, context, "event.data.jobId");
    string(data.captionArtifactId, context, "event.data.captionArtifactId");
    contentId(data.captionContentId, context, "event.data.captionContentId");
    string(data.receiptArtifactId, context, "event.data.receiptArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateCaptionProductionReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "caption.production_failed") {
    exact(data, ["jobId", "reason"], context, "event.data");
    string(data.jobId, context, "event.data.jobId");
    string(data.reason, context, "event.data.reason");
  } else if (type === "caption.quality_control_decided") {
    exact(data, ["qcId", "outputArtifactId", "receiptContentId", "receipt"], context, "event.data");
    string(data.qcId, context, "event.data.qcId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateCaptionQualityControlReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "report.submitted") {
    exact(data, ["report"], context, "event.data");
    validateReportRecord(data.report, context, "event.data.report");
  } else if (type === "report.decided") {
    exact(
      data,
      ["reportId", "decidedByTaskId", "decidedByAgentId", "accepted", "reason"],
      context,
      "event.data",
    );
    string(data.reportId, context, "event.data.reportId");
    string(data.decidedByTaskId, context, "event.data.decidedByTaskId");
    string(data.decidedByAgentId, context, "event.data.decidedByAgentId");
    boolean(data.accepted, context, "event.data.accepted");
    string(data.reason, context, "event.data.reason");
  } else if (type === "root.output_disposition_recorded") {
    exact(
      data,
      ["dispositionId", "outputArtifactId", "receiptContentId", "receipt"],
      context,
      "event.data",
    );
    string(data.dispositionId, context, "event.data.dispositionId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateRootOutputDispositionReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "parent.artifact_disposition_recorded") {
    exact(data, ["dispositionArtifactId", "dispositionReceiptContentId", "dispositionReceipt", "admissionArtifactId", "admissionReceiptContentId", "admissionReceipt"], context, "event.data");
    string(data.dispositionArtifactId, context, "event.data.dispositionArtifactId");
    contentId(data.dispositionReceiptContentId, context, "event.data.dispositionReceiptContentId");
    validateParentArtifactDispositionReceipt(data.dispositionReceipt, context, "event.data.dispositionReceipt");
    nullableString(data.admissionArtifactId, context, "event.data.admissionArtifactId");
    if (data.admissionReceiptContentId !== null) contentId(data.admissionReceiptContentId, context, "event.data.admissionReceiptContentId");
    if (data.admissionReceipt !== null) validateParentAdmissionReceipt(data.admissionReceipt, context, "event.data.admissionReceipt");
    if ((data.admissionArtifactId === null) !== (data.admissionReceiptContentId === null) ||
        (data.admissionArtifactId === null) !== (data.admissionReceipt === null)) {
      fail(context, "event.data", "must carry admission artifact, bytes, and receipt together");
    }
  } else if (type === "parent.artifact_read_started") {
    exact(data, ["request"], context, "event.data");
    assertParentArtifactReadRequest(data.request);
  } else if (type === "parent.artifact_read_completed") {
    exact(data, ["operationId", "receipt"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    validateParentArtifactReadReceipt(data.receipt, context, "event.data.receipt");
  } else if (type === "parent.artifact_read_failed") {
    exact(data, ["operationId", "reason"], context, "event.data");
    string(data.operationId, context, "event.data.operationId");
    string(data.reason, context, "event.data.reason");
  } else if (type === "study.planning_decision_recorded") {
    exact(data, ["outputArtifactId", "receiptContentId", "receipt"], context, "event.data");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateStudyPlanningDecisionReceipt(data.receipt);
  } else if (type === "study.follow_up_linked") {
    exact(data, ["followUp"], context, "event.data");
    const followUp = object(data.followUp, context, "event.data.followUp");
    exact(followUp, ["id", "planningDecisionId", "cause", "spawnRequestId", "accepted", "rejection", "taskId", "agentId"], context, "event.data.followUp");
    string(followUp.id, context, "event.data.followUp.id");
    string(followUp.planningDecisionId, context, "event.data.followUp.planningDecisionId");
    const cause = object(followUp.cause, context, "event.data.followUp.cause");
    exact(cause, ["kind", "id"], context, "event.data.followUp.cause");
    oneOf(cause.kind, new Set(["gap", "conflict"]), context, "event.data.followUp.cause.kind");
    string(cause.id, context, "event.data.followUp.cause.id");
    string(followUp.spawnRequestId, context, "event.data.followUp.spawnRequestId");
    boolean(followUp.accepted, context, "event.data.followUp.accepted");
    if (followUp.rejection !== null) oneOf(followUp.rejection, REJECTIONS, context, "event.data.followUp.rejection");
    nullableString(followUp.taskId, context, "event.data.followUp.taskId");
    nullableString(followUp.agentId, context, "event.data.followUp.agentId");
  } else if (type === "study.synthesis_completed") {
    exact(data, ["studyId", "outputArtifactId", "outputContentId", "executorReceiptContentId", "executorReceipt", "projection"], context, "event.data");
    string(data.studyId, context, "event.data.studyId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    contentId(data.outputContentId, context, "event.data.outputContentId");
    contentId(data.executorReceiptContentId, context, "event.data.executorReceiptContentId");
    validateOwnedMediaStudyExecutorReceipt(data.executorReceipt);
    validateOwnedMediaStudyProjection(data.projection);
  } else if (type === "study.readiness_audited") {
    exact(data, ["studyId", "outputArtifactId", "receiptContentId", "receipt"], context, "event.data");
    string(data.studyId, context, "event.data.studyId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateStudyReadinessReceipt(data.receipt);
  } else if (type === "parent.generalized_admission_recorded") {
    exact(data, ["reportId", "outputArtifactId", "admissionArtifactId", "receiptContentId", "receipt"], context, "event.data");
    string(data.reportId, context, "event.data.reportId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    string(data.admissionArtifactId, context, "event.data.admissionArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateParentArtifactAdmissionReceiptV2(data.receipt);
  } else if (type === "parent.generalized_artifact_read_completed") {
    exact(data, ["parentTaskId", "parentAgentId", "receiptArtifactId", "receiptContentId", "receipt"], context, "event.data");
    string(data.parentTaskId, context, "event.data.parentTaskId");
    string(data.parentAgentId, context, "event.data.parentAgentId");
    string(data.receiptArtifactId, context, "event.data.receiptArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateParentArtifactReadReceiptV2(data.receipt);
  } else if (type === "study.generalized_synthesis_completed") {
    exact(data, ["studyId", "outputArtifactId", "outputContentId", "executorReceiptContentId", "executorReceipt", "projection"], context, "event.data");
    string(data.studyId, context, "event.data.studyId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    contentId(data.outputContentId, context, "event.data.outputContentId");
    contentId(data.executorReceiptContentId, context, "event.data.executorReceiptContentId");
    validateOwnedMediaStudyExecutorReceiptV2(data.executorReceipt);
    const projection = object(data.projection, context, "event.data.projection");
    exact(projection, ["reports", "coverage", "claims", "evidenceCitations"], context, "event.data.projection");
    array(projection.reports, context, "event.data.projection.reports");
    array(projection.coverage, context, "event.data.projection.coverage");
    array(projection.claims, context, "event.data.projection.claims");
    array(projection.evidenceCitations, context, "event.data.projection.evidenceCitations");
  } else if (type === "study.generalized_readiness_audited") {
    exact(data, ["studyId", "outputArtifactId", "receiptContentId", "receipt", "study"], context, "event.data");
    string(data.studyId, context, "event.data.studyId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateStudyReadinessReceiptV3(data.receipt);
    const study = object(data.study, context, "event.data.study");
    exact(study, ["study", "executorReceiptId", "executorReceiptContentId"], context, "event.data.study");
    string(study.executorReceiptId, context, "event.data.study.executorReceiptId");
    contentId(study.executorReceiptContentId, context, "event.data.study.executorReceiptContentId");
  } else if (type === "study.restudy_pass_requested") {
    exact(data, ["receiptContentId", "receipt"], context, "event.data");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateRangePassRequestReceipt(data.receipt);
  } else if (type === "study.restudy_pass_decided") {
    exact(data, ["passId", "spawnRequestId", "accepted", "rejection", "taskId", "agentId"], context, "event.data");
    string(data.passId, context, "event.data.passId");
    string(data.spawnRequestId, context, "event.data.spawnRequestId");
    const accepted = boolean(data.accepted, context, "event.data.accepted");
    const rejection = data.rejection === null ? null : oneOf(data.rejection, REJECTIONS, context, "event.data.rejection");
    const taskId = nullableString(data.taskId, context, "event.data.taskId");
    const agentId = nullableString(data.agentId, context, "event.data.agentId");
    if (accepted !== (rejection === null && taskId !== null && agentId !== null)) fail(context, "event.data", "has an inconsistent range-pass decision");
  } else if (type === "study.restudy_pass_terminal_recorded") {
    exact(data, ["receiptContentId", "receipt"], context, "event.data");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateRangePassTerminalReceipt(data.receipt);
  } else if (type === "study.restudied_synthesis_completed") {
    exact(data, ["studyId", "outputArtifactId", "outputContentId", "executorReceiptContentId", "executorReceipt", "projection"], context, "event.data");
    string(data.studyId, context, "event.data.studyId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    contentId(data.outputContentId, context, "event.data.outputContentId");
    contentId(data.executorReceiptContentId, context, "event.data.executorReceiptContentId");
    validateOwnedMediaStudyExecutorReceiptV3(data.executorReceipt);
    const projection = object(data.projection, context, "event.data.projection");
    exact(projection, ["reports", "passes", "coverage", "claims", "evidenceCitations"], context, "event.data.projection");
    array(projection.reports, context, "event.data.projection.reports");
    array(projection.passes, context, "event.data.projection.passes");
    array(projection.coverage, context, "event.data.projection.coverage");
    array(projection.claims, context, "event.data.projection.claims");
    array(projection.evidenceCitations, context, "event.data.projection.evidenceCitations");
  } else if (type === "study.restudied_readiness_audited") {
    exact(data, ["studyId", "outputArtifactId", "receiptContentId", "receipt", "study"], context, "event.data");
    string(data.studyId, context, "event.data.studyId");
    string(data.outputArtifactId, context, "event.data.outputArtifactId");
    contentId(data.receiptContentId, context, "event.data.receiptContentId");
    validateStudyReadinessReceiptV4(data.receipt);
    const study = object(data.study, context, "event.data.study");
    exact(study, ["study", "executorReceiptId", "executorReceiptContentId"], context, "event.data.study");
    string(study.executorReceiptId, context, "event.data.study.executorReceiptId");
    contentId(study.executorReceiptContentId, context, "event.data.study.executorReceiptContentId");
  } else {
    fail(context, "event.type", `has unknown value ${type}`);
  }
}
