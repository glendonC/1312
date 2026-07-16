import { assertRuntimeEvent } from "./assertions.ts";
import type { RuntimeProjection } from "./model.ts";
import { applyArtifactEvent } from "./projection/artifactEvents.ts";
import { applyCaptionEvent } from "./projection/captionEvents.ts";
import { applyEvidenceEvent } from "./projection/evidenceEvents.ts";
import { applyExecutionMediaEvent } from "./projection/executionMediaEvents.ts";
import { applyReportEvent } from "./projection/reportEvents.ts";
import { applySemanticEvidenceEvent } from "./projection/semanticEvidenceEvents.ts";
import { applyReviewEvent } from "./projection/reviewEvents.ts";
import { invariant } from "./projection/shared.ts";
import { applyTaskEvent } from "./projection/taskEvents.ts";

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
    semanticEvidence: {},
    evidenceReads: {},
    evidenceAssessments: {},
    evidenceDecisions: {},
    publishReviewIntakes: {},
    publishReviewDecisions: {},
    publishReviewRevocations: {},
    captionProductions: {},
    captionQualityControls: {},
    executions: {},
    modelUsage: {},
    reports: {},
    rootOutputDispositions: {},
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
  if (applyExecutionMediaEvent(next, event)) return next;
  if (applySemanticEvidenceEvent(next, event)) return next;
  if (applyEvidenceEvent(next, event)) return next;
  if (applyReviewEvent(next, event)) return next;
  if (applyCaptionEvent(next, event)) return next;
  if (applyReportEvent(next, event)) return next;

  invariant(false, event, "unknown runtime event");
}

export function projectRuntimeEvents(runId: string, events: readonly unknown[]): RuntimeProjection {
  return events.reduce(applyRuntimeEvent, initialRuntimeProjection(runId));
}
