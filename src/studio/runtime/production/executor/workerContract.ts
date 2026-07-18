import { COMPUTER_USE_LIMITS, isComputerUseHostArtifactKind, isConditionalSeparationHostArtifactKind, isFrameHostArtifactKind, isOcrHostArtifactKind, isResearchHostArtifactKind, isSpeakerOverlapHostArtifactKind, OCR_LIMITS, RESEARCH_CITATION_MAX_SPANS, RESEARCH_LIMITS, SPEAKER_OVERLAP_LIMITS, STUDY_REPORT_LIMITS, STUDY_REPORT_V2_LIMITS } from "../model.ts";
import type {
  GeneralizedCoverageReasonCode,
  ComputerUseEvidenceCitationInput,
  ComputerUseEvidenceSourceIdentity,
  GeneralizedCoverageRange,
  GeneralizedStudyClaim,
  OcrEvidenceCitationInput,
  ResearchEvidenceCitationInput,
  ResearchEvidenceSourceIdentity,
  SemanticEvidenceCitationInput,
  SpeakerOverlapEvidenceCitationInput,
  StudyClaim,
  StudyCoverageRange,
  StudyReportArtifact,
  StudyReportArtifactV2,
  TaskRecord,
} from "../model.ts";
import type { DialogueScopePolicy } from "../../../acoustic/dialogueScopePolicy.ts";
import type { VerifiedSemanticEvidence } from "../semantic/semanticEvidenceAudit.ts";
import type { VerifiedOcrAudit } from "../ocrAudit.ts";
import type { VerifiedSpeakerOverlapAudit } from "../speakerAudit.ts";
import type { VerifiedResearchSnapshotAudit } from "../research/researchAudit.ts";
import type { VerifiedComputerUseSession } from "../computerUse/computerUseAudit.ts";
import type { VerifiedVisualTransitionAudit } from "../visualTransitions/visualTransitionAudit.ts";
import {
  VISUAL_TRANSITION_LIMITS,
  isVisualTransitionHostArtifactKind,
  type VisualTransitionEvidenceCitationInput,
} from "../model/visualTransitions.ts";
import { currentRunSpeechCitation, ocrSpanCitation, speakerTurnCitation, visualTransitionCitation } from "../evidenceCitations/audit.ts";
import { externalDocumentSpanCitation } from "../research/researchCitation.ts";
import { externalScreenRegionCitation } from "../computerUse/computerUseCitation.ts";
import { deriveGeneralizedCoverageDecision } from "../admission/generalizedCoveragePolicy.ts";
import { validateSemanticEvidenceCitationInput } from "../validation/semanticEvidence.ts";
import { validateOcrEvidenceCitationInput } from "../validation/ocr.ts";
import { validateSpeakerOverlapEvidenceCitationInput } from "../validation/speakers.ts";
import { validateResearchEvidenceCitationInput } from "../validation/research.ts";
import { validateComputerUseEvidenceCitationInput } from "../validation/computerUse.ts";
import { validateVisualTransitionEvidenceCitationInput } from "../validation/visualTransitions.ts";
import { validateCoveragePartition, validateStudyReportArtifact } from "../validation/studyReports.ts";
import { validateStudyReportArtifactV2 } from "../validation/studyReportsV2.ts";
import { LauncherFailure } from "./launcherFailure.ts";
import type { ChildSemanticEvidenceToolResult } from "./childSemanticEvidenceBridge.ts";

export interface WorkerResult {
  summary: string;
  semanticEvidenceInputs: SemanticEvidenceCitationInput[];
  ocrEvidenceInputs: OcrEvidenceCitationInput[];
  visualTransitionEvidenceInputs: VisualTransitionEvidenceCitationInput[];
  speakerEvidenceInputs: SpeakerOverlapEvidenceCitationInput[];
  researchEvidenceInputs: ResearchEvidenceCitationInput[];
  computerUseEvidenceInputs: ComputerUseEvidenceCitationInput[];
  outputs: WorkerResultOutput[];
}

export type WorkerResultOutput =
  | { name: string; kind: string; content: string }
  | { name: string; kind: "studio.study-report.v1"; coverage: StudyCoverageRange[]; claims: StudyClaim[] }
  | { name: string; kind: "studio.study-report.v2"; coverage: StudyReportV2CoverageProposal[]; claims: StudyClaim[] };

export interface StudyReportV2CoverageProposal {
  artifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  claimIds: string[];
  reason: null | { code: Extract<GeneralizedCoverageReasonCode, "worker_withheld" | "operation_failed">; detail: string };
}

function studySourceArtifacts(task: TaskRecord, inputs: readonly SemanticEvidenceCitationInput[]) {
  return [
    { artifactId: task.jobContext.source.artifactId, contentId: task.jobContext.source.contentId },
    ...inputs.map((input) => ({ artifactId: input.artifactId, contentId: input.contentId }))
      .sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
  ];
}

export function buildStudyReportEnvelope(
  task: TaskRecord,
  output: Extract<WorkerResultOutput, { kind: "studio.study-report.v1" }>,
  semanticEvidenceInputs: SemanticEvidenceCitationInput[],
): StudyReportArtifact {
  if (!task.parentTaskId || !task.parentAgentId) throw new Error("Root tasks cannot create child study reports");
  return validateStudyReportArtifact({
    schema: "studio.study-report.v1",
    runId: task.runId,
    task: { taskId: task.id, agentId: task.assignedAgentId, jobContextId: task.jobContext.contextId },
    parent: { taskId: task.parentTaskId, agentId: task.parentAgentId },
    outputSlot: { name: output.name, artifactKind: "studio.study-report.v1" },
    assignment: { source: structuredClone(task.jobContext.source), mediaScope: structuredClone(task.mediaScope) },
    coverage: structuredClone(output.coverage),
    claims: structuredClone(output.claims),
    semanticEvidenceInputs: structuredClone(semanticEvidenceInputs),
    sourceArtifacts: studySourceArtifacts(task, semanticEvidenceInputs),
    limits: STUDY_REPORT_LIMITS,
    nonClaims: { correctness: "not_assessed", completeness: "partition_only", semanticQuality: "not_assessed" },
  });
}

export function buildStudyReportEnvelopeV2(input: {
  task: TaskRecord;
  executionId: string;
  output: Extract<WorkerResultOutput, { kind: "studio.study-report.v2" }>;
  semanticEvidenceInputs: SemanticEvidenceCitationInput[];
  verifiedSemanticEvidence: VerifiedSemanticEvidence[];
  ocrEvidenceInputs: OcrEvidenceCitationInput[];
  verifiedOcrEvidence: VerifiedOcrAudit[];
  visualTransitionEvidenceInputs?: VisualTransitionEvidenceCitationInput[];
  verifiedVisualTransitionEvidence?: VerifiedVisualTransitionAudit[];
  speakerEvidenceInputs?: SpeakerOverlapEvidenceCitationInput[];
  verifiedSpeakerEvidence?: VerifiedSpeakerOverlapAudit[];
  researchEvidenceInputs?: ResearchEvidenceCitationInput[];
  verifiedResearchEvidence?: VerifiedResearchSnapshotAudit[];
  computerUseEvidenceInputs?: ComputerUseEvidenceCitationInput[];
  verifiedComputerUseEvidence?: VerifiedComputerUseSession[];
  dialogueScopePolicy: DialogueScopePolicy | null;
}): StudyReportArtifactV2 {
  const { task, output } = input;
  if (!task.parentTaskId || !task.parentAgentId) throw new Error("Root tasks cannot create child study reports");
  const verifiedSpeakerEvidence = input.verifiedSpeakerEvidence ?? [];
  const verifiedVisualTransitionEvidence = input.verifiedVisualTransitionEvidence ?? [];
  const verifiedVisualTransitionByOperation = new Map(verifiedVisualTransitionEvidence.map((entry) => [entry.observations.operationId, entry]));
  for (const citationInput of input.visualTransitionEvidenceInputs ?? []) {
    const verified = verifiedVisualTransitionByOperation.get(citationInput.operationId);
    if (!verified || citationInput.observationsArtifactId !== verified.observationsArtifact.id ||
        citationInput.observationsContentId !== verified.observationsArtifact.content.contentId ||
        citationInput.receiptArtifactId !== verified.receiptArtifact.id ||
        citationInput.receiptId !== verified.receipt.receiptId ||
        citationInput.receiptContentId !== verified.receiptArtifact.content.contentId ||
        verified.receipt.authorization.taskId !== task.id ||
        verified.receipt.authorization.agentId !== task.assignedAgentId ||
        verified.receipt.authorization.executionId !== input.executionId ||
        JSON.stringify(citationInput.intervalIds) !== JSON.stringify(verified.observations.intervals.map((interval) => interval.intervalId))) {
      throw new Error(`Study report v2 visual-transition input ${citationInput.operationId} changed authenticated evidence identity`);
    }
  }
  if ((input.visualTransitionEvidenceInputs ?? []).length !== verifiedVisualTransitionEvidence.length) {
    throw new Error("Study report v2 visual-transition evidence echo does not close every verified operation");
  }
  const verifiedSpeakerByOperation = new Map(verifiedSpeakerEvidence.map((entry) => [entry.observations.operationId, entry]));
  for (const citationInput of input.speakerEvidenceInputs ?? []) {
    const verified = verifiedSpeakerByOperation.get(citationInput.operationId);
    if (!verified || citationInput.artifactId !== verified.observationsArtifact.id ||
        citationInput.contentId !== verified.observationsArtifact.content.contentId ||
        citationInput.receiptArtifactId !== verified.receiptArtifact.id ||
        citationInput.receiptId !== verified.receipt.receiptId ||
        citationInput.receiptContentId !== verified.receiptArtifact.content.contentId) {
      throw new Error(`Study report v2 speaker input ${citationInput.operationId} changed authenticated evidence identity`);
    }
  }
  if ((input.speakerEvidenceInputs ?? []).length !== verifiedSpeakerEvidence.length) {
    throw new Error("Study report v2 speaker evidence echo does not close every verified operation");
  }
  const verifiedByOperation = new Map(input.verifiedSemanticEvidence.map((entry) => [entry.operationId, entry]));
  const claimCitations = new Map<string, ReturnType<typeof currentRunSpeechCitation>[]>();
  for (const claim of output.claims) {
    const citations = claim.citations.map((citation) => {
      const verified = verifiedByOperation.get(citation.operationId);
      if (!verified || citation.artifactId !== verified.artifactId || citation.contentId !== verified.artifactContentId ||
          citation.receiptId !== verified.receiptId || citation.receiptContentId !== verified.receiptContentId) {
        throw new Error(`Study report v2 claim ${claim.claimId} changed authenticated speech evidence identity`);
      }
      return currentRunSpeechCitation({
        verified,
        target: { kind: "claim", claimId: claim.claimId, range: { artifactId: claim.artifactId, trackId: claim.trackId, startMs: claim.startMs, endMs: claim.endMs } },
        observationIds: citation.observations.map((entry) => entry.observationId),
      });
    });
    claimCitations.set(claim.claimId, citations);
  }
  const coverage: GeneralizedCoverageRange[] = [];
  const retainedClaims = new Set<string>();
  const coverageCitations: ReturnType<typeof currentRunSpeechCitation>[] = [];
  for (const proposal of output.coverage) {
    const range = { artifactId: proposal.artifactId, trackId: proposal.trackId, startMs: proposal.startMs, endMs: proposal.endMs };
    const speechCoverageCitations = proposal.claimIds.length === 0
      ? input.verifiedSemanticEvidence.map((verified) => currentRunSpeechCitation({
          verified,
          target: { kind: "coverage", range },
          observationIds: verified.envelope.observations
            .filter((entry) => entry.range.startMs >= range.startMs && entry.range.endMs <= range.endMs)
            .map((entry) => entry.observationId),
        }))
      : [];
    const speakerCoverageCitations = verifiedSpeakerEvidence
      .filter((verified) => verified.observations.source.artifactId === range.artifactId &&
        verified.observations.source.audioTrackId === range.trackId &&
        verified.observations.source.grantedRange.startMs <= range.startMs &&
        verified.observations.source.grantedRange.endMs >= range.endMs)
      .map((verified) => speakerTurnCitation({ verified, target: { kind: "coverage", range } }));
    const citations = [...speechCoverageCitations, ...speakerCoverageCitations];
    coverageCitations.push(...citations);
    const derived = deriveGeneralizedCoverageDecision({
      claimCount: proposal.claimIds.length,
      citations,
      dialogueScopePolicy: input.dialogueScopePolicy,
      range,
      declaredReasonCode: proposal.reason?.code ?? null,
    });
    const claimIds = derived.state === "supported" ? [...proposal.claimIds] : [];
    claimIds.forEach((id) => retainedClaims.add(id));
    coverage.push({
      ...range,
      state: derived.state,
      claimIds,
      citationIds: citations.map((entry) => entry.citationId),
      rawStates: derived.rawStates,
      reason: derived.reasonCode ? { code: derived.reasonCode, detail: proposal.reason?.detail ?? `Host-derived evidence state: ${derived.state}.` } : null,
    });
  }
  const claims: GeneralizedStudyClaim[] = output.claims
    .filter((claim) => retainedClaims.has(claim.claimId))
    .map((claim) => ({
      claimId: claim.claimId,
      artifactId: claim.artifactId,
      trackId: claim.trackId,
      startMs: claim.startMs,
      endMs: claim.endMs,
      statement: claim.statement,
      citationIds: (claimCitations.get(claim.claimId) ?? []).map((entry) => entry.citationId),
    }));
  const evidenceCitations = [...claimCitations.entries()]
    .filter(([claimId]) => retainedClaims.has(claimId))
    .flatMap(([, citations]) => citations)
    .concat(coverageCitations);
  const verifiedOcrByOperation = new Map(input.verifiedOcrEvidence.map((entry) => [entry.observations.operationId, entry]));
  const ocrCitations = input.ocrEvidenceInputs.map((citationInput) => {
    const verified = verifiedOcrByOperation.get(citationInput.operationId);
    if (!verified || citationInput.artifactId !== verified.observationsArtifact.id ||
        citationInput.contentId !== verified.observationsArtifact.content.contentId ||
        citationInput.receiptArtifactId !== verified.receiptArtifact.id ||
        citationInput.receiptId !== verified.receipt.receiptId ||
        citationInput.receiptContentId !== verified.receiptArtifact.content.contentId) {
      throw new Error(`Study report v2 OCR input ${citationInput.operationId} changed authenticated evidence identity`);
    }
    return ocrSpanCitation({
      verified,
      observationIds: citationInput.observationIds,
      target: {
        kind: "media_context",
        qualifiesMedia: {
          artifactId: verified.observations.source.artifactId,
          trackId: verified.observations.source.videoTrackId,
          startMs: verified.observations.source.grantedRange.startMs,
          endMs: verified.observations.source.grantedRange.endMs,
        },
      },
    });
  });
  evidenceCitations.push(...ocrCitations);
  const visualTransitionCitations = (input.visualTransitionEvidenceInputs ?? []).map((citationInput) => {
    const verified = verifiedVisualTransitionByOperation.get(citationInput.operationId)!;
    return visualTransitionCitation({
      verified,
      intervalIds: citationInput.intervalIds,
      target: {
        kind: "media_context",
        qualifiesMedia: {
          artifactId: verified.observations.source.artifactId,
          trackId: verified.observations.source.videoTrackId,
          startMs: verified.observations.source.grantedRange.startMs,
          endMs: verified.observations.source.grantedRange.endMs,
        },
      },
    });
  });
  evidenceCitations.push(...visualTransitionCitations);
  const verifiedResearchByOperation = new Map(
    (input.verifiedResearchEvidence ?? []).map((entry) => [entry.receipt.operationId, entry]),
  );
  const seenResearchOperations = new Set<string>();
  const researchCitations = (input.researchEvidenceInputs ?? []).map((candidate, index) => {
    const citationInput = validateResearchEvidenceCitationInput(
      candidate,
      "Study report v2 research input",
      `researchEvidenceInputs[${index}]`,
    );
    if (seenResearchOperations.has(citationInput.operationId)) {
      throw new Error(`Study report v2 research input ${citationInput.operationId} is duplicated`);
    }
    seenResearchOperations.add(citationInput.operationId);
    const verified = verifiedResearchByOperation.get(citationInput.operationId);
    const authorization = verified?.receipt.authorization;
    if (!verified ||
        citationInput.receiptArtifactId !== verified.receiptArtifactId ||
        citationInput.receiptContentId !== verified.receiptContentId ||
        citationInput.extractionArtifactId !== verified.extraction.artifactId ||
        citationInput.extractionContentId !== verified.extraction.contentId ||
        !authorization || !("executionId" in authorization) ||
        authorization.taskId !== task.id || authorization.agentId !== task.assignedAgentId ||
        authorization.executionId !== input.executionId) {
      throw new Error(`Study report v2 research input ${citationInput.operationId} changed authenticated snapshot identity`);
    }
    const qualifiesMedia = verified.receipt.gap.media;
    return externalDocumentSpanCitation({
      verified,
      target: {
        kind: "media_context",
        qualifiesMedia: {
          artifactId: qualifiesMedia.artifactId,
          trackId: qualifiesMedia.trackId,
          startMs: qualifiesMedia.startMs,
          endMs: qualifiesMedia.endMs,
        },
      },
      spans: citationInput.spans,
    });
  });
  evidenceCitations.push(...researchCitations);
  const verifiedComputerByOperation = new Map(
    (input.verifiedComputerUseEvidence ?? []).map((entry) => [entry.receipt.operationId, entry]),
  );
  const seenComputerScreenshots = new Set<string>();
  const computerUseCitations = (input.computerUseEvidenceInputs ?? []).map((candidate, index) => {
    const citationInput = validateComputerUseEvidenceCitationInput(candidate, "Study report v2 computer-use input", `computerUseEvidenceInputs[${index}]`);
    const verified = verifiedComputerByOperation.get(citationInput.operationId);
    const state = verified?.states.find((entry) => entry.identity.stateId === citationInput.stateId);
    if (!verified || !state || seenComputerScreenshots.has(citationInput.screenshotArtifactId) ||
        citationInput.sessionArtifactId !== verified.receiptArtifactId ||
        citationInput.sessionReceiptId !== verified.receipt.receiptId ||
        citationInput.sessionReceiptContentId !== verified.receiptContentId ||
        citationInput.screenshotArtifactId !== state.identity.screenshot.artifactId ||
        citationInput.screenshotContentId !== state.identity.screenshot.content.contentId) {
      throw new Error(`Study report v2 computer-use input ${citationInput.operationId} changed authenticated session state`);
    }
    seenComputerScreenshots.add(citationInput.screenshotArtifactId);
    return externalScreenRegionCitation({
      verified,
      stateId: citationInput.stateId,
      region: citationInput.region,
      target: { kind: "media_context", qualifiesMedia: {
        artifactId: verified.receipt.gap.media.artifactId,
        trackId: verified.receipt.gap.media.trackId,
        startMs: verified.receipt.gap.media.startMs,
        endMs: verified.receipt.gap.media.endMs,
      } },
    });
  });
  evidenceCitations.push(...computerUseCitations);
  const sourceMap = new Map<string, string>([[task.jobContext.source.artifactId, task.jobContext.source.contentId]]);
  for (const citation of evidenceCitations) {
    sourceMap.set(citation.evidence.artifactId, citation.evidence.contentId);
    if (citation.receipt.artifactId) sourceMap.set(citation.receipt.artifactId, citation.receipt.contentId);
  }
  return validateStudyReportArtifactV2({
    schema: "studio.study-report.v2",
    runId: task.runId,
    task: { taskId: task.id, agentId: task.assignedAgentId, executionId: input.executionId, jobContextId: task.jobContext.contextId },
    parent: { taskId: task.parentTaskId, agentId: task.parentAgentId },
    assignment: { source: structuredClone(task.jobContext.source), mediaScope: structuredClone(task.mediaScope) },
    coverage,
    claims,
    evidenceCitations,
    sourceArtifacts: [...sourceMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([artifactId, contentId]) => ({ artifactId, contentId })),
    limits: STUDY_REPORT_V2_LIMITS,
    nonClaims: { correctness: "not_assessed", completeness: "partition_only", semanticQuality: "not_assessed", modalityReliabilityEquivalence: "not_claimed", independentCorroboration: "not_assessed" },
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function validateWorkerResult(
  value: unknown,
  task: TaskRecord,
  expectedSemanticEvidenceInputs: SemanticEvidenceCitationInput[] = [],
  expectedOcrEvidenceInputs: OcrEvidenceCitationInput[] = [],
  expectedSpeakerEvidenceInputs: SpeakerOverlapEvidenceCitationInput[] = [],
  expectedResearchEvidenceInputs: ResearchEvidenceSourceIdentity[] = [],
  expectedComputerUseEvidenceInputs: ComputerUseEvidenceSourceIdentity[] = [],
  expectedVisualTransitionEvidenceInputs: VisualTransitionEvidenceCitationInput[] = [],
  options: WorkerResultValidationOptions = {},
): WorkerResult {
  const item = record(value);
  if (task.requiredOutputs.some((output) => isFrameHostArtifactKind(output.artifactKind) || isOcrHostArtifactKind(output.artifactKind) || isVisualTransitionHostArtifactKind(output.artifactKind) || isSpeakerOverlapHostArtifactKind(output.artifactKind) || isConditionalSeparationHostArtifactKind(output.artifactKind) || isResearchHostArtifactKind(output.artifactKind) || isComputerUseHostArtifactKind(output.artifactKind))) {
    throw new LauncherFailure(
      "Worker contract requests a host-only frame artifact kind",
      "Codex worker response failed its output authority contract.",
    );
  }
  const semanticGranted = task.grants.some((grant) => grant.capability === "speech.transcribe");
  const ocrGranted = task.grants.some((grant) => grant.capability === "media.frames.ocr");
  const visualTransitionGranted = task.grants.some((grant) => grant.capability === "media.visual-transitions.analyze");
  const speakerGranted = task.grants.some((grant) => grant.capability === "media.speakers.analyze");
  const researchGranted = task.grants.some((grant) => grant.capability === "research.investigate");
  const computerUseGranted = task.grants.some((grant) => grant.capability === "computer.use.readonly");
  const hostSuppliedSemanticEvidenceInputs = options.hostSuppliedSemanticEvidenceInputs ?? false;
  if (hostSuppliedSemanticEvidenceInputs && !semanticGranted) {
    throw new LauncherFailure(
      "Host cannot attach semantic evidence without a worker grant",
      "Codex worker response failed its semantic evidence citation contract.",
    );
  }
  const allowedKeys = new Set(["summary", "outputs", ...(semanticGranted && !hostSuppliedSemanticEvidenceInputs ? ["semanticEvidenceInputs"] : []), ...(ocrGranted ? ["ocrEvidenceInputs"] : []), ...(visualTransitionGranted ? ["visualTransitionEvidenceInputs"] : []), ...(speakerGranted ? ["speakerEvidenceInputs"] : []), ...(researchGranted ? ["researchEvidenceInputs"] : []), ...(computerUseGranted ? ["computerUseEvidenceInputs"] : [])]);
  if (!item || Object.keys(item).some((key) => !allowedKeys.has(key))) {
    throw new LauncherFailure(
      "Worker result must contain only summary and outputs",
      "Codex worker response failed its output contract.",
    );
  }
  if (
    typeof item.summary !== "string" ||
    item.summary.trim().length === 0 ||
    item.summary.length > 2_000
  ) {
    throw new LauncherFailure(
      "Worker summary is missing or too long",
      "Codex worker response failed its output contract.",
    );
  }
  if (!Array.isArray(item.outputs)) {
    throw new LauncherFailure(
      "Worker outputs must be an array",
      "Codex worker response failed its output contract.",
    );
  }
  let semanticEvidenceInputs: SemanticEvidenceCitationInput[] = [];
  if (semanticGranted) {
    if (hostSuppliedSemanticEvidenceInputs) {
      if (expectedSemanticEvidenceInputs.length === 0) {
        throw new LauncherFailure(
          "Host-supplied semantic evidence is empty",
          "Codex worker response failed its semantic evidence citation contract.",
        );
      }
      try {
        semanticEvidenceInputs = expectedSemanticEvidenceInputs.map((input, index) =>
          validateSemanticEvidenceCitationInput(input, "Host", `semanticEvidenceInputs[${index}]`));
      } catch (error) {
        throw new LauncherFailure(
          `Host semantic evidence citation is invalid: ${error instanceof Error ? error.message : "invalid citation"}`,
          "Codex worker response failed its semantic evidence citation contract.",
        );
      }
    } else if (!Array.isArray(item.semanticEvidenceInputs)) {
      throw new LauncherFailure(
        "Semantic-consuming worker omitted its structured evidence input list",
        "Codex worker response failed its semantic evidence citation contract.",
      );
    } else try {
      semanticEvidenceInputs = item.semanticEvidenceInputs.map((input, index) =>
        validateSemanticEvidenceCitationInput(input, "Worker result", `semanticEvidenceInputs[${index}]`));
    } catch (error) {
      throw new LauncherFailure(
        `Worker semantic evidence citation is invalid: ${error instanceof Error ? error.message : "invalid citation"}`,
        "Codex worker response failed its semantic evidence citation contract.",
      );
    }
    if (!hostSuppliedSemanticEvidenceInputs && JSON.stringify(semanticEvidenceInputs) !== JSON.stringify(expectedSemanticEvidenceInputs)) {
      throw new LauncherFailure(
        "Worker semantic evidence citations do not equal the authenticated current-task observations",
        "Codex worker response failed its semantic evidence citation contract.",
      );
    }
  } else if (expectedSemanticEvidenceInputs.length !== 0) {
    throw new LauncherFailure(
      "Host supplied semantic evidence without a worker grant",
      "Codex worker response failed its semantic evidence citation contract.",
    );
  }
  let ocrEvidenceInputs: OcrEvidenceCitationInput[] = [];
  if (ocrGranted) {
    if (!Array.isArray(item.ocrEvidenceInputs)) {
      throw new LauncherFailure(
        "OCR-consuming worker omitted its structured evidence input list",
        "Codex worker response failed its OCR evidence citation contract.",
      );
    }
    try {
      ocrEvidenceInputs = item.ocrEvidenceInputs.map((input, index) =>
        validateOcrEvidenceCitationInput(input, "Worker result", `ocrEvidenceInputs[${index}]`));
    } catch (error) {
      throw new LauncherFailure(
        `Worker OCR evidence citation is invalid: ${error instanceof Error ? error.message : "invalid citation"}`,
        "Codex worker response failed its OCR evidence citation contract.",
      );
    }
    if (JSON.stringify(ocrEvidenceInputs) !== JSON.stringify(expectedOcrEvidenceInputs)) {
      throw new LauncherFailure(
        "Worker OCR evidence citations do not equal the authenticated current-task observations",
        "Codex worker response failed its OCR evidence citation contract.",
      );
    }
  } else if (expectedOcrEvidenceInputs.length !== 0) {
    throw new LauncherFailure(
      "Host supplied OCR evidence without a worker grant",
      "Codex worker response failed its OCR evidence citation contract.",
    );
  }
  let visualTransitionEvidenceInputs: VisualTransitionEvidenceCitationInput[] = [];
  if (visualTransitionGranted) {
    if (!Array.isArray(item.visualTransitionEvidenceInputs)) {
      throw new LauncherFailure(
        "Visual-transition-consuming worker omitted its structured evidence input list",
        "Codex worker response failed its visual-transition evidence citation contract.",
      );
    }
    try {
      visualTransitionEvidenceInputs = item.visualTransitionEvidenceInputs.map((input, index) =>
        validateVisualTransitionEvidenceCitationInput(input, "Worker result", `visualTransitionEvidenceInputs[${index}]`));
    } catch (error) {
      throw new LauncherFailure(
        `Worker visual-transition evidence citation is invalid: ${error instanceof Error ? error.message : "invalid citation"}`,
        "Codex worker response failed its visual-transition evidence citation contract.",
      );
    }
    if (JSON.stringify(visualTransitionEvidenceInputs) !== JSON.stringify(expectedVisualTransitionEvidenceInputs)) {
      throw new LauncherFailure(
        "Worker visual-transition evidence citations do not equal the authenticated current-task intervals",
        "Codex worker response failed its visual-transition evidence citation contract.",
      );
    }
  } else if (expectedVisualTransitionEvidenceInputs.length !== 0) {
    throw new LauncherFailure(
      "Host supplied visual-transition evidence without a worker grant",
      "Codex worker response failed its visual-transition evidence citation contract.",
    );
  }
  let speakerEvidenceInputs: SpeakerOverlapEvidenceCitationInput[] = [];
  if (speakerGranted) {
    if (!Array.isArray(item.speakerEvidenceInputs)) {
      throw new LauncherFailure(
        "Speaker/overlap-consuming worker omitted its structured evidence input list",
        "Codex worker response failed its speaker/overlap evidence citation contract.",
      );
    }
    try {
      speakerEvidenceInputs = item.speakerEvidenceInputs.map((input, index) =>
        validateSpeakerOverlapEvidenceCitationInput(input, "Worker result", `speakerEvidenceInputs[${index}]`));
    } catch (error) {
      throw new LauncherFailure(
        `Worker speaker/overlap evidence citation is invalid: ${error instanceof Error ? error.message : "invalid citation"}`,
        "Codex worker response failed its speaker/overlap evidence citation contract.",
      );
    }
    if (JSON.stringify(speakerEvidenceInputs) !== JSON.stringify(expectedSpeakerEvidenceInputs)) {
      throw new LauncherFailure(
        "Worker speaker/overlap citations do not equal the authenticated current-task artifact identities",
        "Codex worker response failed its speaker/overlap evidence citation contract.",
      );
    }
  } else if (expectedSpeakerEvidenceInputs.length !== 0) {
    throw new LauncherFailure(
      "Host supplied speaker/overlap evidence without a worker grant",
      "Codex worker response failed its speaker/overlap evidence citation contract.",
    );
  }
  let researchEvidenceInputs: ResearchEvidenceCitationInput[] = [];
  if (researchGranted) {
    if (!Array.isArray(item.researchEvidenceInputs)) {
      throw new LauncherFailure(
        "Research-consuming worker omitted its structured snapshot evidence input list",
        "Codex worker response failed its research evidence citation contract.",
      );
    }
    if (item.researchEvidenceInputs.length > RESEARCH_LIMITS.maxDocuments) {
      throw new LauncherFailure(
        "Worker research evidence citations exceed the closed snapshot count",
        "Codex worker response failed its research evidence citation contract.",
      );
    }
    try {
      researchEvidenceInputs = item.researchEvidenceInputs.map((input, index) =>
        validateResearchEvidenceCitationInput(input, "Worker result", `researchEvidenceInputs[${index}]`));
    } catch (error) {
      throw new LauncherFailure(
        `Worker research evidence citation is invalid: ${error instanceof Error ? error.message : "invalid citation"}`,
        "Codex worker response failed its research evidence citation contract.",
      );
    }
    const expectedByOperation = new Map(expectedResearchEvidenceInputs.map((entry) => [entry.operationId, entry]));
    if (expectedByOperation.size !== expectedResearchEvidenceInputs.length) {
      throw new LauncherFailure(
        "Host supplied duplicate research snapshot identities",
        "Codex worker response failed its research evidence citation contract.",
      );
    }
    const seenOperations = new Set<string>();
    for (const input of researchEvidenceInputs) {
      const expected = expectedByOperation.get(input.operationId);
      if (seenOperations.has(input.operationId) || !expected ||
          input.receiptArtifactId !== expected.receiptArtifactId ||
          input.receiptContentId !== expected.receiptContentId ||
          input.extractionArtifactId !== expected.extractionArtifactId ||
          input.extractionContentId !== expected.extractionContentId) {
        throw new LauncherFailure(
          "Worker research evidence citations do not name unique authenticated current-task snapshots",
          "Codex worker response failed its research evidence citation contract.",
        );
      }
      seenOperations.add(input.operationId);
    }
  } else if (expectedResearchEvidenceInputs.length !== 0) {
    throw new LauncherFailure(
      "Host supplied research evidence without a worker grant",
      "Codex worker response failed its research evidence citation contract.",
    );
  }
  let computerUseEvidenceInputs: ComputerUseEvidenceCitationInput[] = [];
  if (computerUseGranted) {
    if (!Array.isArray(item.computerUseEvidenceInputs) || item.computerUseEvidenceInputs.length > COMPUTER_USE_LIMITS.maxScreenshots) {
      throw new LauncherFailure("Computer-use worker omitted or exceeded its structured screen-region list", "Codex worker response failed its external-screen citation contract.");
    }
    try {
      computerUseEvidenceInputs = item.computerUseEvidenceInputs.map((entry, index) =>
        validateComputerUseEvidenceCitationInput(entry, "Worker result", `computerUseEvidenceInputs[${index}]`));
    } catch (error) {
      throw new LauncherFailure(`Worker external-screen citation is invalid: ${error instanceof Error ? error.message : "invalid citation"}`, "Codex worker response failed its external-screen citation contract.");
    }
    const expectedByOperation = new Map(expectedComputerUseEvidenceInputs.map((entry) => [entry.operationId, entry]));
    const seenScreenshots = new Set<string>();
    for (const candidate of computerUseEvidenceInputs) {
      const expected = expectedByOperation.get(candidate.operationId);
      const screenshot = expected?.screenshots.find((entry) => entry.stateId === candidate.stateId);
      if (!expected || !screenshot || seenScreenshots.has(candidate.screenshotArtifactId) ||
          candidate.sessionArtifactId !== expected.sessionArtifactId || candidate.sessionReceiptId !== expected.sessionReceiptId ||
          candidate.sessionReceiptContentId !== expected.sessionReceiptContentId ||
          candidate.screenshotArtifactId !== screenshot.artifactId || candidate.screenshotContentId !== screenshot.contentId ||
          candidate.region.x + candidate.region.width > screenshot.width || candidate.region.y + candidate.region.height > screenshot.height) {
        throw new LauncherFailure("Worker external-screen citations do not name unique authenticated current-task screenshot regions", "Codex worker response failed its external-screen citation contract.");
      }
      seenScreenshots.add(candidate.screenshotArtifactId);
    }
  } else if (expectedComputerUseEvidenceInputs.length !== 0) {
    throw new LauncherFailure("Host supplied external-screen evidence without a worker grant", "Codex worker response failed its external-screen citation contract.");
  }
  const required = task.requiredOutputs.filter((output) => output.required);
  if (item.outputs.length !== required.length) {
    throw new LauncherFailure(
      "Worker output count does not match the required contract",
      "Codex worker response failed its output contract.",
    );
  }

  const outputs: WorkerResultOutput[] = item.outputs.map((candidate, index) => {
    const output = record(candidate);
    const isStudy = output?.kind === "studio.study-report.v1" || output?.kind === "studio.study-report.v2";
    const allowed = isStudy ? ["name", "kind", "coverage", "claims"] : ["name", "kind", "content"];
    if (!output || Object.keys(output).some((key) => !allowed.includes(key)) || allowed.some((key) => !(key in output))) {
      throw new LauncherFailure(
        `Worker output ${index + 1} has an open shape`,
        "Codex worker response failed its output contract.",
      );
    }
    if (isStudy) {
      if (typeof output.name !== "string") throw new LauncherFailure(`Worker study output ${index + 1} is invalid`, "Codex worker response failed its typed study-report contract.");
      if (output.kind === "studio.study-report.v2") {
        if (!Array.isArray(output.coverage) || !Array.isArray(output.claims)) throw new LauncherFailure(`Worker study output ${index + 1} is invalid`, "Codex worker response failed its typed study-report-v2 contract.");
        return { name: output.name, kind: "studio.study-report.v2", coverage: output.coverage as StudyReportV2CoverageProposal[], claims: output.claims as StudyClaim[] };
      }
      let envelope: StudyReportArtifact;
      try {
        envelope = buildStudyReportEnvelope(task, {
          name: output.name,
          kind: "studio.study-report.v1",
          coverage: output.coverage as StudyCoverageRange[],
          claims: output.claims as StudyClaim[],
        }, semanticEvidenceInputs);
        validateCoveragePartition(envelope.coverage, task.mediaScope, "Worker study report coverage");
      } catch (error) {
        throw new LauncherFailure(
          `Worker study report is invalid: ${error instanceof Error ? error.message : "invalid typed report"}`,
          "Codex worker response failed its typed study-report contract.",
        );
      }
      const expectedByOperation = new Map(semanticEvidenceInputs.map((input) => [input.operationId, input]));
      for (const claim of envelope.claims) for (const citation of claim.citations) {
        const expected = expectedByOperation.get(citation.operationId);
        if (!expected || citation.artifactId !== expected.artifactId || citation.contentId !== expected.contentId ||
            citation.receiptId !== expected.receiptId || citation.receiptContentId !== expected.receiptContentId ||
            citation.observations.some((observation) => !expected.observations.some((candidate) =>
              candidate.observationId === observation.observationId && candidate.startMs === observation.startMs && candidate.endMs === observation.endMs))) {
          throw new LauncherFailure("Worker study claim contains an unsupported semantic citation", "Codex worker response failed its typed study-report citation contract.");
        }
      }
      return { name: output.name, kind: "studio.study-report.v1", coverage: envelope.coverage, claims: envelope.claims };
    }
    if (
      typeof output.name !== "string" ||
      typeof output.kind !== "string" ||
      typeof output.content !== "string" ||
      output.content.trim().length === 0 ||
      output.content.length > 8_000
    ) {
      throw new LauncherFailure(
        `Worker output ${index + 1} is invalid`,
        "Codex worker response failed its output contract.",
      );
    }
    return { name: output.name, kind: output.kind, content: output.content };
  });

  const byName = new Map(outputs.map((output) => [output.name, output]));
  if (
    byName.size !== outputs.length ||
    required.some((contract) => byName.get(contract.name)?.kind !== contract.artifactKind)
  ) {
    throw new LauncherFailure(
      "Worker outputs do not match their named artifact contracts",
      "Codex worker response failed its output contract.",
    );
  }
  return { summary: item.summary, semanticEvidenceInputs, ocrEvidenceInputs, visualTransitionEvidenceInputs, speakerEvidenceInputs, researchEvidenceInputs, computerUseEvidenceInputs, outputs };
}

export interface WorkerResultValidationOptions {
  hostSuppliedSemanticEvidenceInputs?: boolean;
}

export interface WorkerOutputSchemaOptions {
  hostSuppliedSemanticEvidenceInputs?: boolean;
}

export function workerOutputSchema(task: TaskRecord, options: WorkerOutputSchemaOptions = {}): Record<string, unknown> {
  if (task.requiredOutputs.some((output) => isFrameHostArtifactKind(output.artifactKind) || isOcrHostArtifactKind(output.artifactKind) || isVisualTransitionHostArtifactKind(output.artifactKind) || isSpeakerOverlapHostArtifactKind(output.artifactKind) || isConditionalSeparationHostArtifactKind(output.artifactKind) || isResearchHostArtifactKind(output.artifactKind) || isComputerUseHostArtifactKind(output.artifactKind))) {
    throw new LauncherFailure(
      "Worker contract requests a host-only frame artifact kind",
      "Codex worker output schema cannot impersonate a host frame artifact.",
    );
  }
  const required = task.requiredOutputs.filter((output) => output.required);
  const semanticGranted = task.grants.some((grant) => grant.capability === "speech.transcribe");
  const hostSuppliedSemanticEvidenceInputs = options.hostSuppliedSemanticEvidenceInputs ?? false;
  if (hostSuppliedSemanticEvidenceInputs && !semanticGranted) {
    throw new LauncherFailure(
      "Host cannot attach semantic evidence without a worker grant",
      "Codex worker output schema cannot attach ungranted semantic evidence.",
    );
  }
  const modelSuppliesSemanticEvidenceInputs = semanticGranted && !hostSuppliedSemanticEvidenceInputs;
  const ocrGranted = task.grants.some((grant) => grant.capability === "media.frames.ocr");
  const visualTransitionGranted = task.grants.some((grant) => grant.capability === "media.visual-transitions.analyze");
  const speakerGranted = task.grants.some((grant) => grant.capability === "media.speakers.analyze");
  const researchGranted = task.grants.some((grant) => grant.capability === "research.investigate");
  const computerUseGranted = task.grants.some((grant) => grant.capability === "computer.use.readonly");
  const semanticEvidenceInputs = {
    type: "array",
    minItems: 1,
    maxItems: 16,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        operationId: { type: "string", minLength: 1 },
        artifactId: { type: "string", minLength: 1 },
        contentId: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        receiptId: { type: "string", minLength: 1 },
        receiptContentId: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        observations: {
          type: "array",
          maxItems: 64,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              observationId: { type: "string", minLength: 1 },
              startMs: { type: "integer", minimum: 0 },
              endMs: { type: "integer", minimum: 1 },
            },
            required: ["observationId", "startMs", "endMs"],
          },
        },
      },
      required: ["operationId", "artifactId", "contentId", "receiptId", "receiptContentId", "observations"],
    },
  };
  const citation = (semanticEvidenceInputs.items as Record<string, unknown>);
  const ocrEvidenceInputs = {
    type: "array",
    minItems: 0,
    maxItems: OCR_LIMITS.maxCalls,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        operationId: { type: "string", minLength: 1 },
        artifactId: { type: "string", minLength: 1 },
        contentId: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        receiptArtifactId: { type: "string", minLength: 1 },
        receiptId: { type: "string", minLength: 1 },
        receiptContentId: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        observationIds: { type: "array", minItems: 0, maxItems: OCR_LIMITS.maxTotalBoxes, items: { type: "string", minLength: 1 } },
      },
      required: ["operationId", "artifactId", "contentId", "receiptArtifactId", "receiptId", "receiptContentId", "observationIds"],
    },
  };
  const visualTransitionEvidenceInputs = {
    type: "array",
    minItems: 0,
    maxItems: VISUAL_TRANSITION_LIMITS.maxCalls,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        operationId: { type: "string", minLength: 1 },
        observationsArtifactId: { type: "string", minLength: 1 },
        observationsContentId: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        receiptArtifactId: { type: "string", minLength: 1 },
        receiptId: { type: "string", minLength: 1 },
        receiptContentId: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        intervalIds: { type: "array", minItems: 1, maxItems: VISUAL_TRANSITION_LIMITS.maxFrames - 1, items: { type: "string", minLength: 1 } },
      },
      required: ["operationId", "observationsArtifactId", "observationsContentId", "receiptArtifactId", "receiptId", "receiptContentId", "intervalIds"],
    },
  };
  const speakerEvidenceInputs = {
    type: "array",
    minItems: 0,
    maxItems: SPEAKER_OVERLAP_LIMITS.maxCalls,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        operationId: { type: "string", minLength: 1 },
        artifactId: { type: "string", minLength: 1 },
        contentId: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        receiptArtifactId: { type: "string", minLength: 1 },
        receiptId: { type: "string", minLength: 1 },
        receiptContentId: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
      },
      required: ["operationId", "artifactId", "contentId", "receiptArtifactId", "receiptId", "receiptContentId"],
    },
  };
  const researchEvidenceInputs = {
    type: "array",
    minItems: 0,
    maxItems: RESEARCH_LIMITS.maxDocuments,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        operationId: { type: "string", minLength: 1 },
        receiptArtifactId: { type: "string", minLength: 1 },
        receiptContentId: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        extractionArtifactId: { type: "string", minLength: 1 },
        extractionContentId: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        spans: {
          type: "array",
          minItems: 1,
          maxItems: RESEARCH_CITATION_MAX_SPANS,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              start: { type: "integer", minimum: 0 },
              end: { type: "integer", minimum: 1 },
            },
            required: ["start", "end"],
          },
        },
      },
      required: ["operationId", "receiptArtifactId", "receiptContentId", "extractionArtifactId", "extractionContentId", "spans"],
    },
  };
  const computerUseEvidenceInputs = {
    type: "array",
    minItems: 0,
    maxItems: COMPUTER_USE_LIMITS.maxScreenshots,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        operationId: { type: "string", minLength: 1 },
        sessionArtifactId: { type: "string", minLength: 1 },
        sessionReceiptId: { type: "string", minLength: 1 },
        sessionReceiptContentId: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        stateId: { type: "string", minLength: 1 },
        screenshotArtifactId: { type: "string", minLength: 1 },
        screenshotContentId: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        region: {
          type: "object", additionalProperties: false,
          properties: {
            x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 },
            width: { type: "integer", minimum: 1 }, height: { type: "integer", minimum: 1 },
          },
          required: ["x", "y", "width", "height"],
        },
      },
      required: ["operationId", "sessionArtifactId", "sessionReceiptId", "sessionReceiptContentId", "stateId", "screenshotArtifactId", "screenshotContentId", "region"],
    },
  };
  const coverage = {
    type: "array", minItems: 1, maxItems: STUDY_REPORT_LIMITS.maxRanges,
    items: {
      type: "object", additionalProperties: false,
      properties: {
        artifactId: { type: "string", minLength: 1 }, trackId: { type: "string", minLength: 1 },
        startMs: { type: "integer", minimum: 0 }, endMs: { type: "integer", minimum: 1 },
        state: { type: "string", enum: ["supported", "withheld", "unknown", "failed"] },
        claimIds: { type: "array", maxItems: STUDY_REPORT_LIMITS.maxClaims, items: { type: "string", minLength: 1 } },
        reason: { anyOf: [
          { type: "null" },
          { type: "object", additionalProperties: false, properties: {
            code: { type: "string", enum: ["semantic_evidence_unavailable", "semantic_evidence_empty", "insufficient_semantic_evidence", "worker_withheld", "operation_failed", "unobserved_range"] },
            detail: { type: "string", minLength: 1, maxLength: 2_000 },
          }, required: ["code", "detail"] },
        ] },
      },
      required: ["artifactId", "trackId", "startMs", "endMs", "state", "claimIds", "reason"],
    },
  };
  const claims = {
    type: "array", maxItems: STUDY_REPORT_LIMITS.maxClaims,
    items: {
      type: "object", additionalProperties: false,
      properties: {
        claimId: { type: "string", minLength: 1 }, artifactId: { type: "string", minLength: 1 },
        trackId: { type: "string", minLength: 1 }, startMs: { type: "integer", minimum: 0 },
        endMs: { type: "integer", minimum: 1 }, statement: { type: "string", minLength: 1, maxLength: 8_000 },
        citations: { type: "array", minItems: 1, maxItems: STUDY_REPORT_LIMITS.maxCitations, items: citation },
      },
      required: ["claimId", "artifactId", "trackId", "startMs", "endMs", "statement", "citations"],
    },
  };
  const generalizedCoverage = {
    type: "array", minItems: 1, maxItems: STUDY_REPORT_V2_LIMITS.maxRanges,
    items: { type: "object", additionalProperties: false, properties: {
      artifactId: { type: "string", minLength: 1 }, trackId: { type: "string", minLength: 1 },
      startMs: { type: "integer", minimum: 0 }, endMs: { type: "integer", minimum: 1 },
      claimIds: { type: "array", maxItems: STUDY_REPORT_V2_LIMITS.maxClaims, items: { type: "string", minLength: 1 } },
      reason: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, properties: {
        code: { type: "string", enum: ["worker_withheld", "operation_failed"] }, detail: { type: "string", minLength: 1, maxLength: 2_000 },
      }, required: ["code", "detail"] }] },
    }, required: ["artifactId", "trackId", "startMs", "endMs", "claimIds", "reason"] },
  };
  const requiredOutputSchemas = required.map((output) => output.artifactKind === "studio.study-report.v1"
        ? { type: "object", additionalProperties: false, properties: {
            name: { type: "string", const: output.name }, kind: { type: "string", const: "studio.study-report.v1" }, coverage, claims,
          }, required: ["name", "kind", "coverage", "claims"] }
        : output.artifactKind === "studio.study-report.v2"
          ? { type: "object", additionalProperties: false, properties: {
              name: { type: "string", const: output.name }, kind: { type: "string", const: "studio.study-report.v2" }, coverage: generalizedCoverage, claims,
            }, required: ["name", "kind", "coverage", "claims"] }
        : { type: "object", additionalProperties: false, properties: {
            name: { type: "string", const: output.name }, kind: { type: "string", const: output.artifactKind }, content: { type: "string", minLength: 1, maxLength: 8_000 },
          }, required: ["name", "kind", "content"] });
  const outputItems = required.some((output) => output.artifactKind === "studio.study-report.v1" || output.artifactKind === "studio.study-report.v2")
    ? requiredOutputSchemas.length === 1 ? requiredOutputSchemas[0] : { anyOf: requiredOutputSchemas }
    : {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", enum: required.map((output) => output.name) },
          kind: { type: "string", enum: required.map((output) => output.artifactKind) },
          content: { type: "string", minLength: 1, maxLength: 8_000 },
        },
        required: ["name", "kind", "content"],
      };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string", minLength: 1, maxLength: 2_000 },
      ...(modelSuppliesSemanticEvidenceInputs ? { semanticEvidenceInputs } : {}),
      ...(ocrGranted ? { ocrEvidenceInputs } : {}),
      ...(visualTransitionGranted ? { visualTransitionEvidenceInputs } : {}),
      ...(speakerGranted ? { speakerEvidenceInputs } : {}),
      ...(researchGranted ? { researchEvidenceInputs } : {}),
      ...(computerUseGranted ? { computerUseEvidenceInputs } : {}),
      outputs: {
        type: "array",
        minItems: required.length,
        maxItems: required.length,
        items: outputItems,
      },
    },
    required: ["summary", ...(modelSuppliesSemanticEvidenceInputs ? ["semanticEvidenceInputs"] : []), ...(ocrGranted ? ["ocrEvidenceInputs"] : []), ...(visualTransitionGranted ? ["visualTransitionEvidenceInputs"] : []), ...(speakerGranted ? ["speakerEvidenceInputs"] : []), ...(researchGranted ? ["researchEvidenceInputs"] : []), ...(computerUseGranted ? ["computerUseEvidenceInputs"] : []), "outputs"],
  };
}

export interface WorkerPromptOptions {
  precompletedSemanticEvidence?: ChildSemanticEvidenceToolResult | null;
}

export function workerPrompt(task: TaskRecord, options: WorkerPromptOptions = {}): string {
  const mediaTools = task.grants.flatMap((grant) =>
    grant.capability === "media.extract"
      ? ["media_extract"]
      : grant.capability === "media.seek"
        ? ["media_seek"]
        : grant.capability === "media.frames.sample"
          ? ["media_frames_sample"]
          : grant.capability === "media.frames.ocr"
            ? ["media_frames_ocr"]
          : grant.capability === "media.visual-transitions.analyze"
            ? ["media_visual_transitions_analyze"]
          : grant.capability === "media.speakers.analyze"
            ? ["media_speakers_analyze"]
          : grant.capability === "media.audio.separate"
            ? ["media_audio_separate"]
        : []);
  const frameSampling = task.grants
    .filter((grant) => grant.capability === "media.frames.sample")
    .map((grant) => ({
      mediaScope: grant.mediaScope,
      limits: grant.frameScope.limits,
    }));
  const semanticScope = task.grants
    .filter((grant) => grant.capability === "speech.transcribe")
    .flatMap((grant) => grant.mediaScope);
  const precompletedSemanticEvidence = options.precompletedSemanticEvidence ?? null;
  if (precompletedSemanticEvidence && semanticScope.length !== 1) {
    throw new Error("Precompleted semantic evidence requires one exact speech.transcribe grant range");
  }
  const contract = {
    taskId: task.id,
    jobContext: task.jobContext,
    objective: task.objective,
    workerKind: task.workerKind,
    requiredOutputs: task.requiredOutputs.filter((output) => output.required),
    inputArtifactIds: task.inputArtifactIds,
    mediaScope: task.mediaScope,
    budget: task.budget,
    grantedMediaTools: mediaTools,
    grantedFrameSampling: frameSampling,
    grantedOcr: task.grants
      .filter((grant) => grant.capability === "media.frames.ocr")
      .map((grant) => ({ mediaScope: grant.mediaScope, limits: grant.ocrScope?.limits ?? null })),
    grantedVisualTransitions: task.grants
      .filter((grant) => grant.capability === "media.visual-transitions.analyze")
      .map((grant) => ({ mediaScope: grant.mediaScope, limits: grant.visualTransitionScope?.limits ?? null })),
    grantedAnonymousSpeakers: task.grants
      .filter((grant) => grant.capability === "media.speakers.analyze")
      .map((grant) => ({ mediaScope: grant.mediaScope, limits: grant.speakerScope?.limits ?? null })),
    grantedConditionalSeparation: task.grants
      .filter((grant) => grant.capability === "media.audio.separate")
      .map((grant) => ({ mediaScope: grant.mediaScope, trigger: grant.separationScope?.trigger ?? null, limits: grant.separationScope?.limits ?? null })),
    grantedResearch: task.grants
      .filter((grant) => grant.capability === "research.investigate")
      .map((grant) => ({ gap: grant.researchScope?.gap ?? null, allowedDomains: grant.researchScope?.allowedDomains ?? [], limits: grant.researchScope?.limits ?? null })),
    grantedComputerUse: task.grants
      .filter((grant) => grant.capability === "computer.use.readonly")
      .map((grant) => ({ gap: grant.computerUseScope?.gap ?? null, cause: grant.computerUseScope?.r1Cause ?? null, surface: grant.computerUseScope?.surface ?? null, driver: grant.computerUseScope?.driver ?? null, limits: grant.computerUseScope?.limits ?? null })),
    grantedSemanticEvidence: semanticScope,
    grantedEvidence: task.grants
      .filter((grant) => grant.capability === "evidence.read")
      .flatMap((grant) => grant.evidenceScope),
    grantedAssessment: task.grants
      .find((grant) => grant.capability === "analysis.evidence.assess")?.assessmentScope ?? null,
    grantedDecision: task.grants
      .find((grant) => grant.capability === "analysis.evidence.decide")?.decisionScope ?? null,
  };
  const mediaBoundary = mediaTools.length === 0
    ? "This executor exposes no media bytes and no media tools. Do not claim that you inspected, heard, translated, or measured media."
    : [
        `This executor exposes only these scheduler-granted media tools: ${mediaTools.join(", ")}.`,
        "Invoke only the tool and exact artifact, track, and half-open millisecond range named by the contract.",
        ...(mediaTools.some((tool) => tool === "media_extract" || tool === "media_seek") ? [
          "An extract or seek operation occurred only when the tool returns a studio.child-media-tool-result.v1 receipt.",
          "media_seek returns one host-produced audio_activity observation: signal or digital_silence with volume measurements for the exact range. It does not identify speech, words, speakers, music, or meaning. media_extract returns no semantic finding.",
        ] : []),
        ...(mediaTools.includes("media_frames_sample") ? [
          "media_frames_sample accepts only one timestampsMs array: 1-8 unique increasing integer presentation times inside the granted half-open range. The task-private host injects source, video track, task, agent, grant, and operation scope; the child never supplies paths or those authorities.",
          "A frame operation occurred only when the tool returns actual image/png content plus a host-authored studio.frame-sampling.receipt.v1 identity. The host re-hashes the source, owns decode and transformation, and reports requested and actual presentation timestamps.",
          "That receipt proves bounded sampling and byte delivery only. It does not prove that any model saw or understood a scene, selected the right frame, performed OCR, identified a person, or produced evidence admissible to a study report.",
          "Do not label worker-authored output as studio.frame-sampling.receipt.v1; that kind belongs only to the host artifact named by the tool result.",
        ] : []),
        ...(mediaTools.includes("media_frames_ocr") ? [
          "Invoke media_frames_ocr only after media_frames_sample, only for an exact relevant on-screen-text gap, and pass only the completed frameSamplingOperationId. Do not run ambient OCR.",
          "The OCR host injects source, frame bytes, track, range, task, agent, and grant. It uses pinned local models and returns time-bound boxes with confidence/state plus immutable observation and receipt identities.",
          "OCR text is a visual hypothesis, not dialogue, identity, spelling truth, translation, cultural meaning, or person identification. It cannot replace or overwrite speech evidence; below-threshold text is withheld.",
          "Copy the returned operation/artifact/content/receipt identities and all returned observation IDs into the top-level ocrEvidenceInputs list. For empty or truncated OCR, echo the same authenticated entry with an empty observationIds list so the host preserves that upstream state.",
          "Do not label worker-authored output as studio.ocr-observations.v1 or studio.ocr-producer.receipt.v1; those kinds belong only to the host.",
        ] : []),
        ...(mediaTools.includes("media_visual_transitions_analyze") ? [
          "Invoke media_visual_transitions_analyze only after exact completed media_frames_sample and media_frames_ocr operations, passing only their returned operation IDs.",
          "The host compares adjacent U2 PNGs on a fixed 32x32 RGB grid. Scores at or above the registered threshold are visual-change candidates only, never scenes, shots, cuts, semantic understanding, identities, or right-frame judgments.",
          "OCR available-hypothesis set changes are retained as secondary lineage only and cannot change the pixel threshold or grant dialogue, caption, or semantic authority.",
          "Copy the returned operation, observations artifact/content, receipt artifact/id/content, and every returned interval ID into the top-level visualTransitionEvidenceInputs list. These intervals remain cite-only media context.",
          "Do not label worker-authored output as studio.visual-transition-observations.v1 or studio.visual-transition-producer.receipt.v1; those kinds belong only to the host.",
        ] : []),
        ...(mediaTools.includes("media_speakers_analyze") ? [
          "Invoke media_speakers_analyze exactly once with the closed empty object. The host injects source, audio track, range, task, agent, and grant; paths and selectors are not accepted.",
          "speaker labels are anonymous clustering hypotheses scoped only to this run, artifact, and operation. They do not identify people and cannot be compared across videos or runs.",
          "Overlap, rapid turns, missing hypotheses, and truncation are coverage states only. They never invent dialogue, validate transcription/translation, or authorize Korean/English caption text.",
          "Copy the returned operation/artifact/content/receipt identities into the top-level speakerEvidenceInputs list. Do not select individual favorable turns; the host reconstructs the complete accounting partition for each cited coverage cell.",
          "Do not label worker-authored output as studio.speaker-overlap-observations.v1 or studio.speaker-overlap-producer.receipt.v1; those kinds belong only to the host.",
        ] : []),
        ...(mediaTools.includes("media_audio_separate") ? [
          "Invoke media_audio_separate exactly once with the closed empty object. The host injects the audited U6.1 trigger, raw source, exact range, model, configuration, task, agent, and grant; paths and selectors are not accepted.",
          "The returned anonymous stems and raw/stem comparison are private host artifacts. Agreement, disagreement, or abstention establishes only that the same recognizer contract was compared over related inputs. It is not independent corroboration and grants no semantic preference, claim support, caption text, quality score, identity, truth, or publication authority.",
          "Your studio.study-report.v2 must retain the assigned range as unknown or withheld with no claims and no evidence citations. Do not echo stem hypotheses as dialogue and do not label worker output as any studio separated-stem or raw-stem-comparison artifact kind.",
        ] : []),
        "Include the returned operation, artifact, receipt, and receipt-content identities in the required worker output.",
      ].join(" ");
  const evidenceScope = task.grants
    .filter((grant) => grant.capability === "evidence.read")
    .flatMap((grant) => grant.evidenceScope);
  const evidenceBoundary = evidenceScope.length === 0
    ? "This executor exposes no evidence-read tool. Existing detector findings are unavailable to this child."
    : [
        "This executor exposes evidence_read for each scheduler-granted evidence artifact in the contract.",
        "Invoke it exactly once for every granted artifactId and use only the bounded facts returned in studio.child-evidence-tool-result.v1.",
        "The evidence existed before this read; facts are selected by intersection and clipped to the exact granted source window. The read creates no new detector finding and does not expose paths or raw media bytes.",
        "Preserve operation, input-artifact, receipt, receipt-content, producer, decision, and preflight-lineage identities in the required worker output.",
        "Do not infer claims beyond the returned facts; unknown, withheld, empty, and truncated remain explicit.",
      ].join(" ");
  const semanticBoundary = semanticScope.length === 0
    ? "This executor exposes no speech_transcribe tool and cannot cite current-run semantic media evidence."
    : precompletedSemanticEvidence
      ? [
          "The task executor already completed the contract-mandated speech_transcribe operation exactly once through the task-private bridge under this task, agent, grant, and execution before model synthesis.",
          "No speech tool is exposed in this model phase, so the operation cannot be duplicated or retried.",
          "Use only the authenticated precompleted result below. The host will attach its exact operation/artifact/content/receipt identities and observation id/ranges as the top-level semanticEvidenceInputs after model output; do not emit that field.",
          "Claims remain worker-authored proposals and may cite only exact observations from the authenticated result.",
          "Its timed text is a current-run recognizer hypothesis, not hearing, truth, understanding, agreement, or an accuracy claim. Preserve empty, unavailable, unknown, and truncated availability without upgrading it.",
        ].join(" ")
    : [
        "Invoke speech_transcribe once for the exact granted artifact, track, and half-open range.",
        "Its timed text is a current-run recognizer hypothesis, not hearing, truth, understanding, agreement, or an accuracy claim.",
        "Multiple workers reading hypotheses does not establish consensus or quality.",
        "Copy the returned operation/artifact/content/receipt identities and every exact observation id/range into the top-level semanticEvidenceInputs list.",
        "A free-text mention of any identity is not a citation and the output validator will reject it.",
        "Preserve empty, unavailable, unknown, and truncated availability without upgrading it.",
        "After the one speech_transcribe result returns, immediately produce the required output JSON; do not deliberate, retry, or call another tool.",
      ].join(" ");
  const studyV1Boundary = task.requiredOutputs.some((output) => output.required && output.artifactKind === "studio.study-report.v1");
  const studyV2Boundary = task.requiredOutputs.some((output) => output.required && output.artifactKind === "studio.study-report.v2");
  const studyBoundary = studyV1Boundary
    ? [
        "Return studio.study-report.v1 as typed coverage and claims, never as a prose-only content field.",
        "Partition every assigned artifact/track range in order with no gaps or overlaps using only supported, withheld, unknown, or failed.",
        "Supported ranges require structured claims over the exact same range, and every claim must cite exact semantic artifact/content/receipt and observation identities returned by speech_transcribe.",
        "Citation observation ranges must close the entire supported claim range; use closed non-supported reasons everywhere else.",
        "Do not submit a coverage percentage. Coverage is derived from the partition and does not establish correctness or complete study.",
      ].join(" ")
    : studyV2Boundary
      ? [
          "Return studio.study-report.v2 as typed coverage proposals and claims, never as prose-only content.",
          "Partition every assigned artifact/track range in order with no gaps or overlaps. A range may name claims, explicitly worker_withheld, explicitly operation_failed, or leave both absent for host-derived unknown/unavailable policy.",
          "Every proposed claim must cover the exact same range as its coverage cell and cite only authenticated current-run speech observations returned by speech_transcribe. The host reconstructs U3 evidence-citation.v1 identities and deterministically derives final coverage from receipts and acoustic dialogue scope; prose cannot upgrade it.",
          "Frames and OCR hypotheses, when separately granted, remain cite-only media context. Anonymous speaker/overlap and acoustic evidence may qualify coverage but cannot authorize dialogue or caption text; current-run speech remains the only claim-support kind.",
          "Do not submit a coverage percentage or claim semantic quality. Weak, missing, conflicting, failed, truncated, unavailable, or out-of-scope evidence must remain an abstention.",
        ].join(" ")
      : "No typed study report is required by this task.";
  const assessmentScope = task.grants
    .find((grant) => grant.capability === "analysis.evidence.assess")?.assessmentScope ?? null;
  const assessmentBoundary = assessmentScope === null
    ? "This executor exposes no evidence_assess tool. Do not turn evidence reads into findings or conclusions."
    : [
        "After every required evidence_read completes, invoke evidence_assess exactly once over only those returned read receipt and receipt-content identities.",
        "Submit only the closed speech_activity or language_identity claims, each with its exact bounding millisecond range and exact returned fact indexes.",
        "The host rejects raw producer artifact identities, paths, open queries, captions, translations, out-of-range indexes, unsupported values, and budget overflow.",
        "Unknown, withheld, and truncated upstream states remain explicit in the receipted assessment; never upgrade them to supported.",
        "Include the returned assessment operation, output-artifact, receipt, and receipt-content identities in the required worker output.",
      ].join(" ");
  const researchGranted = task.grants.some((grant) => grant.capability === "research.investigate");
  const researchBoundary = !researchGranted
    ? "This executor exposes no research tools and no web access. Do not claim that you searched, browsed, or verified anything externally."
    : [
        "This executor exposes research_search and research_document_snapshot only for the exact granted unresolved-conflict gap.",
        "research_search accepts one bounded query string; the host injects task, agent, grant, provider, and budgets. Returned snippets are routing hints, never citations, and never evidence.",
        "research_document_snapshot accepts only a completed searchOperationId plus a resultIndex; URLs and paths are never accepted. The host enforces the domain allowlist, byte and redirect ceilings, and stores receipted document and extraction artifacts.",
        "A snapshot proves only what a public destination served at retrieval time. It is cite-only external context for the granted gap: it never becomes claim support, dialogue, caption text, transcript authority, entity identification, currency, or truth.",
        "To cite a completed document_snapshot, copy only its exact operation, snapshot receipt artifact/content, and extraction artifact/content identities into the top-level researchEvidenceInputs list, then select sorted non-overlapping UTF-8 byte spans within the returned extraction. Search results and snippets never belong in this list. You may leave the list empty.",
        "Do not label worker-authored output as any studio research receipt, snapshot, or extraction artifact kind; those belong only to the host.",
      ].join(" ");
  const computerUseGranted = task.grants.some((grant) => grant.capability === "computer.use.readonly");
  const computerUseBoundary = !computerUseGranted
    ? "This executor exposes no computer-use tool, browser, desktop, app, cookie, credential, or external-screen state."
    : [
        "Invoke computer_use_readonly exactly once with the closed empty object. The host injects the exact gap, R1 cause, sealed offline fixture, HTTPS surface identity, driver, read-only transitions, task, agent, grant, and limits.",
        "This is an offline fixture with zero egress and downloads. It is not a live browser, current external state, source truth, entity match, or evidence of understanding.",
        "To cite a screenshot, copy only its operation, session receipt, state, screenshot artifact/content identities and choose one bounded pixel rectangle in computerUseEvidenceInputs. Do not copy URLs, visible text, targets, or author an evidence envelope.",
        "The host converts selections into report-level cite-only media context. External-screen regions never become claim support, coverage qualification, dialogue, captions, semantic quality, readiness, or publication authority. You may leave the list empty.",
      ].join(" ");
  const decisionScope = task.grants
    .find((grant) => grant.capability === "analysis.evidence.decide")?.decisionScope ?? null;
  const decisionBoundary = decisionScope === null
    ? "This executor exposes no evidence_decide tool. Do not claim that an assessment passed a publication or publish-review gate."
    : [
        "After the required evidence_assess completes, invoke evidence_decide exactly once with only its returned assessment operation, artifact, receipt, and receipt-content identities.",
        "Do not submit raw receipt bytes, assessment claims, paths, prose, a desired outcome, caption content, or publication controls.",
        "The host reopens the stored assessment and cited reads and deterministically emits withheld or proceed_to_publish_review with closed reason codes.",
        "Proceed_to_publish_review means only that a future publish-review producer may inspect the run; it does not mean captions exist or anything was published.",
        "Include the returned decision operation, output-artifact, receipt, receipt-content, outcome, and reason codes in the required worker output.",
      ].join(" ");
  const mandatoryFirstAction = semanticScope.length === 0 || precompletedSemanticEvidence
    ? null
    : "MANDATORY FIRST ACTION: call speech_transcribe exactly once for the granted range. Do not emit final JSON, summarize, or deliberate before that tool result returns; a response without the tool call is rejected.";
  return [
    "You are one isolated child in the 1321 Studio production runtime.",
    ...(mandatoryFirstAction ? [mandatoryFirstAction] : []),
    "Complete only the bounded task contract below and return the JSON required by the supplied output schema.",
    mediaBoundary,
    semanticBoundary,
    studyBoundary,
    researchBoundary,
    computerUseBoundary,
    evidenceBoundary,
    assessmentBoundary,
    decisionBoundary,
    ...(precompletedSemanticEvidence ? [
      `AUTHENTICATED PRECOMPLETED SPEECH RESULT: ${JSON.stringify(precompletedSemanticEvidence)}`,
    ] : []),
    "Output content is a worker-authored artifact proposal; the parent decides whether to accept it.",
    JSON.stringify(contract),
  ].join("\n\n");
}
