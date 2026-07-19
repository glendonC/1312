import assert from "node:assert/strict";
import test from "node:test";

import { parseCodexEvents } from "../src/studio/runtime/production/executor/codexEvents.ts";
import { runBoundedProcess } from "../src/studio/runtime/production/executor/processRunner.ts";
import {
  validateWorkerResult,
  workerOutputSchema,
  workerPrompt,
} from "../src/studio/runtime/production/executor/workerContract.ts";
import type { TaskRecord } from "../src/studio/runtime/production/model.ts";
import { FRAME_SAMPLING_LIMITS } from "../src/studio/runtime/production/model.ts";
import { canonicalSha256 } from "../src/studio/runtime/production/artifactStore.ts";

function task(): TaskRecord {
  const contextBody = {
    source: { artifactId: "artifact:test-source", contentId: `sha256:${"a".repeat(64)}` },
    analysisRequest: {
      requestId: "analysis-request:worker-contract",
      requestedRange: { startMs: 0, endMs: 1_000 },
      taskRange: { startMs: 0, endMs: 1_000 },
      options: {
        speechScope: "foreground" as const,
        includeLyrics: false,
        speaker: null,
        honorifics: "preserve" as const,
        translationStyle: "natural" as const,
        captionDensity: "balanced" as const,
        slowAnalysis: false,
      },
    },
    requestedSourceLanguagePolicy: { mode: "unknown" as const, languages: [] as [], reason: null },
    targetLanguage: "en",
    selectedLanguagePackId: null,
    outputDepth: "evidence" as const,
    detectorEvidence: [],
    reviewedMemory: null,
  };
  return {
    id: "task:worker-contract",
    runId: "runtime:worker-contract",
    workloadKey: "worker-contract",
    objective: "Return one bounded acknowledgement without making media claims.",
    workerKind: "analysis",
    workerLabel: "bounded-worker",
    parentTaskId: "task:parent",
    parentAgentId: "agent:parent",
    depth: 1,
    assignedAgentId: "agent:worker-contract",
    ownerAgentId: "agent:worker-contract",
    jobContext: {
      schema: "studio.task-job-context.v1",
      contextId: `job-context:${canonicalSha256(contextBody)}`,
      ...contextBody,
    },
    mediaScope: [],
    inputArtifactIds: [],
    requiredOutputs: [{ name: "ack", artifactKind: "worker-ack", required: true }],
    dependencies: [],
    budget: { wallMs: 1_000, toolCalls: 1 },
    grants: [
      {
        id: "grant:report",
        capability: "report.submit",
        taskId: "task:worker-contract",
        agentId: "agent:worker-contract",
        mediaScope: [],
        evidenceScope: [],
        assessmentScope: null,
        decisionScope: null,
      },
    ],
    status: "working",
    terminalReason: null,
  };
}

test("Codex event parsing retains the exact measured usage event and final message", () => {
  const rawUsage = {
    type: "turn.completed",
    usage: {
      input_tokens: 12,
      cached_input_tokens: 2,
      output_tokens: 3,
      reasoning_output_tokens: 1,
    },
    provider_request_id: "opaque-provider-receipt",
  };
  const parsed = parseCodexEvents([
    JSON.stringify({ type: "thread.started", thread_id: "thread:test" }),
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: '{"summary":"ok","outputs":[]}' },
    }),
    JSON.stringify(rawUsage),
    "",
  ].join("\n"));

  assert.deepEqual(parsed.usageEvent.usage, rawUsage.usage);
  assert.deepEqual(parsed.rawUsageEvent, rawUsage);
  assert.equal(parsed.finalMessage, '{"summary":"ok","outputs":[]}');
  assert.throws(
    () => parseCodexEvents([
      JSON.stringify({ type: "thread.started" }),
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 1,
          cached_input_tokens: 2,
          output_tokens: 0,
          reasoning_output_tokens: 0,
        },
      }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "{}" } }),
    ].join("\n")),
    { message: "Codex cached input tokens exceed input tokens" },
  );
});

test("worker contract uses one closed schema, validator, and no-media prompt", () => {
  const contract = task();
  const result = validateWorkerResult(
    {
      summary: "The bounded contract was acknowledged without a media claim.",
      outputs: [{ name: "ack", kind: "worker-ack", content: "acknowledged" }],
    },
    contract,
  );
  assert.equal(result.outputs[0].kind, "worker-ack");
  assert.throws(
    () => validateWorkerResult({ ...result, confidence: 1 }, contract),
    { message: "Worker result must contain only summary and outputs" },
  );

  const schema = workerOutputSchema(contract) as {
    additionalProperties: boolean;
    properties: { outputs: { minItems: number; maxItems: number } };
  };
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.outputs.minItems, 1);
  assert.equal(schema.properties.outputs.maxItems, 1);
  assert.match(workerPrompt(contract), /exposes no media bytes and no media tools/);
  assert.match(workerPrompt(contract), /Return one bounded acknowledgement/);

  const mediaContract = structuredClone(contract);
  mediaContract.mediaScope = [{ artifactId: "artifact:source", trackId: "stream:0", startMs: 0, endMs: 1_000 }];
  mediaContract.grants.unshift({
    id: "grant:seek",
    capability: "media.seek",
    taskId: mediaContract.id,
    agentId: mediaContract.assignedAgentId,
    mediaScope: structuredClone(mediaContract.mediaScope),
    evidenceScope: [],
    assessmentScope: null,
    decisionScope: null,
  });
  assert.match(workerPrompt(mediaContract), /scheduler-granted media tools: media_seek/);
  assert.match(workerPrompt(mediaContract), /operation occurred only when the tool returns/);
  assert.match(workerPrompt(mediaContract), /audio_activity observation: signal or digital_silence/);
  assert.match(workerPrompt(mediaContract), /does not identify speech, words, speakers, music, or meaning/);

  const semanticContract = structuredClone(contract);
  semanticContract.mediaScope = [{ artifactId: "artifact:source", trackId: "stream:0", startMs: 0, endMs: 1_000 }];
  semanticContract.grants.unshift({
    id: "grant:speech",
    capability: "speech.transcribe",
    taskId: semanticContract.id,
    agentId: semanticContract.assignedAgentId,
    mediaScope: structuredClone(semanticContract.mediaScope),
    evidenceScope: [],
    assessmentScope: null,
    decisionScope: null,
  });
  const semanticPrompt = workerPrompt(semanticContract);
  assert.match(semanticPrompt, /MANDATORY FIRST ACTION: call speech_transcribe exactly once/);
  assert.ok(semanticPrompt.indexOf("MANDATORY FIRST ACTION") < semanticPrompt.indexOf("Complete only the bounded task contract"));
  const precompletedSemanticPrompt = workerPrompt(semanticContract, {
    precompletedSemanticEvidence: {
      schema: "studio.child-semantic-evidence-tool-result.v1",
      capability: "speech.transcribe",
      operationId: "operation:precompleted-speech",
      artifact: { artifactId: "artifact:semantic", contentId: `sha256:${"b".repeat(64)}`, bytes: 512 },
      receipt: { receiptId: "receipt:semantic", contentId: `sha256:${"c".repeat(64)}` },
      availability: {
        id: "availability:semantic",
        state: "available",
        reason: "current_run_hypotheses_returned",
        truncated: false,
      },
      observations: [{
        kind: "timed_transcript_hypothesis",
        range: { startMs: 0, endMs: 1_000 },
        state: "available",
        text: "현재 실행 결과",
        observationId: "observation:semantic",
      }],
    },
  });
  assert.doesNotMatch(precompletedSemanticPrompt, /MANDATORY FIRST ACTION/);
  assert.match(precompletedSemanticPrompt, /AUTHENTICATED PRECOMPLETED SPEECH RESULT/);
  assert.match(precompletedSemanticPrompt, /operation:precompleted-speech/);
  assert.match(precompletedSemanticPrompt, /현재 실행 결과/);
  assert.match(precompletedSemanticPrompt, /host will attach its exact operation/);
  assert.match(precompletedSemanticPrompt, /do not emit that field/);

  const semanticSchema = workerOutputSchema(semanticContract) as {
    properties: Record<string, unknown>;
    required: string[];
  };
  assert.ok("semanticEvidenceInputs" in semanticSchema.properties);
  assert.ok(semanticSchema.required.includes("semanticEvidenceInputs"));
  const hostSuppliedSemanticSchema = workerOutputSchema(semanticContract, {
    hostSuppliedSemanticEvidenceInputs: true,
  }) as {
    properties: Record<string, unknown>;
    required: string[];
  };
  assert.ok(!("semanticEvidenceInputs" in hostSuppliedSemanticSchema.properties));
  assert.ok(!hostSuppliedSemanticSchema.required.includes("semanticEvidenceInputs"));

  const hostSemanticInput = {
    operationId: "operation:precompleted-speech",
    artifactId: "artifact:semantic",
    contentId: `sha256:${"b".repeat(64)}`,
    receiptId: "receipt:semantic",
    receiptContentId: `sha256:${"c".repeat(64)}`,
    observations: [{ observationId: "observation:semantic", startMs: 0, endMs: 1_000 }],
  };
  const hostSuppliedResult = validateWorkerResult({
    summary: "The bounded semantic range was studied.",
    outputs: [{ name: "ack", kind: "worker-ack", content: "studied" }],
  }, semanticContract, [hostSemanticInput], [], [], [], [], [], {
    hostSuppliedSemanticEvidenceInputs: true,
  });
  assert.deepEqual(hostSuppliedResult.semanticEvidenceInputs, [hostSemanticInput]);
  assert.throws(
    () => validateWorkerResult({
      summary: "The model attempted to override host evidence.",
      semanticEvidenceInputs: [hostSemanticInput],
      outputs: [{ name: "ack", kind: "worker-ack", content: "studied" }],
    }, semanticContract, [hostSemanticInput], [], [], [], [], [], {
      hostSuppliedSemanticEvidenceInputs: true,
    }),
    { message: "Worker result must contain only summary and outputs" },
  );

  const frameContract = structuredClone(contract);
  frameContract.mediaScope = [{ artifactId: "artifact:source", trackId: "stream:0", startMs: 0, endMs: 1_000 }];
  frameContract.grants.unshift({
    id: "grant:frames",
    capability: "media.frames.sample",
    taskId: frameContract.id,
    agentId: frameContract.assignedAgentId,
    mediaScope: structuredClone(frameContract.mediaScope),
    evidenceScope: [],
    assessmentScope: null,
    decisionScope: null,
    frameScope: {
      schema: "studio.frame-sampling-grant.v1",
      limits: structuredClone(FRAME_SAMPLING_LIMITS),
    },
  });
  const framePrompt = workerPrompt(frameContract);
  assert.doesNotMatch(framePrompt, /exposes no media bytes and no media tools/);
  assert.match(framePrompt, /scheduler-granted media tools: media_frames_sample/);
  assert.match(framePrompt, /accepts only one timestampsMs array/);
  assert.match(framePrompt, /actual image\/png content/);
  assert.match(framePrompt, /does not prove that any model saw or understood a scene/);
  assert.match(framePrompt, /Do not label worker-authored output as studio\.frame-sampling\.receipt\.v1/);

  const impersonatingContract = structuredClone(frameContract);
  impersonatingContract.requiredOutputs = [{
    name: "forged host receipt",
    artifactKind: "studio.frame-sampling.receipt.v1",
    required: true,
  }];
  assert.throws(
    () => workerOutputSchema(impersonatingContract),
    /host-only frame artifact kind/,
  );
  assert.throws(
    () => validateWorkerResult({
      summary: "This must not be accepted.",
      outputs: [{
        name: "forged host receipt",
        kind: "studio.frame-sampling.receipt.v1",
        content: "worker prose",
      }],
    }, impersonatingContract),
    /host-only frame artifact kind/,
  );
});

test("bounded process runner reports output overflow without accepting excess bytes", async () => {
  const result = await runBoundedProcess({
    executable: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(4096))"],
    cwd: process.cwd(),
    stdin: "",
    timeoutMs: 5_000,
    maxStdoutBytes: 32,
    maxStderrBytes: 32,
  });

  assert.equal(result.outputOverflow, true);
  assert.equal(result.stdout.length, 0);
});
