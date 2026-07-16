import assert from "node:assert/strict";
import test from "node:test";

import * as productionValidation from "../src/studio/runtime/production/assertions.ts";
import {
  assertMediaExtractRequest,
  assertProductionAnalysisRequest,
  assertReportSubmitRequest,
  assertRuntimeEvent,
  assertRuntimeLimits,
  assertSourceArtifactDescriptor,
  assertWorkerOutputEnvelope,
} from "../src/studio/runtime/production/assertions.ts";

test("production validation facade preserves its exact public export surface", () => {
  assert.deepEqual(Object.keys(productionValidation).sort(), [
    "assertEvidenceAssessmentRequest",
    "assertEvidenceDecisionRequest",
    "assertEvidenceReadRequest",
    "assertMediaExtractRequest",
    "assertMediaSeekRequest",
    "assertPreflightEvidenceArtifactDescriptor",
    "assertProductionAnalysisRequest",
    "assertProductionSourceSession",
    "assertReportDecisionRequest",
    "assertReportSubmitRequest",
    "assertRootOutputDispositionRequest",
    "assertRuntimeArtifact",
    "assertRuntimeEvent",
    "assertRuntimeLimits",
    "assertSourceArtifactDescriptor",
    "assertSpawnRequestInput",
    "assertSpeechTranscribeRequest",
    "assertWorkerOutputEnvelope",
    "validateEvidenceAssessmentReceipt",
    "validateEvidenceDecisionReceipt",
    "validateEvidenceReadReceipt",
    "validateRootOutputDispositionReceipt",
    "validateSemanticMediaEvidenceArtifact",
    "validateSemanticMediaEvidenceReceipt",
  ]);
});

test("production validation facade preserves closed scheduling diagnostics", () => {
  assert.throws(
    () => assertRuntimeLimits({
      maxDepth: 0,
      maxActiveWorkers: 1,
      runBudget: { wallMs: 1, toolCalls: 1 },
      grantableCapabilities: [],
      desiredAgentState: "working",
    }),
    { message: /^Runtime limits: limits\.desiredAgentState is not allowed$/ },
  );
});

test("production validation facade keeps language policy fields distinct", () => {
  assert.throws(
    () => assertProductionAnalysisRequest({
      schema: "studio.analysis-request.v1",
      requestId: "analysis-request:test",
      sourceSessionId: "source-session:test",
      sourceRevisionId: "source-revision:test",
      sourceContentId: `sha256:${"a".repeat(64)}`,
      range: { startMs: 0, endMs: 1 },
      language: {
        languagePair: {
          requestedSource: { mode: "automatic", languages: ["ko"], reason: null },
          targetLanguage: "en",
        },
        selectedLanguagePackId: null,
        detectedLanguageEvidenceContentIds: [],
      },
      outputDepth: "captions",
      options: {
        speechScope: "foreground",
        includeLyrics: false,
        speaker: null,
        honorifics: "preserve",
        translationStyle: "natural",
        captionDensity: "balanced",
        slowAnalysis: false,
      },
    }),
    {
      message:
        /^Production analysis request: request\.language\.languagePair\.requestedSource automatic source cannot carry languages or a reason$/,
    },
  );
});

test("production validation facade rejects provider and caller path leakage", () => {
  assert.throws(
    () => assertSourceArtifactDescriptor({
      schema: "studio.source-artifact.v1",
      adapterId: "owned-local-source-adapter.v1",
      sourceReceiptRef: "owned-local:test",
      publication: "private",
      path: "/trusted/host/path.wav",
      content: {
        algorithm: "sha256",
        digest: "b".repeat(64),
        contentId: `sha256:${"b".repeat(64)}`,
        bytes: 1,
      },
      durationMs: 1,
      tracks: [],
      providerVideoId: "must-not-cross-the-adapter",
    }),
    { message: /^Source artifact descriptor: source\.providerVideoId is not allowed$/ },
  );

  assert.throws(
    () => assertMediaExtractRequest({
      operationId: "operation:test",
      taskId: "task:test",
      agentId: "agent:test",
      artifactId: "artifact:test",
      trackId: "track:test",
      startMs: 0,
      endMs: 1,
      outputPath: "/caller/chosen.wav",
    }),
    { message: /^Media extract request: request\.outputPath is not allowed$/ },
  );
});

test("production validation facade keeps worker output and handoff contracts closed", () => {
  assert.throws(
    () => assertWorkerOutputEnvelope({
      schema: "studio.worker-output.v1",
      executionId: "execution:test",
      taskId: "task:test",
      agentId: "agent:test",
      output: { name: "ack", kind: "worker-ack", content: "ok", confidence: 1 },
    }),
    { message: /^Worker output: envelope\.output\.confidence is not allowed$/ },
  );

  assert.throws(
    () => assertReportSubmitRequest({
      taskId: "task:test",
      agentId: "agent:test",
      outputArtifactIds: [],
      summary: "Nothing to hand off.",
    }),
    { message: /^Report submission: request\.outputArtifactIds must contain an output artifact$/ },
  );
});

test("production validation facade rejects replay-only fields at the event boundary", () => {
  assert.throws(
    () => assertRuntimeEvent({
      schema: "studio.runtime.event.v1",
      runId: "runtime:test",
      seq: 1,
      eventId: "event:runtime:test:1",
      recordedAt: "2026-07-14T12:00:00.000Z",
      producer: { kind: "scheduler", id: "scheduler:test" },
      causationId: null,
      correlationId: null,
      type: "task.created",
      data: {},
      fixtureOnly: true,
    }),
    { message: /^Runtime event: event\.fixtureOnly is not allowed$/ },
  );
});
