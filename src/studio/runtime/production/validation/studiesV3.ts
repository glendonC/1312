import { canonicalSha256 } from "../canonicalIdentity.ts";
import type {
  EvidenceCitationEnvelope,
  AdmittedStudyReportV2,
  GeneralizedCoverageState,
  OwnedMediaStudyArtifactV3,
  OwnedMediaStudyClaimV2,
  OwnedMediaStudyCoverageRangeV3,
  OwnedMediaStudyExecutorReceiptV3,
  OwnedMediaStudyV3Identity,
  QualifiedMediaRange,
  RangePassRecord,
  RangePassRequestReceipt,
  RangePassTerminalReceipt,
  StudyRestudyDelta,
  StudyRestudyCause,
  StudyRestudyRequest,
  StudyReadinessReceiptV4,
} from "../model.ts";
import {
  OWNED_MEDIA_STUDY_V3_LIMITS,
  PADDED_AUDIO_WINDOW_LIMITS,
  RANGE_PASS_LIMITS,
  REGISTERED_SPEECH_RANGE_PASS_PRODUCERS,
  SEMANTIC_EVIDENCE_LIMITS,
} from "../model.ts";
import { validateEvidenceCitationEnvelope, validateSupportedClaimCitationClosure } from "./evidenceCitations.ts";
import { validateGeneralizedCoveragePartition } from "./studyReportsV2.ts";
import {
  array,
  boolean,
  contentId,
  exact,
  fail,
  integer,
  literal,
  nullableString,
  object,
  oneOf,
  string,
  uniqueStrings,
} from "./primitives.ts";

const COVERAGE_STATES = new Set<GeneralizedCoverageState>([
  "supported", "unknown", "withheld", "unavailable", "truncated", "conflicting", "failed", "not_in_scope",
]);
const WEAK_STATES = new Set<Exclude<GeneralizedCoverageState, "supported" | "not_in_scope">>([
  "unknown", "withheld", "unavailable", "truncated", "conflicting", "failed",
]);
const CAUSES = new Set([
  "unobserved_range", "unknown_evidence", "withheld_evidence", "unavailable_evidence", "truncated_evidence", "speaker_overlap", "recognizer_disagreement", "failed_range",
]);
const REASON_CODES = new Set([
  "evidence_unknown", "worker_withheld", "evidence_unavailable", "evidence_truncated", "evidence_conflicting",
  "operation_failed", "not_in_requested_scope",
]);
const REJECTIONS = new Set([
  "requester_not_authorized", "max_depth", "max_active_workers", "run_budget", "duplicate_owner",
  "missing_output_contract", "dependency_unavailable", "scope_violation", "capability_not_grantable",
  "restudy_duplicate_work", "restudy_range_pass_cap", "restudy_producer_pass_cap",
]);

function range(value: unknown, context: string, path: string): QualifiedMediaRange {
  const item = object(value, context, path);
  exact(item, ["artifactId", "trackId", "startMs", "endMs"], context, path);
  const result = {
    artifactId: string(item.artifactId, context, `${path}.artifactId`),
    trackId: string(item.trackId, context, `${path}.trackId`),
    startMs: integer(item.startMs, context, `${path}.startMs`),
    endMs: integer(item.endMs, context, `${path}.endMs`, 1),
  };
  if (result.endMs <= result.startMs) fail(context, path, "must be a non-empty half-open range");
  return result;
}

function sameRange(left: QualifiedMediaRange, right: QualifiedMediaRange): boolean {
  return left.artifactId === right.artifactId && left.trackId === right.trackId &&
    left.startMs === right.startMs && left.endMs === right.endMs;
}

function budget(value: unknown, context: string, path: string) {
  const item = object(value, context, path); exact(item, ["wallMs", "toolCalls"], context, path);
  const result = { wallMs: integer(item.wallMs, context, `${path}.wallMs`, 1), toolCalls: integer(item.toolCalls, context, `${path}.toolCalls`, 1) };
  if (result.wallMs !== RANGE_PASS_LIMITS.maxWallMsPerPass || result.toolCalls !== RANGE_PASS_LIMITS.maxToolCallsPerPass) fail(context, path, "must equal the registered speech range-pass reservation");
  return result;
}

function delta(value: unknown, context: string, path: string): StudyRestudyDelta {
  const item = object(value, context, path);
  const kind = oneOf<StudyRestudyDelta["kind"]>(item.kind, new Set(["attenuated_subrange", "padded_audio_window", "denser_frame_timestamps", "alternate_receipted_config", "granted_specialist"]), context, `${path}.kind`);
  if (kind === "attenuated_subrange") {
    exact(item, ["kind", "executionRange"], context, path);
    return { kind, executionRange: range(item.executionRange, context, `${path}.executionRange`) };
  }
  if (kind === "padded_audio_window") {
    exact(item, ["kind", "executionRange", "paddingBeforeMs", "paddingAfterMs"], context, path);
    const paddingBeforeMs = integer(item.paddingBeforeMs, context, `${path}.paddingBeforeMs`);
    const paddingAfterMs = integer(item.paddingAfterMs, context, `${path}.paddingAfterMs`);
    if (paddingBeforeMs > PADDED_AUDIO_WINDOW_LIMITS.maxPaddingBeforeMs) fail(context, `${path}.paddingBeforeMs`, `must be at most ${PADDED_AUDIO_WINDOW_LIMITS.maxPaddingBeforeMs}`);
    if (paddingAfterMs > PADDED_AUDIO_WINDOW_LIMITS.maxPaddingAfterMs) fail(context, `${path}.paddingAfterMs`, `must be at most ${PADDED_AUDIO_WINDOW_LIMITS.maxPaddingAfterMs}`);
    if (paddingBeforeMs + paddingAfterMs === 0) fail(context, path, "must add bounded context on at least one side");
    return { kind, executionRange: range(item.executionRange, context, `${path}.executionRange`), paddingBeforeMs, paddingAfterMs };
  }
  if (kind === "denser_frame_timestamps") {
    exact(item, ["kind", "executionRange", "timestampsMs"], context, path);
    return { kind, executionRange: range(item.executionRange, context, `${path}.executionRange`), timestampsMs: array(item.timestampsMs, context, `${path}.timestampsMs`).map((entry, index) => integer(entry, context, `${path}.timestampsMs[${index}]`)) };
  }
  if (kind === "alternate_receipted_config") {
    exact(item, ["kind", "executionRange", "configurationContentId"], context, path);
    return { kind, executionRange: range(item.executionRange, context, `${path}.executionRange`), configurationContentId: contentId(item.configurationContentId, context, `${path}.configurationContentId`) };
  }
  exact(item, ["kind", "executionRange", "specialistKind"], context, path);
  return { kind, executionRange: range(item.executionRange, context, `${path}.executionRange`), specialistKind: oneOf<"acoustic" | "visual" | "speaker" | "context">(item.specialistKind, new Set(["acoustic", "visual", "speaker", "context"]), context, `${path}.specialistKind`) };
}

export function validateStudyRestudyRequest(value: unknown): StudyRestudyRequest {
  const context = "Study re-study request"; const item = object(value, context, "request");
  exact(item, ["inputId", "coverageId", "causeId", "delta"], context, "request");
  return {
    inputId: string(item.inputId, context, "request.inputId"),
    coverageId: string(item.coverageId, context, "request.coverageId"),
    causeId: string(item.causeId, context, "request.causeId"),
    delta: delta(item.delta, context, "request.delta"),
  };
}

function cause(value: unknown, context: string, path: string): StudyRestudyCause {
  const item = object(value, context, path);
  exact(item, ["causeId", "kind", "coverageId", "range", "priorState", "reportArtifactIds", "citationIds", "observationIds", "rawStates"], context, path);
  const result: StudyRestudyCause = {
    causeId: string(item.causeId, context, `${path}.causeId`),
    kind: oneOf<StudyRestudyCause["kind"]>(item.kind, CAUSES, context, `${path}.kind`),
    coverageId: string(item.coverageId, context, `${path}.coverageId`),
    range: range(item.range, context, `${path}.range`),
    priorState: oneOf<StudyRestudyCause["priorState"]>(item.priorState, WEAK_STATES, context, `${path}.priorState`),
    reportArtifactIds: uniqueStrings(item.reportArtifactIds, context, `${path}.reportArtifactIds`),
    citationIds: uniqueStrings(item.citationIds, context, `${path}.citationIds`),
    observationIds: uniqueStrings(item.observationIds, context, `${path}.observationIds`),
    rawStates: uniqueStrings(item.rawStates, context, `${path}.rawStates`),
  };
  if (result.kind === "speaker_overlap" && (
    result.priorState !== "conflicting" || result.reportArtifactIds.length === 0 ||
    result.citationIds.length === 0 || result.observationIds.length === 0 ||
    result.rawStates.length !== result.observationIds.length ||
    result.observationIds.some((observationId) => !result.rawStates.includes(
      `${observationId}:conflicting:speaker:overlap:overlap_hypothesis_requires_speech_restudy`))
  )) fail(context, path, "speaker_overlap must bind exact conflicting U6 overlap observations");
  return result;
}

export function validateRangePassRequestReceipt(value: unknown): RangePassRequestReceipt {
  const context = "Range-pass request receipt"; const item = object(value, context, "receipt");
  exact(item, ["schema", "receiptId", "passId", "runId", "root", "inputId", "coverageId", "weakRange", "priorState", "priorEvidence", "cause", "delta", "passNumber", "producer", "workFingerprint", "reservedSpend", "limits", "nonClaims"], context, "receipt");
  literal(item.schema, "studio.study-range-pass-request.receipt.v1", context, "receipt.schema");
  const root = object(item.root, context, "receipt.root"); exact(root, ["taskId", "agentId", "executionId"], context, "receipt.root");
  const prior = object(item.priorEvidence, context, "receipt.priorEvidence"); exact(prior, ["reportArtifactIds", "admissionIds", "citationIds", "speechOperationIds", "speechExecutionRanges"], context, "receipt.priorEvidence");
  const parsedCause = cause(item.cause, context, "receipt.cause");
  const parsedDelta = delta(item.delta, context, "receipt.delta");
  if (parsedDelta.kind !== "attenuated_subrange" && parsedDelta.kind !== "padded_audio_window") fail(context, "receipt.delta.kind", "is not registered in this runtime slice");
  const weakRange = range(item.weakRange, context, "receipt.weakRange");
  const executionInsideWeak = parsedDelta.executionRange.artifactId === weakRange.artifactId &&
    parsedDelta.executionRange.trackId === weakRange.trackId && parsedDelta.executionRange.startMs >= weakRange.startMs &&
    parsedDelta.executionRange.endMs <= weakRange.endMs;
  if (parsedDelta.kind === "attenuated_subrange") {
    const validSpeakerOverlap = parsedCause.kind === "speaker_overlap" && executionInsideWeak &&
      sameRange(parsedDelta.executionRange, parsedCause.range);
    const validExistingCause = parsedCause.kind !== "speaker_overlap" && sameRange(weakRange, parsedCause.range) &&
      executionInsideWeak && !sameRange(parsedDelta.executionRange, weakRange);
    if (!validSpeakerOverlap && !validExistingCause) {
      fail(context, "receipt", "must bind the exact host-derived speaker overlap range or one strict weak-range subrange");
    }
  } else {
    const sameMedia = parsedDelta.executionRange.artifactId === weakRange.artifactId &&
      parsedDelta.executionRange.trackId === weakRange.trackId;
    const exactPadding = parsedDelta.executionRange.startMs === weakRange.startMs - parsedDelta.paddingBeforeMs &&
      parsedDelta.executionRange.endMs === weakRange.endMs + parsedDelta.paddingAfterMs;
    const durationMs = parsedDelta.executionRange.endMs - parsedDelta.executionRange.startMs;
    if (parsedCause.kind === "speaker_overlap" || !sameRange(weakRange, parsedCause.range) || !sameMedia ||
        !exactPadding || parsedDelta.executionRange.startMs < 0 || durationMs > SEMANTIC_EVIDENCE_LIMITS.maxDurationMs) {
      fail(context, "receipt", "padded audio must bind one exact non-speaker weak range and its registered bounded execution window");
    }
  }
  const producer = object(item.producer, context, "receipt.producer"); exact(producer, ["kind", "capability", "configurationScope"], context, "receipt.producer");
  const registeredProducer = REGISTERED_SPEECH_RANGE_PASS_PRODUCERS[parsedDelta.kind];
  literal(producer.kind, registeredProducer.kind, context, "receipt.producer.kind");
  literal(producer.capability, registeredProducer.capability, context, "receipt.producer.capability");
  literal(producer.configurationScope, registeredProducer.configurationScope, context, "receipt.producer.configurationScope");
  const limits = object(item.limits, context, "receipt.limits"); exact(limits, Object.keys(RANGE_PASS_LIMITS), context, "receipt.limits"); for (const [key, expected] of Object.entries(RANGE_PASS_LIMITS)) if (limits[key] !== expected) fail(context, `receipt.limits.${key}`, `must equal ${expected}`);
  const nonClaims = object(item.nonClaims, context, "receipt.nonClaims"); exact(nonClaims, ["understanding", "improvement", "semanticCorrectness"], context, "receipt.nonClaims"); literal(nonClaims.understanding, "not_claimed", context, "receipt.nonClaims.understanding"); literal(nonClaims.improvement, "not_claimed", context, "receipt.nonClaims.improvement"); literal(nonClaims.semanticCorrectness, "not_assessed", context, "receipt.nonClaims.semanticCorrectness");
  const receipt: RangePassRequestReceipt = {
    schema: "studio.study-range-pass-request.receipt.v1" as const,
    receiptId: string(item.receiptId, context, "receipt.receiptId"), passId: string(item.passId, context, "receipt.passId"), runId: string(item.runId, context, "receipt.runId"),
    root: { taskId: string(root.taskId, context, "receipt.root.taskId"), agentId: string(root.agentId, context, "receipt.root.agentId"), executionId: string(root.executionId, context, "receipt.root.executionId") },
    inputId: string(item.inputId, context, "receipt.inputId"), coverageId: string(item.coverageId, context, "receipt.coverageId"), weakRange,
    priorState: oneOf<RangePassRequestReceipt["priorState"]>(item.priorState, WEAK_STATES, context, "receipt.priorState"),
    priorEvidence: { reportArtifactIds: uniqueStrings(prior.reportArtifactIds, context, "receipt.priorEvidence.reportArtifactIds"), admissionIds: uniqueStrings(prior.admissionIds, context, "receipt.priorEvidence.admissionIds"), citationIds: uniqueStrings(prior.citationIds, context, "receipt.priorEvidence.citationIds"), speechOperationIds: uniqueStrings(prior.speechOperationIds, context, "receipt.priorEvidence.speechOperationIds"), speechExecutionRanges: array(prior.speechExecutionRanges, context, "receipt.priorEvidence.speechExecutionRanges").map((entry, index) => range(entry, context, `receipt.priorEvidence.speechExecutionRanges[${index}]`)) },
    cause: parsedCause, delta: parsedDelta, passNumber: integer(item.passNumber, context, "receipt.passNumber", 2),
    producer: structuredClone(registeredProducer),
    workFingerprint: string(item.workFingerprint, context, "receipt.workFingerprint"), reservedSpend: budget(item.reservedSpend, context, "receipt.reservedSpend"), limits: RANGE_PASS_LIMITS,
    nonClaims: { understanding: "not_claimed" as const, improvement: "not_claimed" as const, semanticCorrectness: "not_assessed" as const },
  };
  if (receipt.coverageId !== receipt.cause.coverageId || receipt.priorState !== receipt.cause.priorState || receipt.passNumber !== 2) fail(context, "receipt", "changed its exact weak-range cause or single next-pass number");
  if (receipt.delta.kind === "padded_audio_window" && !receipt.priorEvidence.speechExecutionRanges.some((speechRange) => sameRange(speechRange, receipt.weakRange))) {
    fail(context, "receipt.priorEvidence.speechExecutionRanges", "must bind exact prior current-run speech over the weak range before padding");
  }
  const body = structuredClone(receipt) as unknown as Record<string, unknown>; delete body.schema; delete body.receiptId;
  if (receipt.receiptId !== `study-range-pass-request-receipt:${canonicalSha256(body)}`) fail(context, "receipt.receiptId", "does not close the request receipt");
  return receipt;
}

export function validateRangePassTerminalReceipt(value: unknown): RangePassTerminalReceipt {
  const context = "Range-pass terminal receipt"; const item = object(value, context, "receipt");
  exact(item, ["schema", "receiptId", "passId", "runId", "requestReceiptId", "requestReceiptContentId", "scheduler", "evidence", "measuredSpend", "outcome", "exhausted", "nonClaims"], context, "receipt");
  literal(item.schema, "studio.study-range-pass-terminal.receipt.v1", context, "receipt.schema");
  const scheduler = object(item.scheduler, context, "receipt.scheduler"); exact(scheduler, ["spawnRequestId", "taskId", "agentId"], context, "receipt.scheduler");
  const evidence = object(item.evidence, context, "receipt.evidence"); exact(evidence, ["reportId", "reportArtifactId", "reportContentId", "admissionId", "readOperationId", "citationIds", "newCitationIds", "disagreementCitationIds"], context, "receipt.evidence");
  const measured = object(item.measuredSpend, context, "receipt.measuredSpend"); exact(measured, ["executorActiveMs", "capabilityCalls", "modelUsage"], context, "receipt.measuredSpend");
  const modelUsage = object(measured.modelUsage, context, "receipt.measuredSpend.modelUsage"); const usageState = oneOf(modelUsage.state, new Set(["available", "unavailable"]), context, "receipt.measuredSpend.modelUsage.state");
  const parsedUsage = usageState === "available" ? (() => { exact(modelUsage, ["state", "receiptId", "measured"], context, "receipt.measuredSpend.modelUsage"); const tokens = object(modelUsage.measured, context, "receipt.measuredSpend.modelUsage.measured"); exact(tokens, ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens"], context, "receipt.measuredSpend.modelUsage.measured"); return { state: "available" as const, receiptId: string(modelUsage.receiptId, context, "receipt.measuredSpend.modelUsage.receiptId"), measured: { inputTokens: integer(tokens.inputTokens, context, "receipt.measuredSpend.modelUsage.measured.inputTokens"), cachedInputTokens: integer(tokens.cachedInputTokens, context, "receipt.measuredSpend.modelUsage.measured.cachedInputTokens"), outputTokens: integer(tokens.outputTokens, context, "receipt.measuredSpend.modelUsage.measured.outputTokens"), reasoningOutputTokens: integer(tokens.reasoningOutputTokens, context, "receipt.measuredSpend.modelUsage.measured.reasoningOutputTokens") } }; })() : (() => { exact(modelUsage, ["state", "reason"], context, "receipt.measuredSpend.modelUsage"); return { state: "unavailable" as const, reason: oneOf<"deterministic_executor" | "executor_failed_before_usage">(modelUsage.reason, new Set(["deterministic_executor", "executor_failed_before_usage"]), context, "receipt.measuredSpend.modelUsage.reason") }; })();
  const nonClaims = object(item.nonClaims, context, "receipt.nonClaims"); exact(nonClaims, ["understanding", "improvement", "semanticCorrectness"], context, "receipt.nonClaims"); literal(nonClaims.understanding, "not_claimed", context, "receipt.nonClaims.understanding"); literal(nonClaims.improvement, "not_claimed", context, "receipt.nonClaims.improvement"); literal(nonClaims.semanticCorrectness, "not_assessed", context, "receipt.nonClaims.semanticCorrectness");
  const exhausted = boolean(item.exhausted, context, "receipt.exhausted");
  const terminal: RangePassTerminalReceipt = {
    schema: "studio.study-range-pass-terminal.receipt.v1", receiptId: string(item.receiptId, context, "receipt.receiptId"), passId: string(item.passId, context, "receipt.passId"), runId: string(item.runId, context, "receipt.runId"), requestReceiptId: string(item.requestReceiptId, context, "receipt.requestReceiptId"), requestReceiptContentId: contentId(item.requestReceiptContentId, context, "receipt.requestReceiptContentId"),
    scheduler: { spawnRequestId: string(scheduler.spawnRequestId, context, "receipt.scheduler.spawnRequestId"), taskId: string(scheduler.taskId, context, "receipt.scheduler.taskId"), agentId: string(scheduler.agentId, context, "receipt.scheduler.agentId") },
    evidence: { reportId: nullableString(evidence.reportId, context, "receipt.evidence.reportId"), reportArtifactId: nullableString(evidence.reportArtifactId, context, "receipt.evidence.reportArtifactId"), reportContentId: evidence.reportContentId === null ? null : contentId(evidence.reportContentId, context, "receipt.evidence.reportContentId"), admissionId: nullableString(evidence.admissionId, context, "receipt.evidence.admissionId"), readOperationId: nullableString(evidence.readOperationId, context, "receipt.evidence.readOperationId"), citationIds: uniqueStrings(evidence.citationIds, context, "receipt.evidence.citationIds"), newCitationIds: uniqueStrings(evidence.newCitationIds, context, "receipt.evidence.newCitationIds"), disagreementCitationIds: uniqueStrings(evidence.disagreementCitationIds, context, "receipt.evidence.disagreementCitationIds") },
    measuredSpend: { executorActiveMs: measured.executorActiveMs === null ? null : integer(measured.executorActiveMs, context, "receipt.measuredSpend.executorActiveMs"), capabilityCalls: integer(measured.capabilityCalls, context, "receipt.measuredSpend.capabilityCalls"), modelUsage: parsedUsage },
    outcome: oneOf<RangePassTerminalReceipt["outcome"]>(item.outcome, new Set(["supported_new_citations", "unknown_exhausted", "withheld_exhausted", "unavailable_exhausted"]), context, "receipt.outcome"), exhausted,
    nonClaims: { understanding: "not_claimed", improvement: "not_claimed", semanticCorrectness: "not_assessed" },
  };
  if (terminal.outcome === "supported_new_citations" && (terminal.evidence.newCitationIds.length === 0 || terminal.exhausted)) fail(context, "receipt", "supported terminal outcome requires new citations and cannot be exhausted");
  if (terminal.outcome !== "supported_new_citations" && !terminal.exhausted) fail(context, "receipt.exhausted", "must be true for terminal weak outcomes");
  const evidenceIdentityCount = [terminal.evidence.reportId, terminal.evidence.reportArtifactId, terminal.evidence.reportContentId, terminal.evidence.admissionId, terminal.evidence.readOperationId].filter((entry) => entry !== null).length;
  if (evidenceIdentityCount !== 0 && evidenceIdentityCount !== 5) fail(context, "receipt.evidence", "must retain either the complete admitted/read report identity or no report identity");
  if (terminal.evidence.newCitationIds.some((id) => !terminal.evidence.citationIds.includes(id)) ||
      terminal.evidence.disagreementCitationIds.some((id) => !terminal.evidence.citationIds.includes(id) && terminal.outcome === "supported_new_citations")) {
    fail(context, "receipt.evidence", "contains a citation outside its closed evidence sets");
  }
  const body = structuredClone(terminal) as unknown as Record<string, unknown>; delete body.schema; delete body.receiptId;
  if (terminal.receiptId !== `study-range-pass-terminal-receipt:${canonicalSha256(body)}`) fail(context, "receipt.receiptId", "does not close the terminal receipt");
  return terminal;
}

function passRecord(value: unknown, context: string, path: string): RangePassRecord {
  const item = object(value, context, path); exact(item, ["id", "requestReceiptId", "requestReceiptContentId", "request", "spawnRequestId", "accepted", "rejection", "taskId", "agentId", "terminalReceiptId", "terminalReceiptContentId", "terminal"], context, path);
  const request = validateRangePassRequestReceipt(item.request); const accepted = item.accepted === true;
  const rejection = item.rejection === null ? null : oneOf<NonNullable<RangePassRecord["rejection"]>>(item.rejection, REJECTIONS, context, `${path}.rejection`);
  const terminal = item.terminal === null ? null : validateRangePassTerminalReceipt(item.terminal);
  const result: RangePassRecord = { id: string(item.id, context, `${path}.id`), requestReceiptId: string(item.requestReceiptId, context, `${path}.requestReceiptId`), requestReceiptContentId: contentId(item.requestReceiptContentId, context, `${path}.requestReceiptContentId`), request, spawnRequestId: string(item.spawnRequestId, context, `${path}.spawnRequestId`), accepted, rejection, taskId: nullableString(item.taskId, context, `${path}.taskId`), agentId: nullableString(item.agentId, context, `${path}.agentId`), terminalReceiptId: nullableString(item.terminalReceiptId, context, `${path}.terminalReceiptId`), terminalReceiptContentId: item.terminalReceiptContentId === null ? null : contentId(item.terminalReceiptContentId, context, `${path}.terminalReceiptContentId`), terminal };
  if (result.id !== request.passId || result.requestReceiptId !== request.receiptId || (accepted !== (rejection === null && result.taskId !== null && result.agentId !== null)) || (terminal !== null && (terminal.passId !== result.id || terminal.receiptId !== result.terminalReceiptId))) fail(context, path, "changed its request, scheduler, or terminal identity");
  return result;
}

function studyCoverage(value: unknown, context: string, path: string): OwnedMediaStudyCoverageRangeV3 {
  const item = object(value, context, path); exact(item, ["coverageId", "artifactId", "trackId", "startMs", "endMs", "state", "preservedStates", "rawStates", "claimIds", "citationIds", "reason", "passIds"], context, path);
  const state = oneOf<GeneralizedCoverageState>(item.state, COVERAGE_STATES, context, `${path}.state`);
  const preservedStates = uniqueStrings(item.preservedStates, context, `${path}.preservedStates`).map((entry) => oneOf<GeneralizedCoverageState>(entry, COVERAGE_STATES, context, `${path}.preservedStates`));
  const claimIds = uniqueStrings(item.claimIds, context, `${path}.claimIds`); const reasonValue = item.reason;
  let reason: OwnedMediaStudyCoverageRangeV3["reason"] = null;
  if (reasonValue !== null) {
    const found = object(reasonValue, context, `${path}.reason`);
    exact(found, ["code", "detail"], context, `${path}.reason`);
    reason = {
      code: oneOf(found.code, REASON_CODES, context, `${path}.reason.code`),
      detail: string(found.detail, context, `${path}.reason.detail`),
    };
  }
  if (state === "supported" && (claimIds.length === 0 || reason !== null)) fail(context, path, "supported coverage requires claims and no reason");
  if (state !== "supported" && (claimIds.length !== 0 || reason === null)) fail(context, path, "weak coverage requires no claims and one reason");
  if (preservedStates.length === 0 || !preservedStates.includes(state)) fail(context, `${path}.preservedStates`, "must retain the current state");
  const mediaRange = range({ artifactId: item.artifactId, trackId: item.trackId, startMs: item.startMs, endMs: item.endMs }, context, path);
  return { coverageId: string(item.coverageId, context, `${path}.coverageId`), ...mediaRange, state, preservedStates, rawStates: uniqueStrings(item.rawStates, context, `${path}.rawStates`), claimIds, citationIds: uniqueStrings(item.citationIds, context, `${path}.citationIds`), reason, passIds: uniqueStrings(item.passIds, context, `${path}.passIds`) };
}

function reportIdentity(value: unknown, context: string, path: string): AdmittedStudyReportV2 {
  const item = object(value, context, path);
  exact(item, ["report", "admission"], context, path);
  const report = object(item.report, context, `${path}.report`);
  exact(report, ["artifactId", "contentId", "bytes", "schema"], context, `${path}.report`);
  const admission = object(item.admission, context, `${path}.admission`);
  exact(admission, ["admissionId", "receiptId", "receiptContentId"], context, `${path}.admission`);
  return {
    report: {
      artifactId: string(report.artifactId, context, `${path}.report.artifactId`),
      contentId: contentId(report.contentId, context, `${path}.report.contentId`),
      bytes: integer(report.bytes, context, `${path}.report.bytes`, 1),
      schema: literal(report.schema, "studio.study-report.v2", context, `${path}.report.schema`),
    },
    admission: {
      admissionId: string(admission.admissionId, context, `${path}.admission.admissionId`),
      receiptId: string(admission.receiptId, context, `${path}.admission.receiptId`),
      receiptContentId: contentId(admission.receiptContentId, context, `${path}.admission.receiptContentId`),
    },
  };
}

function studyClaim(value: unknown, context: string, path: string): OwnedMediaStudyClaimV2 {
  const item = object(value, context, path); exact(item, ["claimId", "artifactId", "trackId", "startMs", "endMs", "statement", "childClaims", "citationIds"], context, path);
  const childClaims = array(item.childClaims, context, `${path}.childClaims`).map((entry, index) => { const found = object(entry, context, `${path}.childClaims[${index}]`); exact(found, ["admissionId", "reportArtifactId", "reportContentId", "claimId"], context, `${path}.childClaims[${index}]`); return { admissionId: string(found.admissionId, context, `${path}.childClaims[${index}].admissionId`), reportArtifactId: string(found.reportArtifactId, context, `${path}.childClaims[${index}].reportArtifactId`), reportContentId: contentId(found.reportContentId, context, `${path}.childClaims[${index}].reportContentId`), claimId: string(found.claimId, context, `${path}.childClaims[${index}].claimId`) }; });
  const mediaRange = range({ artifactId: item.artifactId, trackId: item.trackId, startMs: item.startMs, endMs: item.endMs }, context, path);
  return { claimId: string(item.claimId, context, `${path}.claimId`), ...mediaRange, statement: string(item.statement, context, `${path}.statement`), childClaims, citationIds: uniqueStrings(item.citationIds, context, `${path}.citationIds`) };
}

export function validateOwnedMediaStudyArtifactV3(value: unknown): OwnedMediaStudyArtifactV3 {
  const context = "Owned-media study v3"; const item = object(value, context, "artifact");
  exact(item, ["schema", "runId", "root", "reports", "passes", "coverage", "claims", "evidenceCitations", "sourceArtifacts", "limits", "nonClaims"], context, "artifact"); literal(item.schema, "studio.owned-media-study.v3", context, "artifact.schema");
  const root = object(item.root, context, "artifact.root"); exact(root, ["taskId", "agentId", "executionId", "jobContextId", "source", "mediaScope"], context, "artifact.root"); const source = object(root.source, context, "artifact.root.source"); exact(source, ["artifactId", "contentId"], context, "artifact.root.source");
  const reports = array(item.reports, context, "artifact.reports").map((entry, index) => reportIdentity(entry, context, `artifact.reports[${index}]`));
  const passes = array(item.passes, context, "artifact.passes").map((entry, index) => passRecord(entry, context, `artifact.passes[${index}]`));
  const coverage = array(item.coverage, context, "artifact.coverage").map((entry, index) => studyCoverage(entry, context, `artifact.coverage[${index}]`));
  const claims = array(item.claims, context, "artifact.claims").map((entry, index) => studyClaim(entry, context, `artifact.claims[${index}]`));
  const citations = array(item.evidenceCitations, context, "artifact.evidenceCitations").map((entry, index) => validateEvidenceCitationEnvelope(entry, context, `artifact.evidenceCitations[${index}]`));
  const sources = array(item.sourceArtifacts, context, "artifact.sourceArtifacts").map((entry, index) => { const found = object(entry, context, `artifact.sourceArtifacts[${index}]`); exact(found, ["artifactId", "contentId"], context, `artifact.sourceArtifacts[${index}]`); return { artifactId: string(found.artifactId, context, `artifact.sourceArtifacts[${index}].artifactId`), contentId: contentId(found.contentId, context, `artifact.sourceArtifacts[${index}].contentId`) }; });
  const limits = object(item.limits, context, "artifact.limits"); exact(limits, Object.keys(OWNED_MEDIA_STUDY_V3_LIMITS), context, "artifact.limits"); for (const [key, expected] of Object.entries(OWNED_MEDIA_STUDY_V3_LIMITS)) if (limits[key] !== expected) fail(context, `artifact.limits.${key}`, `must equal ${expected}`);
  const nonClaims = object(item.nonClaims, context, "artifact.nonClaims"); exact(nonClaims, ["semanticCorrectness", "translationQuality", "truthArbitration", "modalityReliabilityEquivalence", "independentCorroboration", "passCountImpliesUnderstanding", "publication"], context, "artifact.nonClaims"); literal(nonClaims.semanticCorrectness, "not_assessed", context, "artifact.nonClaims.semanticCorrectness"); literal(nonClaims.translationQuality, "not_assessed", context, "artifact.nonClaims.translationQuality"); literal(nonClaims.truthArbitration, "not_performed", context, "artifact.nonClaims.truthArbitration"); literal(nonClaims.modalityReliabilityEquivalence, "not_claimed", context, "artifact.nonClaims.modalityReliabilityEquivalence"); literal(nonClaims.independentCorroboration, "not_assessed", context, "artifact.nonClaims.independentCorroboration"); literal(nonClaims.passCountImpliesUnderstanding, "not_claimed", context, "artifact.nonClaims.passCountImpliesUnderstanding"); literal(nonClaims.publication, "not_authorized", context, "artifact.nonClaims.publication");
  const mediaScope = array(root.mediaScope, context, "artifact.root.mediaScope").map((entry, index) => range(entry, context, `artifact.root.mediaScope[${index}]`));
  if (reports.length === 0 || reports.length > OWNED_MEDIA_STUDY_V3_LIMITS.maxReports || passes.length > OWNED_MEDIA_STUDY_V3_LIMITS.maxPasses || coverage.length === 0 || coverage.length > OWNED_MEDIA_STUDY_V3_LIMITS.maxCoverageRanges || claims.length > OWNED_MEDIA_STUDY_V3_LIMITS.maxClaims || citations.length > OWNED_MEDIA_STUDY_V3_LIMITS.maxCitations) fail(context, "artifact", "exceeds a closed study-v3 count ceiling");
  validateGeneralizedCoveragePartition(coverage, mediaScope, "Owned-media study v3 coverage");
  const passById = new Map(passes.map((entry) => [entry.id, entry])); if (passById.size !== passes.length || passes.some((entry) => !entry.accepted || !entry.terminal)) fail(context, "artifact.passes", "must retain every accepted terminal pass exactly once");
  const orderedPassIds = [...passes].sort((left, right) => left.request.passNumber - right.request.passNumber || left.id.localeCompare(right.id)).map((entry) => entry.id);
  if (JSON.stringify(orderedPassIds) !== JSON.stringify(passes.map((entry) => entry.id))) fail(context, "artifact.passes", "must retain deterministic pass order");
  const citationById = new Map(citations.map((entry) => [entry.citationId, entry])); if (citationById.size !== citations.length) fail(context, "artifact.evidenceCitations", "repeats citation identities");
  const claimById = new Map(claims.map((entry) => [entry.claimId, entry])); if (claimById.size !== claims.length) fail(context, "artifact.claims", "repeats claim identities");
  const referencedClaims = coverage.flatMap((entry) => entry.claimIds);
  if (new Set(referencedClaims).size !== referencedClaims.length || referencedClaims.length !== claims.length || referencedClaims.some((id) => !claimById.has(id))) fail(context, "artifact.coverage", "must reference every claim exactly once");
  for (const covered of coverage) {
    if (covered.passIds.some((id) => !passById.has(id))) fail(context, "artifact.coverage", "names an absent pass");
    if (covered.state === "supported" && covered.preservedStates.some((state) => state !== "supported")) {
      const resolving = covered.passIds.map((id) => passById.get(id)!).find((entry) => entry.terminal?.outcome === "supported_new_citations");
      const supportCitationIds = covered.claimIds.flatMap((id) => claimById.get(id)?.citationIds ?? []);
      if (!resolving || resolving.request.priorState === "conflicting" || resolving.terminal!.evidence.newCitationIds.some((id) => !supportCitationIds.includes(id))) fail(context, "artifact.coverage", "upgraded a weak range without its exact new-citation pass");
    }
    if (covered.state === "supported" && covered.claimIds.some((id) => !claimById.has(id))) fail(context, "artifact.coverage", "names an absent supported claim");
    const coverageCitations = covered.citationIds.map((id) => citationById.get(id));
    if (coverageCitations.some((entry) => !entry || entry.target.kind !== "coverage" || !sameRange(entry.target.range, covered))) fail(context, "artifact.coverage", "coverage citation changed its exact range target");
  }
  for (const claim of claims) {
    const claimCitations = claim.citationIds.map((id) => citationById.get(id)).filter((entry): entry is EvidenceCitationEnvelope => Boolean(entry));
    if (claimCitations.length !== claim.citationIds.length || claimCitations.some((entry) => {
      const target = entry.target;
      return entry.evidenceKind !== "current_run_speech" || entry.use !== "claim_support" || target.kind !== "claim" || !claim.childClaims.some((child) => child.claimId === target.claimId);
    })) fail(context, "artifact.claims", "contains non-speech, absent, or retargeted claim support");
    for (const child of claim.childClaims) validateSupportedClaimCitationClosure(child.claimId, claim, claimCitations);
  }
  for (const citation of citations) {
    const passEvidenceIds = new Set(passes.flatMap((entry) => [
      ...entry.request.priorEvidence.citationIds,
      ...(entry.terminal?.evidence.citationIds ?? []),
      ...(entry.terminal?.evidence.disagreementCitationIds ?? []),
    ]));
    const linkedByPassCoverage = citation.target.kind === "coverage" && passes.some((entry) => {
      const execution = entry.request.delta.executionRange;
      return citation.target.kind === "coverage" && sameRange(citation.target.range, execution) && coverage.some((covered) => covered.passIds.includes(entry.id));
    });
    const linked = citation.target.kind === "media_context" || passEvidenceIds.has(citation.citationId) || linkedByPassCoverage || claims.some((entry) => entry.citationIds.includes(citation.citationId)) || coverage.some((entry) => entry.citationIds.includes(citation.citationId));
    if (!linked) fail(context, "artifact.evidenceCitations", "contains an unassociated generic citation");
  }
  if (passes.some((pass) => !coverage.some((entry) => entry.passIds.includes(pass.id)))) fail(context, "artifact.passes", "contains an unassociated pass");
  const expectedSources = new Map<string, string>();
  const rootArtifactId = string(source.artifactId, context, "artifact.root.source.artifactId");
  const rootContentId = contentId(source.contentId, context, "artifact.root.source.contentId");
  expectedSources.set(rootArtifactId, rootContentId);
  for (const report of reports) expectedSources.set(report.report.artifactId, report.report.contentId);
  for (const citation of citations) {
    expectedSources.set(citation.evidence.artifactId, citation.evidence.contentId);
    if (citation.receipt.artifactId) expectedSources.set(citation.receipt.artifactId, citation.receipt.contentId);
  }
  const expectedSourceList = [...expectedSources.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([artifactId, foundContentId]) => ({ artifactId, contentId: foundContentId }));
  if (JSON.stringify(sources) !== JSON.stringify(expectedSourceList)) fail(context, "artifact.sourceArtifacts", "must contain exact lineage only");
  return {
    schema: "studio.owned-media-study.v3", runId: string(item.runId, context, "artifact.runId"), root: { taskId: string(root.taskId, context, "artifact.root.taskId"), agentId: string(root.agentId, context, "artifact.root.agentId"), executionId: string(root.executionId, context, "artifact.root.executionId"), jobContextId: string(root.jobContextId, context, "artifact.root.jobContextId"), source: { artifactId: rootArtifactId, contentId: rootContentId }, mediaScope }, reports, passes, coverage, claims, evidenceCitations: citations, sourceArtifacts: sources, limits: OWNED_MEDIA_STUDY_V3_LIMITS,
    nonClaims: { semanticCorrectness: "not_assessed", translationQuality: "not_assessed", truthArbitration: "not_performed", modalityReliabilityEquivalence: "not_claimed", independentCorroboration: "not_assessed", passCountImpliesUnderstanding: "not_claimed", publication: "not_authorized" },
  };
}

function studyIdentity(value: unknown, context: string, path: string): OwnedMediaStudyV3Identity {
  const item = object(value, context, path); exact(item, ["studyId", "artifactId", "contentId", "bytes", "schema"], context, path);
  return { studyId: string(item.studyId, context, `${path}.studyId`), artifactId: string(item.artifactId, context, `${path}.artifactId`), contentId: contentId(item.contentId, context, `${path}.contentId`), bytes: integer(item.bytes, context, `${path}.bytes`, 1), schema: literal(item.schema, "studio.owned-media-study.v3", context, `${path}.schema`) };
}

export function validateOwnedMediaStudyExecutorReceiptV3(value: unknown): OwnedMediaStudyExecutorReceiptV3 {
  const context = "Owned-media study executor receipt v3"; const item = object(value, context, "receipt"); exact(item, ["schema", "receiptId", "runId", "input", "output", "producer", "nonClaims"], context, "receipt"); literal(item.schema, "studio.owned-media-study.executor-receipt.v3", context, "receipt.schema");
  const input = object(item.input, context, "receipt.input"); exact(input, ["reportArtifactIds", "admissionIds", "passIds"], context, "receipt.input"); const producer = object(item.producer, context, "receipt.producer"); exact(producer, ["id", "version", "policy"], context, "receipt.producer"); literal(producer.id, "studio.restudied-study-synthesis", context, "receipt.producer.id"); literal(producer.version, "3", context, "receipt.producer.version"); literal(producer.policy, "retain_all_passes_and_only_upgrade_with_new_range_closing_speech_citations", context, "receipt.producer.policy"); const nonClaims = object(item.nonClaims, context, "receipt.nonClaims"); exact(nonClaims, ["semanticCorrectness", "truthArbitration"], context, "receipt.nonClaims"); literal(nonClaims.semanticCorrectness, "not_assessed", context, "receipt.nonClaims.semanticCorrectness"); literal(nonClaims.truthArbitration, "not_performed", context, "receipt.nonClaims.truthArbitration");
  const receipt: OwnedMediaStudyExecutorReceiptV3 = { schema: "studio.owned-media-study.executor-receipt.v3", receiptId: string(item.receiptId, context, "receipt.receiptId"), runId: string(item.runId, context, "receipt.runId"), input: { reportArtifactIds: uniqueStrings(input.reportArtifactIds, context, "receipt.input.reportArtifactIds"), admissionIds: uniqueStrings(input.admissionIds, context, "receipt.input.admissionIds"), passIds: uniqueStrings(input.passIds, context, "receipt.input.passIds") }, output: studyIdentity(item.output, context, "receipt.output"), producer: { id: "studio.restudied-study-synthesis", version: "3", policy: "retain_all_passes_and_only_upgrade_with_new_range_closing_speech_citations" }, nonClaims: { semanticCorrectness: "not_assessed", truthArbitration: "not_performed" } };
  const body = structuredClone(receipt) as unknown as Record<string, unknown>; delete body.schema; delete body.receiptId;
  if (receipt.receiptId !== `owned-media-study-executor-receipt-v3:${canonicalSha256(body)}`) fail(context, "receipt.receiptId", "does not close the executor receipt");
  return receipt;
}

export function validateStudyReadinessReceiptV4(value: unknown): StudyReadinessReceiptV4 {
  const context = "Study readiness receipt v4";
  const item = object(value, context, "receipt");
  exact(item, ["schema", "receiptId", "readinessId", "runId", "input", "reopened", "producer", "result", "nonClaims"], context, "receipt");
  literal(item.schema, "studio.study-readiness.receipt.v4", context, "receipt.schema");
  const reopened = object(item.reopened, context, "receipt.reopened");
  exact(reopened, ["reportArtifactIds", "admissionIds", "evidenceArtifactIds", "evidenceReceiptContentIds", "passIds", "passRequestReceiptContentIds", "passTerminalReceiptContentIds"], context, "receipt.reopened");
  const producer = object(item.producer, context, "receipt.producer");
  exact(producer, ["id", "version", "policy"], context, "receipt.producer");
  literal(producer.id, "studio.deterministic-restudied-study-readiness-audit", context, "receipt.producer.id");
  literal(producer.version, "4", context, "receipt.producer.version");
  literal(producer.policy, "terminal_weak_ranges_do_not_block_unrelated_supported_ranges_no_quality_score", context, "receipt.producer.policy");
  const result = object(item.result, context, "receipt.result");
  exact(result, ["outcome", "reasonCodes", "states", "coverageIds", "terminalWeakCoverageIds"], context, "receipt.result");
  const outcome = oneOf<StudyReadinessReceiptV4["result"]["outcome"]>(result.outcome, new Set(["proceed_to_caption_review", "withheld"]), context, "receipt.result.outcome");
  const reasonCodes = uniqueStrings(result.reasonCodes, context, "receipt.result.reasonCodes").map((entry, index) => oneOf<StudyReadinessReceiptV4["result"]["reasonCodes"][number]>(entry, new Set(["unresolved_conflict", "hidden_gap", "stored_content_integrity_failed"]), context, `receipt.result.reasonCodes[${index}]`));
  if ((outcome === "withheld") !== (reasonCodes.length > 0)) fail(context, "receipt.result", "must withhold exactly when an integrity/conflict blocker exists");
  const states = uniqueStrings(result.states, context, "receipt.result.states").map((entry, index) => oneOf<GeneralizedCoverageState | "available">(entry, new Set([...COVERAGE_STATES, "available"]), context, `receipt.result.states[${index}]`));
  const nonClaims = object(item.nonClaims, context, "receipt.nonClaims");
  exact(nonClaims, ["semanticCorrectness", "translationQuality", "truthArbitration", "terminalWeaknessImpliesGlobalFailure"], context, "receipt.nonClaims");
  literal(nonClaims.semanticCorrectness, "not_assessed", context, "receipt.nonClaims.semanticCorrectness");
  literal(nonClaims.translationQuality, "not_assessed", context, "receipt.nonClaims.translationQuality");
  literal(nonClaims.truthArbitration, "not_performed", context, "receipt.nonClaims.truthArbitration");
  literal(nonClaims.terminalWeaknessImpliesGlobalFailure, "not_claimed", context, "receipt.nonClaims.terminalWeaknessImpliesGlobalFailure");
  const receipt: StudyReadinessReceiptV4 = {
    schema: "studio.study-readiness.receipt.v4",
    receiptId: string(item.receiptId, context, "receipt.receiptId"),
    readinessId: string(item.readinessId, context, "receipt.readinessId"),
    runId: string(item.runId, context, "receipt.runId"),
    input: studyIdentity(item.input, context, "receipt.input"),
    reopened: {
      reportArtifactIds: uniqueStrings(reopened.reportArtifactIds, context, "receipt.reopened.reportArtifactIds"),
      admissionIds: uniqueStrings(reopened.admissionIds, context, "receipt.reopened.admissionIds"),
      evidenceArtifactIds: uniqueStrings(reopened.evidenceArtifactIds, context, "receipt.reopened.evidenceArtifactIds"),
      evidenceReceiptContentIds: uniqueStrings(reopened.evidenceReceiptContentIds, context, "receipt.reopened.evidenceReceiptContentIds"),
      passIds: uniqueStrings(reopened.passIds, context, "receipt.reopened.passIds"),
      passRequestReceiptContentIds: uniqueStrings(reopened.passRequestReceiptContentIds, context, "receipt.reopened.passRequestReceiptContentIds"),
      passTerminalReceiptContentIds: uniqueStrings(reopened.passTerminalReceiptContentIds, context, "receipt.reopened.passTerminalReceiptContentIds"),
    },
    producer: { id: "studio.deterministic-restudied-study-readiness-audit", version: "4", policy: "terminal_weak_ranges_do_not_block_unrelated_supported_ranges_no_quality_score" },
    result: {
      outcome,
      reasonCodes,
      states,
      coverageIds: uniqueStrings(result.coverageIds, context, "receipt.result.coverageIds"),
      terminalWeakCoverageIds: uniqueStrings(result.terminalWeakCoverageIds, context, "receipt.result.terminalWeakCoverageIds"),
    },
    nonClaims: { semanticCorrectness: "not_assessed", translationQuality: "not_assessed", truthArbitration: "not_performed", terminalWeaknessImpliesGlobalFailure: "not_claimed" },
  };
  const body = structuredClone(receipt) as unknown as Record<string, unknown>; delete body.schema; delete body.receiptId;
  if (receipt.receiptId !== `study-readiness-receipt-v4:${canonicalSha256(body)}`) fail(context, "receipt.receiptId", "does not close the readiness receipt");
  return receipt;
}
