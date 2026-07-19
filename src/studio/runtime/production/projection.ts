import { assertRuntimeEvent } from "./assertions.ts";
import type { RuntimeProjection } from "./model.ts";
import { applyArtifactEvent } from "./projection/artifactEvents.ts";
import { applyCaptionEvent } from "./projection/captionEvents.ts";
import { applyEvidenceEvent } from "./projection/evidenceEvents.ts";
import { applyFrameEvent } from "./projection/frameEvents.ts";
import { applyOcrEvent } from "./projection/ocrEvents.ts";
import { applyVisualTransitionEvent } from "./projection/visualTransitionEvents.ts";
import { applySpeakerOverlapEvent } from "./projection/speakerEvents.ts";
import { applyConditionalSeparationEvent } from "./projection/separationEvents.ts";
import { applyResearchEvent } from "./projection/researchEvents.ts";
import { applyComputerUseEvent } from "./projection/computerUseEvents.ts";
import { applyExecutionMediaEvent } from "./projection/executionMediaEvents.ts";
import { applyReportEvent } from "./projection/reportEvents.ts";
import { applySemanticEvidenceEvent } from "./projection/semanticEvidenceEvents.ts";
import { applyReviewEvent } from "./projection/reviewEvents.ts";
import { invariant } from "./projection/shared.ts";
import { applyTaskEvent } from "./projection/taskEvents.ts";
import { applyStudyReportEvent } from "./projection/studyReportEvents.ts";
import { applyStudySynthesisEvent } from "./projection/studySynthesisEvents.ts";
import { applyRestudyEvent } from "./projection/restudyEvents.ts";
import { applyLanguageExplanationEvent } from "./projection/languageExplanationEvents.ts";
import { applyLearningPrepEvent } from "./projection/learningPrepEvents.ts";
import { applyAgentRecoveryEvent } from "./projection/agentRecoveryEvents.ts";

export function initialRuntimeProjection(runId: string): RuntimeProjection {
  if (!runId.trim()) throw new Error("Runtime projection requires a run id");
  return {
    runId,
    lastSeq: 0,
    tasks: {},
    agents: {},
    artifacts: {},
    spawnRequests: {},
    taskLaunches: {},
    orchestratorToolCalls: {},
    reportWaits: {},
    orchestratorDecisions: {},
    operations: {},
    frameSamples: {},
    ocrOperations: {},
    visualTransitionOperations: {},
    speakerOverlapOperations: {},
    conditionalSeparationOperations: {},
    researchOperations: {},
    researchExhaustions: {},
    researchRequestInputs: {},
    computerUseOperations: {},
    semanticEvidence: {},
    evidenceReads: {},
    evidenceAssessments: {},
    evidenceDecisions: {},
    publishReviewIntakes: {},
    publishReviewDecisions: {},
    publishReviewRevocations: {},
    captionProductions: {},
    captionQualityControls: {},
    languageExplanations: {},
    learningPreps: {},
    executions: {},
    modelUsage: {},
    reports: {},
    rootOutputDispositions: {},
    parentArtifactDispositions: {},
    generalizedParentArtifactAdmissions: {},
    parentArtifactReadGrants: {},
    parentArtifactReads: {},
    generalizedParentArtifactReads: {},
    studyPlanningDecisions: {},
    studyFollowUps: {},
    ownedMediaStudies: {},
    generalizedOwnedMediaStudies: {},
    studyReadiness: {},
    generalizedStudyReadiness: {},
    rangePasses: {},
    executorFailureClassifications: {},
    agentRecoveries: {},
  };
}

/** Fold one asserted, ordered production event into an immutable normalized projection. */
export function applyRuntimeEvent(state: RuntimeProjection, candidate: unknown): RuntimeProjection {
  assertRuntimeEvent(candidate);
  const event = candidate;
  invariant(event.runId === state.runId, event, `run ${event.runId} does not match ${state.runId}`);
  invariant(event.seq === state.lastSeq + 1, event, `sequence expected ${state.lastSeq + 1}, received ${event.seq}`);
  invariant(event.eventId === `event:${event.runId}:${event.seq}`, event, "event identity does not match run and sequence");

  const next = structuredClone(state);
  next.lastSeq = event.seq;

  if (applyArtifactEvent(next, event)) return next;
  if (applyTaskEvent(next, event)) return next;
  if (applyAgentRecoveryEvent(next, event)) return next;
  if (applyExecutionMediaEvent(next, event)) return next;
  if (applyFrameEvent(next, event)) return next;
  if (applyOcrEvent(next, event)) return next;
  if (applyVisualTransitionEvent(next, event)) return next;
  if (applySpeakerOverlapEvent(next, event)) return next;
  if (applyConditionalSeparationEvent(next, event)) return next;
  if (applyResearchEvent(next, event)) return next;
  if (applyComputerUseEvent(next, event)) return next;
  if (applySemanticEvidenceEvent(next, event)) return next;
  if (applyEvidenceEvent(next, event)) return next;
  if (applyReviewEvent(next, event)) return next;
  if (applyCaptionEvent(next, event)) return next;
  if (applyLanguageExplanationEvent(next, event)) return next;
  if (applyLearningPrepEvent(next, event)) return next;
  if (applyReportEvent(next, event)) return next;
  if (applyStudyReportEvent(next, event)) return next;
  if (applyRestudyEvent(next, event)) return next;
  if (applyStudySynthesisEvent(next, event)) return next;

  invariant(false, event, "unknown runtime event");
}

export function projectRuntimeEvents(runId: string, events: readonly unknown[]): RuntimeProjection {
  return events.reduce(applyRuntimeEvent, initialRuntimeProjection(runId));
}
