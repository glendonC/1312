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

/**
 * Build the first honest plan: a bounded worker-contract proof scoped to the selected source
 * range. It does not claim transcription, translation, media inspection, captions, or study work.
 */
export function createRuntimeStart(input: StartInput): RuntimeStartRecord {
  assertProductionSourceSession(input.sourceSession);
  assertProductionAnalysisRequest(input.analysisRequest);
  const operationId = `operation:contract-proof:${canonicalSha256({
    requestId: input.analysisRequest.requestId,
    range: input.analysisRequest.range,
  })}`;
  const workPlan = {
    schema: "studio.forecast.work-plan.v1" as const,
    planId: `plan:contract-proof:${canonicalSha256({ operationId })}`,
    operations: [
      {
        operationId,
        kind: "runtime.worker-contract-proof",
        range: { ...input.analysisRequest.range },
      },
    ],
  };
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
    commandId: `runtime-start:${canonicalSha256({
      sourceRevisionId: input.sourceSession.revisionId,
      analysisRequestId: input.analysisRequest.requestId,
      workPlan,
    })}`,
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
