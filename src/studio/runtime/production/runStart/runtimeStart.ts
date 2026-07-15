import {
  assertProductionAnalysisRequest,
  assertProductionSourceSession,
} from "../assertions.ts";
import { canonicalSha256 } from "../artifactStore.ts";
import { createForecastArtifact, freezeForecastArtifact } from "../forecast/planner.ts";
import type {
  ProductionAnalysisRequest,
  ProductionSourceSession,
  RuntimeStartRecord,
} from "../model.ts";
import { assertRuntimeStartRecord } from "../runStartValidation.ts";

interface StartInput {
  runId: string;
  journalId: string;
  acceptedBy: string;
  startedAt: string;
  sourceSession: ProductionSourceSession;
  sourceArtifactId: string;
  analysisRequest: ProductionAnalysisRequest;
}

export interface RuntimePlanInput {
  runtimeId: string;
  sourceSession: ProductionSourceSession;
  sourceArtifactId: string;
  analysisRequest: ProductionAnalysisRequest;
}

export interface RuntimePlan {
  commandId: string;
  runtimeId: string;
  sourceArtifactId: string;
  workPlan: RuntimeStartRecord["workPlan"];
  forecast: RuntimeStartRecord["forecast"];
}

export interface RuntimeStartCommand {
  commandId: string;
  workPlan: RuntimeStartRecord["workPlan"];
}

/** Derive the durable idempotency key before allocating any host-owned runtime paths. */
export function createRuntimeStartCommand(
  sourceSession: ProductionSourceSession,
  analysisRequest: ProductionAnalysisRequest,
): RuntimeStartCommand {
  assertProductionSourceSession(sourceSession);
  assertProductionAnalysisRequest(analysisRequest);
  if (
    analysisRequest.sourceSessionId !== sourceSession.sessionId ||
    analysisRequest.sourceRevisionId !== sourceSession.revisionId ||
    analysisRequest.sourceContentId !== sourceSession.source.contentId
  ) {
    throw new Error("Runtime start command: analysis request does not bind the source-session revision");
  }
  const operationId = `operation:bounded-media-seek:${canonicalSha256({
    requestId: analysisRequest.requestId,
    range: analysisRequest.range,
  })}`;
  const workPlan: RuntimeStartRecord["workPlan"] = {
    schema: "studio.forecast.work-plan.v1",
    planId: `plan:bounded-media-seek:${canonicalSha256({ operationId })}`,
    operations: [
      {
        operationId,
        kind: "media.seek",
        range: { ...analysisRequest.range },
      },
    ],
  };
  return {
    commandId: `runtime-start:${canonicalSha256({
      sourceRevisionId: sourceSession.revisionId,
      analysisRequestId: analysisRequest.requestId,
      workPlan,
    })}`,
    workPlan,
  };
}

/**
 * Produce the exact plan and forecast for a host-owned runtime identity without freezing or
 * starting it. No filesystem state is created by this pure function.
 */
export function createRuntimePlan(input: RuntimePlanInput): RuntimePlan {
  assertProductionSourceSession(input.sourceSession);
  assertProductionAnalysisRequest(input.analysisRequest);
  const command = createRuntimeStartCommand(input.sourceSession, input.analysisRequest);
  const forecast = createForecastArtifact({
    artifact: {
      artifactId: input.sourceArtifactId,
      contentId: input.sourceSession.source.contentId,
      measuredDurationMs: input.sourceSession.source.durationMs,
      durationMeasurement: {
        schema: "studio.media-probe.v1",
        producer: "scripts/probe-media.mjs",
        receiptContentId: input.sourceSession.mediaProbe.contentId,
      },
    },
    range: { ...input.analysisRequest.range },
    workPlan: command.workPlan,
  });
  return {
    commandId: command.commandId,
    runtimeId: input.runtimeId,
    sourceArtifactId: input.sourceArtifactId,
    workPlan: command.workPlan,
    forecast,
  };
}

/**
 * Build the first honest plan: one bounded, receipted media.seek child proof scoped to the selected
 * source range. It does not claim semantic inspection, transcription, translation, captions, or study work.
 */
export function createRuntimeStart(input: StartInput): RuntimeStartRecord {
  assertProductionSourceSession(input.sourceSession);
  assertProductionAnalysisRequest(input.analysisRequest);
  const plan = createRuntimePlan({
    runtimeId: input.runId,
    sourceSession: input.sourceSession,
    sourceArtifactId: input.sourceArtifactId,
    analysisRequest: input.analysisRequest,
  });
  const frozenForecast = freezeForecastArtifact(plan.forecast, {
    runId: input.runId,
    acceptedBy: input.acceptedBy,
    runStartAt: input.startedAt,
  });
  const start: RuntimeStartRecord = {
    schema: "studio.runtime-start.v1",
    producer: { id: "studio.local-runtime-start", version: "1" },
    commandId: plan.commandId,
    runtimeId: input.runId,
    journalId: input.journalId,
    sourceSession: structuredClone(input.sourceSession),
    sourceArtifactId: input.sourceArtifactId,
    analysisRequest: structuredClone(input.analysisRequest),
    workPlan: plan.workPlan,
    forecast: plan.forecast,
    frozenForecast,
    startedAt: input.startedAt,
  };
  assertRuntimeStartRecord(start);
  return start;
}
