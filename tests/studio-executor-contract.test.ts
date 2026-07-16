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

function task(): TaskRecord {
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
