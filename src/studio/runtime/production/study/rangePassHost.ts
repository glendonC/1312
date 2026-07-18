import {
  canonicalJsonContentId,
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "../artifactStore.ts";
import { taskCapabilityCallCount } from "../capabilityUsage.ts";
import type { RuntimeLedger } from "../journal.ts";
import type {
  EvidenceCitationEnvelope,
  GeneralizedCoverageState,
  QualifiedMediaRange,
  RangePassRecord,
  RangePassRequestReceipt,
  RangePassTerminalOutcome,
  RangePassTerminalReceipt,
  SpawnRequestInput,
  StudyRestudyCandidate,
  StudyRestudyCauseKind,
  StudyRestudyInput,
} from "../model.ts";
import {
  PADDED_AUDIO_WINDOW_LIMITS,
  RANGE_PASS_LIMITS,
  REGISTERED_SPEECH_RANGE_PASS_PRODUCERS,
  SEMANTIC_EVIDENCE_LIMITS,
} from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import { BoundedRuntimeScheduler, type SpawnDecision } from "../scheduler.ts";
import { SEMANTIC_EVIDENCE_NORMALIZATION } from "../semantic/currentRunSpeechRecognizer.ts";
import { GeneralizedEvidenceAdmissionHost } from "../admission/generalizedEvidenceAdmissionHost.ts";
import { inspectGeneralizedStudy } from "./generalizedStudyRuntime.ts";
import {
  validateRangePassRequestReceipt,
  validateRangePassTerminalReceipt,
  validateStudyRestudyRequest,
} from "../validation/studiesV3.ts";

function sameRange(left: QualifiedMediaRange, right: QualifiedMediaRange): boolean {
  return left.artifactId === right.artifactId && left.trackId === right.trackId &&
    left.startMs === right.startMs && left.endMs === right.endMs;
}

function overlaps(left: QualifiedMediaRange, right: QualifiedMediaRange): boolean {
  return left.artifactId === right.artifactId && left.trackId === right.trackId &&
    left.startMs < right.endMs && left.endMs > right.startMs;
}

function causeKind(state: StudyRestudyCandidate["state"], rawStates: readonly string[]): StudyRestudyCauseKind {
  if (state === "unknown") return rawStates.includes("unobserved_range") ? "unobserved_range" : "unknown_evidence";
  if (state === "withheld") return "withheld_evidence";
  if (state === "unavailable") return "unavailable_evidence";
  if (state === "truncated") return "truncated_evidence";
  if (state === "conflicting") return "recognizer_disagreement";
  return "failed_range";
}

const SPEAKER_OVERLAP_RAW_STATE = "speaker:overlap:overlap_hypothesis_requires_speech_restudy";

export interface SpeakerOverlapRestudyTrigger {
  range: QualifiedMediaRange;
  citationIds: string[];
  observationIds: string[];
  rawStates: string[];
}

/** Selects one deterministic exact U6 accounting cell; raw aggregate text alone is never authority. */
export function deriveSpeakerOverlapRestudyTrigger(
  citations: readonly EvidenceCitationEnvelope[],
  weakRange: QualifiedMediaRange,
  rawStates: readonly string[],
): SpeakerOverlapRestudyTrigger | null {
  const cells = citations.flatMap((citation) => {
    if (citation.evidenceKind !== "speaker_turn" || citation.use !== "coverage_qualification") return [];
    return citation.observations.flatMap((observation) => {
      if (observation.state !== "conflicting" || observation.rawState !== SPEAKER_OVERLAP_RAW_STATE ||
          observation.locator.kind !== "temporal_range") return [];
      const range = observation.locator.media;
      const aggregatedRawState = `${observation.observationId}:conflicting:${SPEAKER_OVERLAP_RAW_STATE}`;
      if (range.artifactId !== weakRange.artifactId || range.trackId !== weakRange.trackId ||
          range.startMs < weakRange.startMs || range.endMs > weakRange.endMs ||
          !rawStates.includes(aggregatedRawState)) return [];
      return [{ range, citationId: citation.citationId, observationId: observation.observationId, rawState: aggregatedRawState }];
    });
  }).sort((left, right) => left.range.startMs - right.range.startMs || left.range.endMs - right.range.endMs ||
    left.observationId.localeCompare(right.observationId) || left.citationId.localeCompare(right.citationId));
  const first = cells[0];
  if (!first) return null;
  const exact = cells.filter((cell) => sameRange(cell.range, first.range));
  return {
    range: structuredClone(first.range),
    citationIds: [...new Set(exact.map((cell) => cell.citationId))].sort(),
    observationIds: [...new Set(exact.map((cell) => cell.observationId))].sort(),
    rawStates: [...new Set(exact.map((cell) => cell.rawState))].sort(),
  };
}

function hasNonSpeakerConflict(rawStates: readonly string[]): boolean {
  return rawStates.some((raw) => raw.includes(":conflicting:") &&
    !raw.includes(":conflicting:speaker:overlap:"));
}

function hasSpeakerOverlapConflict(citations: readonly EvidenceCitationEnvelope[], rawStates: readonly string[]): boolean {
  return rawStates.some((raw) => raw.includes(":conflicting:speaker:overlap:")) || citations.some((citation) =>
    citation.evidenceKind === "speaker_turn" && citation.observations.some((observation) =>
      observation.state === "conflicting" && observation.rawState.startsWith("speaker:overlap:")));
}

function terminalOutcome(state: GeneralizedCoverageState | null, taskStatus: string): RangePassTerminalOutcome {
  if (taskStatus === "withheld" || state === "withheld" || state === "conflicting" || state === "not_in_scope") return "withheld_exhausted";
  if (state === "unknown") return "unknown_exhausted";
  return "unavailable_exhausted";
}

function receiptId(prefix: string, receipt: { schema: string; receiptId: string }): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema; delete body.receiptId;
  return `${prefix}:${canonicalSha256(body)}`;
}

async function storedJson(artifacts: ContentAddressedArtifactStore, contentId: string, label: string): Promise<unknown> {
  const bytes = await artifacts.receiptBytes(contentId);
  if (bytes.byteLength <= 0 || bytes.byteLength > 512 * 1024) throw new Error(`${label} exceeds its byte ceiling`);
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new Error(`${label} is not valid JSON`); }
  if (canonicalJsonContentId(value) !== contentId) throw new Error(`${label} changed canonical content identity`);
  return value;
}

export interface RangePassRequestResult {
  input: StudyRestudyInput;
  receipt: RangePassRequestReceipt;
  receiptContentId: string;
  decision: SpawnDecision;
}

export async function reopenRangePass(
  artifacts: ContentAddressedArtifactStore,
  pass: RangePassRecord,
): Promise<RangePassRecord> {
  const request = validateRangePassRequestReceipt(await storedJson(artifacts, pass.requestReceiptContentId, "Stored range-pass request receipt"));
  if (canonicalSha256(request) !== canonicalSha256(pass.request) || request.receiptId !== pass.requestReceiptId) throw new Error("Range-pass request receipt changed from the journal projection");
  if (!pass.accepted) return structuredClone(pass);
  if (!pass.terminal || !pass.terminalReceiptContentId || !pass.terminalReceiptId) throw new Error("Accepted range pass has no terminal receipt");
  const terminal = validateRangePassTerminalReceipt(await storedJson(artifacts, pass.terminalReceiptContentId, "Stored range-pass terminal receipt"));
  if (canonicalSha256(terminal) !== canonicalSha256(pass.terminal) || terminal.receiptId !== pass.terminalReceiptId || terminal.requestReceiptContentId !== pass.requestReceiptContentId) throw new Error("Range-pass terminal receipt changed from the journal projection");
  return { ...structuredClone(pass), request, terminal };
}

/** Host-owned U4 policy. The model selects an exact cause and only the host-permitted execution range. */
export class RangePassHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly scheduler: BoundedRuntimeScheduler | null;

  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
    scheduler: BoundedRuntimeScheduler | null = null,
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
    this.scheduler = scheduler;
  }

  async inspect(executionId: string): Promise<StudyRestudyInput> {
    const state = this.ledger.state();
    const execution = state.executions[executionId];
    const root = execution ? state.tasks[execution.taskId] : null;
    if (!execution || execution.status !== "active" || !root || root.parentTaskId !== null ||
        root.workerKind !== "orchestrator" || root.ownerAgentId !== execution.agentId ||
        !root.grants.some((grant) => grant.capability === "study.restudy")) {
      throw new Error("Study re-study input requires the active default generalized root");
    }
    const { inspected } = await inspectGeneralizedStudy(this.ledger, this.artifacts, root.id);
    const alreadyPassedRanges = Object.values(state.rangePasses).filter((entry) => entry.accepted).map((entry) => entry.request.weakRange);
    const candidates: StudyRestudyCandidate[] = inspected.coverage
      .filter((entry): entry is typeof entry & { state: StudyRestudyCandidate["state"] } => entry.state !== "supported" && entry.state !== "not_in_scope")
      .flatMap((entry) => {
        const matchingReports = inspected.reports.filter((report) => report.reportEnvelope.coverage.some((covered) => overlaps(covered, entry)));
        const reportArtifactIds = matchingReports.map((report) => report.report.artifactId).sort();
        const admissionIds = matchingReports.map((report) => report.admission.admissionId).sort();
        const citations = matchingReports.flatMap((report) => report.reportEnvelope.evidenceCitations.filter((citation) =>
          citation.observations.some((observation) => observation.locator.kind === "temporal_range" && overlaps(observation.locator.media, entry)) ||
          (citation.target.kind === "coverage" && overlaps(citation.target.range, entry))));
        const citationIds = [...new Set(citations.map((citation) => citation.citationId))].sort();
        const relevantTasks = new Set(matchingReports.map((report) => report.reportEnvelope.task.taskId));
        const speech = Object.values(state.semanticEvidence)
          .filter((operation) => relevantTasks.has(operation.taskId) && operation.sourceArtifactId === entry.artifactId && operation.trackId === entry.trackId && operation.startMs < entry.endMs && operation.endMs > entry.startMs)
          .sort((left, right) => left.id.localeCompare(right.id));
        const speechExecutionRanges = speech.map((operation) => ({ artifactId: operation.sourceArtifactId, trackId: operation.trackId, startMs: operation.startMs, endMs: operation.endMs }));
        const priorEvidence = {
          reportArtifactIds,
          admissionIds,
          citationIds,
          speechOperationIds: speech.map((operation) => operation.id),
          speechExecutionRanges,
        };
        const observationIds = [...new Set(citations.flatMap((citation) => citation.observations.map((observation) => observation.observationId)))].sort();
        const rawStates = [...new Set(matchingReports.flatMap((report) => report.reportEnvelope.coverage.filter((covered) => overlaps(covered, entry)).flatMap((covered) => covered.rawStates)))].sort();
        const weakRange = { artifactId: entry.artifactId, trackId: entry.trackId, startMs: entry.startMs, endMs: entry.endMs };
        const speakerOnlyConflict = entry.state === "conflicting" && hasSpeakerOverlapConflict(citations, rawStates) &&
          !hasNonSpeakerConflict(rawStates);
        const speakerTrigger = speakerOnlyConflict
          ? deriveSpeakerOverlapRestudyTrigger(citations, weakRange, rawStates)
          : null;
        const speakerTriggerHasDelta = speakerTrigger && speechExecutionRanges.some((range) =>
          range.artifactId === speakerTrigger.range.artifactId && range.trackId === speakerTrigger.range.trackId &&
          range.startMs <= speakerTrigger.range.startMs && range.endMs >= speakerTrigger.range.endMs &&
          (range.startMs < speakerTrigger.range.startMs || range.endMs > speakerTrigger.range.endMs));
        if (speakerOnlyConflict && (!speakerTrigger || !speakerTriggerHasDelta)) return [];
        const causeCitationIds = speakerTrigger?.citationIds ?? citationIds;
        const causeReportArtifactIds = speakerTrigger
          ? matchingReports.filter((report) => report.reportEnvelope.evidenceCitations.some((citation) =>
              speakerTrigger.citationIds.includes(citation.citationId))).map((report) => report.report.artifactId).sort()
          : reportArtifactIds;
        const causeBody = speakerTrigger ? {
          kind: "speaker_overlap" as const,
          coverageId: entry.coverageId,
          range: speakerTrigger.range,
          priorState: entry.state,
          reportArtifactIds: causeReportArtifactIds,
          citationIds: causeCitationIds,
          observationIds: speakerTrigger.observationIds,
          rawStates: speakerTrigger.rawStates,
        } : {
          kind: causeKind(entry.state, rawStates), coverageId: entry.coverageId, range: weakRange,
          priorState: entry.state, reportArtifactIds, citationIds, observationIds, rawStates,
        };
        return [{
          coverageId: entry.coverageId,
          range: weakRange,
          state: entry.state,
          priorEvidence,
          cause: { causeId: `study-restudy-cause:${canonicalSha256(causeBody)}`, ...causeBody },
        }];
      })
      .filter((entry) => !alreadyPassedRanges.some((range) =>
        range.artifactId === entry.range.artifactId && range.trackId === entry.range.trackId &&
        range.startMs <= entry.range.startMs && range.endMs >= entry.range.endMs));
    const body = { schema: "studio.study-restudy-input.v1" as const, runId: state.runId, rootTaskId: root.id, rootAgentId: root.ownerAgentId, rootExecutionId: execution.id, candidates };
    return { ...body, inputId: `study-restudy-input:${canonicalSha256(body)}` };
  }

  async request(executionId: string, toolCallId: string, requestValue: unknown): Promise<RangePassRequestResult> {
    const request = validateStudyRestudyRequest(requestValue);
    if (request.delta.kind !== "attenuated_subrange" && request.delta.kind !== "padded_audio_window") {
      throw new Error("The requested re-study delta has no registered producer/grant in this runtime slice");
    }
    const input = await this.inspect(executionId);
    if (request.inputId !== input.inputId) throw new Error("Study re-study request changed its exact current input");
    const candidate = input.candidates.find((entry) => entry.coverageId === request.coverageId && entry.cause.causeId === request.causeId);
    if (!candidate) throw new Error("Study re-study request does not name one exact current weak range and cause");
    const state = this.ledger.state();
    const root = state.tasks[input.rootTaskId];
    const executionRange = request.delta.executionRange;
    const executionInsideWeak = executionRange.artifactId === candidate.range.artifactId && executionRange.trackId === candidate.range.trackId &&
      executionRange.startMs >= candidate.range.startMs && executionRange.endMs <= candidate.range.endMs;
    if (request.delta.kind === "attenuated_subrange") {
      if (candidate.cause.kind === "speaker_overlap") {
        if (!executionInsideWeak || !sameRange(executionRange, candidate.cause.range)) {
          throw new Error("Speaker-overlap re-study must use the exact host-derived overlap range");
        }
      } else if (!executionInsideWeak || sameRange(executionRange, candidate.range)) {
        throw new Error("Attenuated re-study must be one strict subrange of the exact weak range");
      }
      if (!candidate.priorEvidence.speechExecutionRanges.some((range) =>
        range.artifactId === executionRange.artifactId && range.trackId === executionRange.trackId &&
        range.startMs <= executionRange.startMs && range.endMs >= executionRange.endMs &&
        (range.startMs < executionRange.startMs || range.endMs > executionRange.endMs))) {
        throw new Error("Attenuated re-study has no prior broader current-run speech work to refine");
      }
      if (candidate.priorEvidence.speechExecutionRanges.some((range) => sameRange(range, executionRange))) {
        throw new Error("Attenuated re-study repeats an identical prior speech range/configuration");
      }
    } else {
      if (candidate.cause.kind === "speaker_overlap") {
        throw new Error("Speaker-overlap re-study has no registered padded-audio producer");
      }
      const sameMedia = executionRange.artifactId === candidate.range.artifactId &&
        executionRange.trackId === candidate.range.trackId;
      const exactPadding = executionRange.startMs === candidate.range.startMs - request.delta.paddingBeforeMs &&
        executionRange.endMs === candidate.range.endMs + request.delta.paddingAfterMs;
      const strictlyContainsWeak = sameMedia && executionRange.startMs <= candidate.range.startMs &&
        executionRange.endMs >= candidate.range.endMs && !sameRange(executionRange, candidate.range);
      const rootContainsExecution = root.mediaScope.some((scope) => scope.artifactId === executionRange.artifactId &&
        scope.trackId === executionRange.trackId && scope.startMs <= executionRange.startMs && scope.endMs >= executionRange.endMs);
      const source = state.artifacts[root.jobContext.source.artifactId];
      const audioTrack = source?.tracks.some((track) => track.id === executionRange.trackId && track.kind === "audio") ?? false;
      if (!exactPadding || !strictlyContainsWeak || !rootContainsExecution || !audioTrack ||
          request.delta.paddingBeforeMs > PADDED_AUDIO_WINDOW_LIMITS.maxPaddingBeforeMs ||
          request.delta.paddingAfterMs > PADDED_AUDIO_WINDOW_LIMITS.maxPaddingAfterMs ||
          executionRange.endMs - executionRange.startMs > SEMANTIC_EVIDENCE_LIMITS.maxDurationMs) {
        throw new Error("Padded-audio re-study must use the exact registered window inside the root audio scope");
      }
      if (!candidate.priorEvidence.speechExecutionRanges.some((range) => sameRange(range, candidate.range))) {
        throw new Error("Padded-audio re-study has no exact prior current-run speech work to contextualize");
      }
      if (candidate.priorEvidence.speechExecutionRanges.some((range) => sameRange(range, executionRange))) {
        throw new Error("Padded-audio re-study repeats an identical prior speech range/configuration");
      }
    }
    const producer = REGISTERED_SPEECH_RANGE_PASS_PRODUCERS[request.delta.kind];
    const configurationScope = producer.configurationScope;
    const workFingerprint = `restudy-work:${canonicalSha256({ schema: "studio.restudy-work-fingerprint.v1", runId: state.runId, sourceContentId: root.jobContext.source.contentId, trackId: executionRange.trackId, executionRange: { startMs: executionRange.startMs, endMs: executionRange.endMs }, deltaKind: request.delta.kind, producer: { kind: "current_run_speech", configurationScope }, normalization: SEMANTIC_EVIDENCE_NORMALIZATION })}`;
    const passId = `study-range-pass:${canonicalSha256({ runId: state.runId, inputId: input.inputId, coverageId: candidate.coverageId, causeId: candidate.cause.causeId, workFingerprint })}`;
    const receipt: RangePassRequestReceipt = {
      schema: "studio.study-range-pass-request.receipt.v1", receiptId: "pending", passId, runId: state.runId,
      root: { taskId: root.id, agentId: root.ownerAgentId!, executionId }, inputId: input.inputId,
      coverageId: candidate.coverageId, weakRange: structuredClone(candidate.range), priorState: candidate.state,
      priorEvidence: structuredClone(candidate.priorEvidence), cause: structuredClone(candidate.cause), delta: structuredClone(request.delta),
      passNumber: 2,
      producer: structuredClone(producer),
      workFingerprint, reservedSpend: { wallMs: RANGE_PASS_LIMITS.maxWallMsPerPass, toolCalls: RANGE_PASS_LIMITS.maxToolCallsPerPass }, limits: RANGE_PASS_LIMITS,
      nonClaims: { understanding: "not_claimed", improvement: "not_claimed", semanticCorrectness: "not_assessed" },
    };
    receipt.receiptId = receiptId("study-range-pass-request-receipt", receipt);
    validateRangePassRequestReceipt(receipt);
    const stored = await this.artifacts.storeJson(receipt);
    const padded = request.delta.kind === "padded_audio_window";
    const child: SpawnRequestInput = {
      workloadKey: `restudy:${workFingerprint}`,
      objective: padded
        ? "Perform exactly one bounded current-run speech pass over the assigned padded audio window and return one studio.study-report.v2. Preserve the prior weak state; broader context is structural evidence only and does not prove semantic support, understanding, correctness, or improvement."
        : "Perform exactly one attenuated current-run speech pass over the assigned subrange and return one studio.study-report.v2. Support requires new range-closing speech citations; otherwise preserve the exact weak state. This pass does not prove understanding, correctness, or improvement.",
      workerKind: "analysis", workerLabel: padded ? "padded-current-run-speech-pass-2" : "attenuated-current-run-speech-pass-2",
      mediaScope: [structuredClone(executionRange)], inputArtifactIds: [root.jobContext.source.artifactId],
      requiredOutputs: [{ name: padded ? "padded audio speech re-study" : "attenuated speech re-study", artifactKind: "studio.study-report.v2", required: true }],
      requiredCapabilities: ["speech.transcribe", "report.submit"], dependencies: [],
      budget: structuredClone(receipt.reservedSpend),
    };
    if (!this.scheduler) throw new Error("Study re-study scheduling authority is unavailable");
    const decision = await this.scheduler.requestSpeechRangePass({ receipt, receiptContentId: stored.content.contentId, child, authorship: { executionId, toolCallId } });
    return { input, receipt, receiptContentId: stored.content.contentId, decision };
  }

  async finalizeTask(taskId: string): Promise<RangePassTerminalReceipt | null> {
    const state = this.ledger.state();
    const pass = Object.values(state.rangePasses).find((entry) => entry.accepted && entry.taskId === taskId);
    if (!pass) return null;
    if (pass.terminal) return structuredClone(pass.terminal);
    const task = state.tasks[taskId];
    if (!task || !new Set(["completed", "failed", "withheld", "interrupted"]).has(task.status)) return null;
    const admission = Object.values(state.generalizedParentArtifactAdmissions).find((entry) => entry.childTaskId === taskId) ?? null;
    const read = admission ? Object.values(state.generalizedParentArtifactReads).find((entry) => entry.admissionId === admission.admissionId) ?? null : null;
    if (admission && !read) return null;
    let reportEnvelope: Awaited<ReturnType<GeneralizedEvidenceAdmissionHost["reopen"]>>["reportEnvelope"] | null = null;
    if (admission && read) {
      reportEnvelope = (await new GeneralizedEvidenceAdmissionHost(state, this.artifacts).reopen({
        report: admission.report,
        admission: { admissionId: admission.admissionId, receiptId: admission.receiptId, receiptContentId: admission.receiptContentId },
      })).reportEnvelope;
    }
    const executionRange = pass.request.delta.executionRange;
    const exactCoverage = reportEnvelope?.coverage.find((entry) => sameRange(entry, executionRange)) ?? null;
    const exactClaims = exactCoverage?.state === "supported"
      ? reportEnvelope!.claims.filter((claim) => exactCoverage.claimIds.includes(claim.claimId) && sameRange(claim, executionRange))
      : [];
    const citationIds = [...new Set(exactClaims.flatMap((claim) => claim.citationIds))].sort();
    const prior = new Set(pass.request.priorEvidence.citationIds);
    const newCitationIds = citationIds.filter((id) => !prior.has(id));
    const citations = reportEnvelope?.evidenceCitations.filter((citation) => newCitationIds.includes(citation.citationId)) ?? [];
    const priorStatements = new Set<string>();
    const admissionHost = new GeneralizedEvidenceAdmissionHost(state, this.artifacts);
    for (const priorAdmissionId of pass.request.priorEvidence.admissionIds) {
      const priorAdmission = state.generalizedParentArtifactAdmissions[priorAdmissionId];
      if (!priorAdmission) continue;
      const reopened = await admissionHost.reopen({
        report: priorAdmission.report,
        admission: { admissionId: priorAdmission.admissionId, receiptId: priorAdmission.receiptId, receiptContentId: priorAdmission.receiptContentId },
      });
      const supportedClaimIds = new Set(reopened.reportEnvelope.coverage
        .filter((entry) => entry.state === "supported" && overlaps(entry, executionRange))
        .flatMap((entry) => entry.claimIds));
      for (const claim of reopened.reportEnvelope.claims) {
        if (supportedClaimIds.has(claim.claimId) && overlaps(claim, executionRange)) priorStatements.add(claim.statement.normalize("NFC").trim());
      }
    }
    const newStatements = new Set(exactClaims.map((claim) => claim.statement.normalize("NFC").trim()));
    const attenuated = pass.request.delta.kind === "attenuated_subrange";
    const disagreement = attenuated && new Set([...priorStatements, ...newStatements]).size > 1;
    const passOperationIds = new Set(Object.values(state.semanticEvidence).filter((operation) => operation.taskId === taskId).map((operation) => operation.id));
    const supported = attenuated && pass.request.priorState !== "conflicting" && !disagreement && exactClaims.length === 1 && citationIds.length > 0 && newCitationIds.length === citationIds.length &&
      citations.length === newCitationIds.length && citations.every((citation) => citation.evidenceKind === "current_run_speech" && citation.use === "claim_support" && citation.operationId !== null && passOperationIds.has(citation.operationId));
    const disagreementCitationIds = attenuated && (pass.request.priorState === "conflicting" || disagreement)
      ? [...new Set([...pass.request.priorEvidence.citationIds, ...citationIds])].sort()
      : [];
    const execution = Object.values(state.executions).find((entry) => entry.taskId === taskId) ?? null;
    const usage = execution?.modelUsageReceiptId ? state.modelUsage[execution.modelUsageReceiptId] : null;
    const terminal: RangePassTerminalReceipt = {
      schema: "studio.study-range-pass-terminal.receipt.v1", receiptId: "pending", passId: pass.id, runId: state.runId,
      requestReceiptId: pass.requestReceiptId, requestReceiptContentId: pass.requestReceiptContentId,
      scheduler: { spawnRequestId: pass.spawnRequestId, taskId, agentId: pass.agentId! },
      evidence: { reportId: admission?.reportId ?? null, reportArtifactId: admission?.report.artifactId ?? null, reportContentId: admission?.report.contentId ?? null, admissionId: admission?.admissionId ?? null, readOperationId: read?.id ?? null, citationIds, newCitationIds: supported ? newCitationIds : [], disagreementCitationIds },
      measuredSpend: {
        executorActiveMs: execution?.receipt?.monotonicDurationMs ?? null,
        capabilityCalls: taskCapabilityCallCount(state, taskId),
        modelUsage: usage ? { state: "available", receiptId: usage.receiptId, measured: structuredClone(usage.measured) } : { state: "unavailable", reason: execution?.receipt?.producer.id === "studio.deterministic-test-executor" ? "deterministic_executor" : "executor_failed_before_usage" },
      },
      outcome: supported
        ? "supported_new_citations"
        : disagreement
          ? "withheld_exhausted"
          : terminalOutcome(attenuated ? exactCoverage?.state ?? null : pass.request.priorState, task.status),
      exhausted: !supported,
      nonClaims: { understanding: "not_claimed", improvement: "not_claimed", semanticCorrectness: "not_assessed" },
    };
    terminal.receiptId = receiptId("study-range-pass-terminal-receipt", terminal);
    validateRangePassTerminalReceipt(terminal);
    const stored = await this.artifacts.storeJson(terminal);
    await this.ledger.transact(
      { producer: { kind: "study_restudy_host", id: "range-pass-terminal-host" }, causationId: pass.id },
      ({ state: current }) => {
        const currentPass = current.rangePasses[pass.id];
        if (!currentPass?.accepted || currentPass.terminal) throw new Error("Range-pass terminal authority changed before recording");
        return { pending: [{ type: "study.restudy_pass_terminal_recorded", data: { receiptContentId: stored.content.contentId, receipt: terminal } }] satisfies PendingRuntimeEvent[], result: undefined };
      },
    );
    return terminal;
  }

  async reopen(pass: RangePassRecord): Promise<RangePassRecord> {
    return reopenRangePass(this.artifacts, pass);
  }
}
