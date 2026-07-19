import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildOpenAIAudioTranslationRequest,
  executeOpenAIAudioTranslation,
  materializeProviderCallReceipt,
  preflightOpenAIAudioTranslation,
} from "../scripts/lib/bench-adapters/openai-audio-translation-v1.mjs";
import { validateProviderCall } from "../scripts/lib/bench-single-attempt.mjs";
import { contentIdForJson } from "../scripts/lib/immutable-receipts.mjs";

function sha(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function invocation({ withRule = false, config = null } = {}) {
  const media = Buffer.from("synthetic Korean media bytes for provider contract tests");
  const ruleValue = {
    instruction: "Treat bare Korean address forms as social address unless context proves kinship.",
  };
  const ruleContentId = contentIdForJson(ruleValue);
  const providerConfig = config ?? {
    model: "whisper-1",
    provider: {
      id: "openai",
      operation: "audio_translation",
      response_format: "verbose_json",
      temperature: 0,
      timeout_ms: 20,
      max_response_bytes: 2048,
    },
    reviewed_memory: { rule_content_id: withRule ? ruleContentId : null },
  };
  return {
    attemptId: `bench-attempt:sha256:${"1".repeat(64)}`,
    run: "provider-contract-run",
    clipId: "provider-contract-clip",
    repetition: 1,
    side: withRule ? "with" : "without",
    source: {
      contentId: sha(media),
      bytes: media.length,
      dataBase64: media.toString("base64"),
      filename: "clip.m4a",
    },
    clip: {
      durationS: 30,
      lang: "ko",
      pair: "ko->en",
      source: {
        kind: "owned",
        url: "https://example.test/provider-contract",
        channel: "fixture",
        licence: "Owned fixture",
        window: null,
        attribution: "Fixture owner",
      },
    },
    hostContext: {
      schema: "studio.bench.certified-host-context.v1",
      context_id: `bench-host-context:sha256:${"2".repeat(64)}`,
      system_id: "1321-provider-subject",
      config_id: `bench-config:sha256:${"3".repeat(64)}`,
      config: providerConfig,
      reviewed_memory: {
        accepted_materialization: null,
        entries: withRule
          ? [{
              namespace: "language/ko/rules",
              kind: "rule",
              key: "ko.kinship-address-context",
              value: ruleValue,
              proposal_id: `memory-proposal:sha256:${"4".repeat(64)}`,
              rule_content_id: ruleContentId,
              status: "qualification_candidate",
            }]
          : [],
      },
    },
  };
}

function responseBinding(bytes) {
  if (bytes.length === 0) {
    return {
      content_id: sha(bytes),
      bytes: 0,
    };
  }
  return {
    path: "bench/attempts/provider-contract-run/provider-response.json",
    content_id: sha(bytes),
    bytes: bytes.length,
  };
}

const RESPONSE = Buffer.from(JSON.stringify({
  text: "Junho and I.",
  language: "korean",
  duration: 30,
  segments: [{ start: 0, end: 1.5, text: "Junho and I." }],
}));

test("provider adapter builds exact rule-bound bytes and invokes injected transport once", async () => {
  const withoutRequest = buildOpenAIAudioTranslationRequest(invocation());
  const withRequest = buildOpenAIAudioTranslationRequest(invocation({ withRule: true }));
  assert.notEqual(withoutRequest.request.content_id, withRequest.request.content_id);
  assert.equal(withoutRequest.prompt.rule_content_id, null);
  assert.match(withRequest.body.toString("utf8"), /Candidate rule:/);
  assert.doesNotMatch(withRequest.body.toString("utf8"), /english_guidance|korean_gold|critical_units/);

  let calls = 0;
  const result = await executeOpenAIAudioTranslation(
    invocation(),
    {
      mode: "test",
      transport: async () => {
        calls += 1;
        return { status: 200, headers: { "x-request-id": "req_fixture_1" }, body: RESPONSE };
      },
    },
    {
      startedAt: "2026-07-20T00:00:00.000Z",
      now: () => "2026-07-20T00:00:02.000Z",
      providerResponsePath: "bench/attempts/provider-contract-run/provider-response.json",
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.capture.reproducible.deterministic, false);
  assert.equal(result.capture.units[0].source, "");
  assert.equal(result.capture.units[0].outputs["1321-provider-subject"].text, "Junho and I.");
  const receipt = materializeProviderCallReceipt(result.evidence, responseBinding(RESPONSE));
  await validateProviderCall(receipt);
  assert.equal(receipt.execution_mode, "test_injected");
  assert.equal(receipt.provider_request_id, "req_fixture_1");
  assert.equal(receipt.transport_invocations, 1);
  assert.equal(receipt.retries, 0);
});

test("provider adapter records timeout, 429, HTTP, invalid output, response limit, and transport failure once", async (t) => {
  const cases = [
    {
      name: "timeout",
      code: "provider_timeout",
      transport: async (_request, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("timed out");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
    },
    {
      name: "429",
      code: "provider_rate_limited",
      transport: async () => ({ status: 429, headers: {}, body: Buffer.from('{"error":"rate"}') }),
    },
    {
      name: "http",
      code: "provider_http_error",
      transport: async () => ({ status: 503, headers: {}, body: Buffer.from('{"error":"down"}') }),
    },
    {
      name: "invalid",
      code: "provider_invalid_output",
      transport: async () => ({ status: 200, headers: {}, body: Buffer.from('{"unexpected":true}') }),
    },
    {
      name: "empty",
      code: "provider_invalid_output",
      transport: async () => ({ status: 200, headers: {}, body: Buffer.alloc(0) }),
    },
    {
      name: "limit",
      code: "provider_response_limit_exceeded",
      transport: async () => ({ status: 200, headers: {}, body: Buffer.alloc(4096, "x") }),
    },
    {
      name: "transport",
      code: "provider_transport_failed",
      transport: async () => {
        throw new Error("network unavailable");
      },
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      let calls = 0;
      const result = await executeOpenAIAudioTranslation(
        invocation(),
        {
          mode: "test",
          transport: async (...args) => {
            calls += 1;
            return item.transport(...args);
          },
        },
        {
          startedAt: "2026-07-20T00:00:00.000Z",
          now: () => "2026-07-20T00:00:02.000Z",
          providerResponsePath: "bench/attempts/provider-contract-run/provider-response.json",
        },
      );
      assert.equal(calls, 1);
      assert.equal(result.ok, false);
      assert.equal(result.failureCode, item.code);
      const binding = Buffer.isBuffer(result.responseBytes) ? responseBinding(result.responseBytes) : null;
      const receipt = materializeProviderCallReceipt(result.evidence, binding);
      await validateProviderCall(receipt);
      assert.equal(receipt.failure_code, item.code);
      assert.equal(receipt.transport_invocations, 1);
      assert.equal(receipt.retries, 0);
    });
  }
});

test("provider adapter refuses missing live gates and incompatible certified model before transport", () => {
  assert.throws(
    () => preflightOpenAIAudioTranslation(invocation(), null),
    /provider execution must be an object/,
  );
  assert.throws(
    () => preflightOpenAIAudioTranslation(invocation(), {
      mode: "live",
      allowLive: true,
      environment: "dry-run",
      apiKey: "test-key-not-used",
    }),
    /explicit flag, live environment, and API key/,
  );
  const bad = invocation();
  bad.hostContext.config.model = "gpt-not-registered";
  assert.throws(
    () => preflightOpenAIAudioTranslation(bad, {
      mode: "test",
      transport: async () => assert.fail("transport must not run"),
    }),
    /outside the closed audio translation contract/,
  );
});
