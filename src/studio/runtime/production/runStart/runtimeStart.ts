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
  const operationId = `operation:contract-proof:${canonicalSha256({
    requestId: analysisRequest.requestId,
    range: analysisRequest.range,
  })}`;
  const workPlan: RuntimeStartRecord["workPlan"] = {
    schema: "studio.forecast.work-plan.v1",
    planId: `plan:contract-proof:${canonicalSha256({ operationId })}`,
    operations: [
      {
        operationId,
        kind: "runtime.worker-contract-proof",
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
 * Build the first honest plan: a bounded worker-contract proof scoped to the selected source
 * range. It does not claim transcription, translation, media inspection, captions, or study work.
 */
export function createRuntimeStart(input: StartInput): RuntimeStartRecord {
  assertProductionSourceSession(input.sourceSession);
  assertProductionAnalysisRequest(input.analysisRequest);
  const command = createRuntimeStartCommand(input.sourceSession, input.analysisRequest);
  const workPlan = command.workPlan;
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
    workPlan,
  });
  const frozenForecast = freezeForecastArtifact(forecast, {
    runId: input.runId,
    acceptedBy: input.acceptedBy,
    runStartAt: input.startedAt,
  });
  const start: RuntimeStartRecord = {
    schema: "studio.runtime-start.v1",
    producer: { id: "studio.local-runtime-start", version: "1" },
    commandId: command.commandId,
    runtimeId: input.runId,
    journalId: input.journalId,
    sourceSession: structuredClone(input.sourceSession),
    sourceArtifactId: input.sourceArtifactId,
    analysisRequest: structuredClone(input.analysisRequest),
    workPlan,
    forecast,
    frozenForecast,
    startedAt: input.startedAt,
  };
  assertRuntimeStartRecord(start);
  return start;
}
