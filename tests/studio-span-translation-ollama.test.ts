import assert from "node:assert/strict";
import test from "node:test";

import { OllamaSpanTranslationExecutor } from "../src/studio/runtime/production/spanTranslations/ollamaExecutor.ts";
import { resolveSpanTranslationExecutorConfiguration } from "../src/studio/runtime/production/spanTranslations/configuration.ts";
import type { SpanTranslationExecutorInput } from "../src/studio/runtime/production/model.ts";
import { SPAN_TRANSLATION_LIMITS } from "../src/studio/runtime/production/model.ts";

const input = {
  grant: {
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
} as unknown as SpanTranslationExecutorInput;

function chatResponse(content: string, overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    model: "explicit-test-model",
    message: { role: "assistant", content },
    done: true,
    done_reason: "stop",
    prompt_eval_count: 96,
    eval_count: 12,
    ...overrides,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function executor(think: "off" | "low" = "off"): OllamaSpanTranslationExecutor {
  return new OllamaSpanTranslationExecutor({
    model: "explicit-test-model",
    endpoint: "http://127.0.0.1:11434",
    think,
  });
}

test("Ollama adapter sends a bounded non-thinking schema-constrained native chat request", async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), init });
    return chatResponse(JSON.stringify({ t: "now" }));
  };
  try {
    const result = await executor().generate(input, new AbortController().signal);
    assert.deepEqual(result.translation, { availability: "available", reasonCode: null, text: "now" });
    assert.deepEqual(result.execution, { providerResponseId: null, inputTokens: 96, outputTokens: 12 });
    const request = captured[0];
    assert.ok(request);
    assert.equal(request.url, "http://127.0.0.1:11434/api/chat");
    assert.equal(request.init?.method, "POST");
    const body = JSON.parse(String(request.init?.body)) as {
      model: string;
      stream: boolean;
      think: unknown;
      format: { required: string[] };
      options: { temperature: number; num_predict: number };
      messages: Array<{ role: string; content: string }>;
      prompt?: unknown;
    };
    assert.equal(body.model, "explicit-test-model");
    assert.equal(body.stream, false);
    assert.equal(body.think, false);
    assert.deepEqual(body.format.required, ["t"]);
    assert.equal(body.options.temperature, 0);
    assert.equal(body.options.num_predict, SPAN_TRANSLATION_LIMITS.maxCompletionTokens);
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0].role, "system");
    const user = JSON.parse(body.messages[1].content) as { translateTo: string; selectedSpan: { text: string } };
    assert.equal(user.translateTo, "en");
    assert.equal(user.selectedSpan.text, "현재");
    assert.equal("prompt" in body, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("low thinking is forwarded and a thinking channel in the reply is tolerated", async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{ init?: RequestInit }> = [];
  globalThis.fetch = async (_url, init) => {
    captured.push({ init });
    return chatResponse(JSON.stringify({ t: "because I have to depart" }), {
      message: {
        role: "assistant",
        content: JSON.stringify({ t: "because I have to depart" }),
        thinking: "short hidden analysis",
      },
    });
  };
  try {
    const result = await executor("low").generate(input, new AbortController().signal);
    assert.equal(result.translation.availability, "available");
    const body = JSON.parse(String(captured[0].init?.body)) as { think: unknown };
    assert.equal(body.think, "low");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("null and empty translations map to an honest withheld abstention", async () => {
  const originalFetch = globalThis.fetch;
  let content = JSON.stringify({ t: null });
  globalThis.fetch = async () => chatResponse(content);
  try {
    const nullResult = await executor().generate(input, new AbortController().signal);
    assert.deepEqual(nullResult.translation, { availability: "withheld", reasonCode: "generator_abstained", text: null });
    content = JSON.stringify({ t: "   " });
    const emptyResult = await executor().generate(input, new AbortController().signal);
    assert.deepEqual(emptyResult.translation, { availability: "withheld", reasonCode: "generator_abstained", text: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("incomplete, truncated, malformed, and open envelopes fail closed", async () => {
  const originalFetch = globalThis.fetch;
  const cases: Array<{ response: () => Response; expected: RegExp }> = [
    { response: () => chatResponse(JSON.stringify({ t: "now" }), { done: false }), expected: /did not complete/ },
    { response: () => chatResponse(JSON.stringify({ t: "now" }), { done_reason: "length" }), expected: /did not complete/ },
    { response: () => new Response("not json", { status: 200 }), expected: /not valid JSON/ },
    { response: () => chatResponse("not json"), expected: /was not valid JSON/ },
    { response: () => chatResponse(JSON.stringify({ t: "now", extra: "field" })), expected: /closed output envelope/ },
    { response: () => chatResponse(JSON.stringify({ other: "key" })), expected: /closed output envelope/ },
    { response: () => chatResponse(JSON.stringify({ t: 7 })), expected: /closed output envelope/ },
    { response: () => chatResponse(JSON.stringify({ t: "now" }), { message: { role: "assistant" } }), expected: /omitted its message content/ },
    { response: () => new Response("{}", { status: 502 }), expected: /HTTP 502/ },
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

test("provider envelope and message content byte ceilings are enforced", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => chatResponse(JSON.stringify({ t: "x".repeat(SPAN_TRANSLATION_LIMITS.maxOutputBytes) }));
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("oversized translations that fit the envelope still fail the generated-output bound", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => chatResponse(JSON.stringify({ t: "z".repeat(3_000) }));
  try {
    await assert.rejects(
      executor().generate(input, new AbortController().signal),
      /bounded, trimmed, printable text/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the executor only accepts a plain loopback http origin", () => {
  const reject = (endpoint: string) => assert.throws(
    () => new OllamaSpanTranslationExecutor({ model: "m", endpoint, think: "off" }),
    /plain loopback http origin|valid URL/,
  );
  reject("https://127.0.0.1:11434");
  reject("http://example.com:11434");
  reject("http://127.0.0.1:11434/v1");
  reject("http://127.0.0.1:11434/?stream=true");
  reject("http://user:pass@127.0.0.1:11434");
  reject("not a url");
  const accepted = new OllamaSpanTranslationExecutor({
    model: "m",
    endpoint: "http://localhost:11434/",
    think: "off",
  });
  assert.equal(accepted.describe().classification, "real_model");
});

test("an abort signal cancels the provider request", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) =>
    new Promise((_resolve, rejectFetch) => {
      init?.signal?.addEventListener("abort", () => rejectFetch(init.signal?.reason));
    })) as typeof fetch;
  try {
    const controller = new AbortController();
    const pending = executor().generate(input, controller.signal);
    controller.abort(new Error("Span translation exceeded its wall-time ceiling"));
    await assert.rejects(pending, /wall-time ceiling/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("configuration refuses real execution without the explicit allow flag and model", () => {
  assert.deepEqual(
    resolveSpanTranslationExecutorConfiguration({ mode: null, allowReal: false, model: null, endpoint: null, think: null }),
    { mode: "unavailable", model: null, endpoint: null, think: null },
  );
  assert.throws(
    () => resolveSpanTranslationExecutorConfiguration({ mode: "ollama", allowReal: false, model: "gemma3:4b", endpoint: null, think: null }),
    /--allow-real-span-translation/,
  );
  assert.throws(
    () => resolveSpanTranslationExecutorConfiguration({ mode: "ollama", allowReal: true, model: null, endpoint: null, think: null }),
    /--span-translation-model/,
  );
  assert.throws(
    () => resolveSpanTranslationExecutorConfiguration({ mode: "cloud", allowReal: true, model: "gpt", endpoint: null, think: null }),
    /must be unavailable, ollama, or openai/,
  );
  assert.throws(
    () => resolveSpanTranslationExecutorConfiguration({ mode: "ollama", allowReal: true, model: "gemma3:4b", endpoint: null, think: "medium" }),
    /must be off or low/,
  );
  assert.deepEqual(
    resolveSpanTranslationExecutorConfiguration({ mode: "ollama", allowReal: true, model: "gpt-oss:20b", endpoint: null, think: "low" }),
    { mode: "ollama", model: "gpt-oss:20b", endpoint: "http://127.0.0.1:11434", think: "low" },
  );
});
