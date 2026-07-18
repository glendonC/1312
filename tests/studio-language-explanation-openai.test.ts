import assert from "node:assert/strict";
import test from "node:test";

import { OpenAiLanguageExplanationExecutor } from "../src/studio/runtime/production/languageExplanations/openAiExecutor.ts";
import { resolveLanguageExplanationExecutorConfiguration } from "../src/studio/runtime/production/languageExplanations/configuration.ts";
import type { LanguageExplanationExecutorInput } from "../src/studio/runtime/production/model.ts";
import { LANGUAGE_EXPLANATION_LIMITS } from "../src/studio/runtime/production/model.ts";
import { validateLanguageExplanationContextLine } from "../src/studio/runtime/production/validation/languageExplanations.ts";

const input = {
  grant: {
    facetKinds: ["meaning"],
    selection: { side: "source", unit: "unicode_code_point", start: 0, end: 2, text: "현재" },
  },
  line: {
    lineId: "line:1",
    startMs: 0,
    endMs: 1_000,
    source: { language: "ko", state: "available", text: "현재 실행", reasonCode: null },
    target: { language: "en", state: "available", text: "Current run", reasonCode: null },
  },
  contextLines: [],
} as unknown as LanguageExplanationExecutorInput;

function completedResponse(text: string, overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    id: "resp_language_explanation_test",
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
    usage: { input_tokens: 120, output_tokens: 30 },
    ...overrides,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("OpenAI language-explanation adapter sends a bounded stored-false structured Responses request", async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), init });
    return completedResponse(JSON.stringify({
      facets: [{
        kind: "meaning",
        availability: "available",
        reasonCode: null,
        content: { sceneMeaning: "It identifies the current run in this caption." },
      }],
    }));
  };
  try {
    const executor = new OpenAiLanguageExplanationExecutor({ model: "explicit-test-model", apiKey: "test-key" });
    const result = await executor.generate(input, new AbortController().signal);
    assert.equal(result.facets[0].availability, "available");
    assert.deepEqual(result.execution, {
      providerResponseId: "resp_language_explanation_test",
      inputTokens: 120,
      outputTokens: 30,
    });
    const request = captured[0];
    assert.ok(request);
    assert.equal(request.url, "https://api.openai.com/v1/responses");
    assert.equal(request.init?.method, "POST");
    const body = JSON.parse(String(request.init?.body)) as {
      model: string;
      store: boolean;
      text: { format: { type: string; strict: boolean; schema: unknown } };
      max_output_tokens: number;
      prompt?: unknown;
    };
    assert.equal(body.model, "explicit-test-model");
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert.doesNotMatch(JSON.stringify(body.text.format.schema), /"const":/);
    assert.match(JSON.stringify(body.text.format.schema), /"enum":\["meaning"\]/);
    assert.equal(body.max_output_tokens, 4_000);
    assert.equal("prompt" in body, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAI language-explanation adapter fails closed on HTTP, incomplete, and open structured output", async (t) => {
  const originalFetch = globalThis.fetch;
  try {
    const executor = new OpenAiLanguageExplanationExecutor({ model: "explicit-test-model", apiKey: "test-key" });
    await t.test("HTTP failure", async () => {
      globalThis.fetch = async () => new Response("provider failure", { status: 503 });
      await assert.rejects(executor.generate(input, new AbortController().signal), /HTTP 503/);
    });
    await t.test("incomplete response", async () => {
      globalThis.fetch = async () => completedResponse("{}", { status: "incomplete" });
      await assert.rejects(executor.generate(input, new AbortController().signal), /did not complete/);
    });
    await t.test("open output envelope", async () => {
      globalThis.fetch = async () => completedResponse(JSON.stringify({ facets: [], extra: "caller-open" }));
      await assert.rejects(executor.generate(input, new AbortController().signal), /closed output envelope/);
    });
    await t.test("missing provider receipt identity", async () => {
      globalThis.fetch = async () => completedResponse(JSON.stringify({ facets: [] }), { id: null });
      await assert.rejects(executor.generate(input, new AbortController().signal), /provider response id/);
    });
    await t.test("mixed refusal content", async () => {
      globalThis.fetch = async () => new Response(JSON.stringify({
        id: "resp_mixed",
        status: "completed",
        output: [{
          type: "message",
          content: [
            { type: "output_text", text: JSON.stringify({ facets: [] }) },
            { type: "refusal", refusal: "cannot answer" },
          ],
        }],
      }), { status: 200 });
      await assert.rejects(executor.generate(input, new AbortController().signal), /refusal or unsupported/);
    });
    await t.test("oversized provider envelope", async () => {
      globalThis.fetch = async () => new Response("x".repeat(LANGUAGE_EXPLANATION_LIMITS.maxProviderResponseBytes + 1), { status: 200 });
      await assert.rejects(executor.generate(input, new AbortController().signal), /response byte ceiling/);
    });
    await t.test("oversized declared provider envelope", async () => {
      globalThis.fetch = async () => new Response("{}", {
        status: 200,
        headers: { "Content-Length": String(LANGUAGE_EXPLANATION_LIMITS.maxProviderResponseBytes + 1) },
      });
      await assert.rejects(executor.generate(input, new AbortController().signal), /response byte ceiling/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("language-explanation caption snapshots accept every legal caption-line byte size", () => {
  const text = "한".repeat(4_096);
  const line = validateLanguageExplanationContextLine({
    lineId: "line:caption-limit",
    startMs: 0,
    endMs: 1_000,
    source: { language: "ko", state: "available", text, reasonCode: null },
    target: { language: "en", state: "available", text: "translation", reasonCode: null },
  }, "Caption compatibility", "line");
  assert.equal(line.source.text, text);
});

test("OpenAI language-explanation adapter requires explicit bounded configuration", () => {
  assert.throws(() => new OpenAiLanguageExplanationExecutor({ model: "", apiKey: "test-key" }), /explicit bounded model id/);
  assert.throws(() => new OpenAiLanguageExplanationExecutor({ model: "explicit-test-model", apiKey: "" }), /requires an API key/);
});

test("runtime-host language-explanation configuration requires both explicit real opt-in and model", () => {
  assert.deepEqual(resolveLanguageExplanationExecutorConfiguration({ mode: null, allowReal: false, model: null }), {
    mode: "unavailable",
    model: null,
  });
  assert.throws(
    () => resolveLanguageExplanationExecutorConfiguration({ mode: "other", allowReal: false, model: null }),
    /must be unavailable or openai/,
  );
  assert.throws(
    () => resolveLanguageExplanationExecutorConfiguration({ mode: "openai", allowReal: false, model: "explicit-model" }),
    /requires --allow-real-language-explanation/,
  );
  assert.throws(
    () => resolveLanguageExplanationExecutorConfiguration({ mode: "openai", allowReal: true, model: null }),
    /requires an explicit --language-explanation-model identity/,
  );
  assert.deepEqual(
    resolveLanguageExplanationExecutorConfiguration({ mode: "openai", allowReal: true, model: "explicit-model" }),
    { mode: "openai", model: "explicit-model" },
  );
});
