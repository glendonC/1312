import assert from "node:assert/strict";
import test from "node:test";

import { OpenAiSpanTranslationExecutor } from "../src/studio/runtime/production/spanTranslations/openAiExecutor.ts";
import { resolveSpanTranslationExecutorConfiguration } from "../src/studio/runtime/production/spanTranslations/configuration.ts";
import { SPAN_TRANSLATION_PROMPT_CONTENT_ID } from "../src/studio/runtime/production/spanTranslations/executor.ts";
import { validateSpanTranslationExecutorDescriptor } from "../src/studio/runtime/production/validation/spanTranslations.ts";
import type { SpanTranslationExecutorInput } from "../src/studio/runtime/production/model.ts";
import { SPAN_TRANSLATION_LIMITS } from "../src/studio/runtime/production/model.ts";

const input = {
  grant: {
    selection: { side: "source", unit: "unicode_code_point", start: 4, end: 7, text: "몇 분" },
  },
  line: {
    lineId: "line:1",
    startMs: 0,
    endMs: 1_000,
    source: { language: "ko", state: "available", text: "분들이 몇 분 계신데", reasonCode: null },
    target: { language: "en", state: "available", text: "I know a few people.", reasonCode: null },
  },
  contextLines: [],
} as unknown as SpanTranslationExecutorInput;

function completedResponse(text: string, overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    id: "resp_span_translation_test",
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
    usage: { input_tokens: 240, output_tokens: 9 },
    ...overrides,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function executor(): OpenAiSpanTranslationExecutor {
  return new OpenAiSpanTranslationExecutor({ model: "explicit-test-model", apiKey: "test-key" });
}

test("OpenAI adapter sends a bounded stored-false structured Responses request on the shared prompt contract", async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), init });
    return completedResponse(JSON.stringify({ t: "a few people" }));
  };
  try {
    const result = await executor().generate(input, new AbortController().signal);
    assert.deepEqual(result.translation, { availability: "available", reasonCode: null, text: "a few people" });
    assert.deepEqual(result.execution, {
      providerResponseId: "resp_span_translation_test",
      inputTokens: 240,
      outputTokens: 9,
    });
    const request = captured[0];
    assert.ok(request);
    assert.equal(request.url, "https://api.openai.com/v1/responses");
    assert.equal(request.init?.method, "POST");
    const body = JSON.parse(String(request.init?.body)) as {
      model: string;
      store: boolean;
      instructions: string;
      input: string;
      text: { format: { type: string; strict: boolean; schema: { required: string[] } } };
      max_output_tokens: number;
      prompt?: unknown;
    };
    assert.equal(body.model, "explicit-test-model");
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert.deepEqual(body.text.format.schema.required, ["t"]);
    assert.equal(body.max_output_tokens, SPAN_TRANSLATION_LIMITS.maxCompletionTokens);
    const user = JSON.parse(body.input) as { translateTo: string; selectedSpan: { text: string } };
    assert.equal(user.translateTo, "en");
    assert.equal(user.selectedSpan.text, "몇 분");
    assert.equal("prompt" in body, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("both real executors carry the identical prompt contract identity", () => {
  const descriptor = executor().describe();
  assert.equal(descriptor.id, "studio.openai-span-translation-generator");
  assert.equal(descriptor.classification, "real_model");
  assert.equal(descriptor.promptContractContentId, SPAN_TRANSLATION_PROMPT_CONTENT_ID);
  assert.deepEqual(
    validateSpanTranslationExecutorDescriptor(descriptor, "test", "descriptor"),
    descriptor,
  );
});

test("null and empty translations map to an honest withheld abstention", async () => {
  const originalFetch = globalThis.fetch;
  let content = JSON.stringify({ t: null });
  globalThis.fetch = async () => completedResponse(content);
  try {
    const nullResult = await executor().generate(input, new AbortController().signal);
    assert.deepEqual(nullResult.translation, { availability: "withheld", reasonCode: "generator_abstained", text: null });
    content = JSON.stringify({ t: "  " });
    const emptyResult = await executor().generate(input, new AbortController().signal);
    assert.deepEqual(emptyResult.translation, { availability: "withheld", reasonCode: "generator_abstained", text: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("incomplete, refusal, malformed, and open envelopes fail closed", async () => {
  const originalFetch = globalThis.fetch;
  const cases: Array<{ response: () => Response; expected: RegExp }> = [
    { response: () => completedResponse(JSON.stringify({ t: "x" }), { status: "in_progress" }), expected: /did not complete/ },
    { response: () => completedResponse(JSON.stringify({ t: "x" }), { id: "" }), expected: /omitted its provider response id/ },
    {
      response: () => completedResponse("", {
        output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }],
      }),
      expected: /refusal or unsupported message content/,
    },
    { response: () => new Response("not json", { status: 200 }), expected: /not valid JSON/ },
    { response: () => completedResponse("not json"), expected: /was not valid JSON/ },
    { response: () => completedResponse(JSON.stringify({ t: "x", extra: 1 })), expected: /closed output envelope/ },
    { response: () => completedResponse(JSON.stringify({ t: 7 })), expected: /closed output envelope/ },
    { response: () => new Response("{}", { status: 429 }), expected: /HTTP 429/ },
  ];
  try {
    for (const candidate of cases) {
      globalThis.fetch = async () => candidate.response();
      await assert.rejects(executor().generate(input, new AbortController().signal), candidate.expected);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider envelope, output text, and generated translation byte ceilings are enforced", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => completedResponse(JSON.stringify({ t: "x".repeat(SPAN_TRANSLATION_LIMITS.maxOutputBytes) }));
    await assert.rejects(
      executor().generate(input, new AbortController().signal),
      /output byte ceiling/,
    );
    globalThis.fetch = async () => new Response(
      `{"padding":"${"y".repeat(SPAN_TRANSLATION_LIMITS.maxProviderResponseBytes)}"}`,
      { status: 200 },
    );
    await assert.rejects(
      executor().generate(input, new AbortController().signal),
      /response byte ceiling/,
    );
    globalThis.fetch = async () => completedResponse(JSON.stringify({ t: "z".repeat(3_000) }));
    await assert.rejects(
      executor().generate(input, new AbortController().signal),
      /bounded, trimmed, printable text/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai configuration is gated and rejects ollama-only flags", () => {
  assert.deepEqual(
    resolveSpanTranslationExecutorConfiguration({ mode: "openai", allowReal: true, model: "explicit-test-model", endpoint: null, think: null }),
    { mode: "openai", model: "explicit-test-model", endpoint: null, think: null },
  );
  assert.throws(
    () => resolveSpanTranslationExecutorConfiguration({ mode: "openai", allowReal: false, model: "m", endpoint: null, think: null }),
    /--allow-real-span-translation/,
  );
  assert.throws(
    () => resolveSpanTranslationExecutorConfiguration({ mode: "openai", allowReal: true, model: null, endpoint: null, think: null }),
    /--span-translation-model/,
  );
  assert.throws(
    () => resolveSpanTranslationExecutorConfiguration({ mode: "openai", allowReal: true, model: "m", endpoint: "http://127.0.0.1:11434", think: null }),
    /--span-translation-endpoint applies only to the ollama executor/,
  );
  assert.throws(
    () => resolveSpanTranslationExecutorConfiguration({ mode: "openai", allowReal: true, model: "m", endpoint: null, think: "low" }),
    /--span-translation-think applies only to the ollama executor/,
  );
  assert.throws(
    () => new OpenAiSpanTranslationExecutor({ model: "m", apiKey: "  " }),
    /requires an API key/,
  );
});
