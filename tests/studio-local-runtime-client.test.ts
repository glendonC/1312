import assert from "node:assert/strict";
import test from "node:test";

import type { AnalysisRequest } from "../src/studio/preflight/model.ts";
import {
  LocalRuntimeHostClient,
  RuntimeHostClientError,
  normalizeLocalRuntimeHostBaseUrl,
} from "../src/studio/localRuntime/client.ts";
import {
  mapAnalysisRequestToRuntimeStart,
  projectLocalRuntimeLifecycle,
} from "../src/studio/localRuntime/model.ts";
import { createForecastArtifact } from "../src/studio/runtime/production/forecast/planner.ts";
import { parseRuntimeHostStartRequest } from "../src/studio/runtime/production/runtimeHost/validation.ts";
import type {
  RuntimeHostSourceSummary,
  RuntimeHostStartAcknowledgement,
} from "../src/studio/runtime/production/runtimeHost/model.ts";

const CONTENT = `sha256:${"a".repeat(64)}`;
const RECEIPT_CONTENT = `sha256:${"b".repeat(64)}`;
const SOURCE: RuntimeHostSourceSummary = {
  sourceSessionId: "source-session:fixture",
  sourceRevisionId: "source-revision:fixture",
  sourceContentId: CONTENT,
  label: "Owned fixture clip",
  rightsScope: "redistribution",
  durationMs: 47_200,
  trackCount: 2,
  preflightSchema: "studio.preflight-bundle.v3",
  detectedLanguageEvidenceAvailable: true,
};
const PLAN_FORECAST = createForecastArtifact({
  artifact: {
    artifactId: "artifact:fixture",
    contentId: CONTENT,
    measuredDurationMs: SOURCE.durationMs,
    durationMeasurement: {
      schema: "studio.media-probe.v1",
      producer: "scripts/probe-media.mjs",
      receiptContentId: `sha256:${"d".repeat(64)}`,
    },
  },
  range: { startMs: 0, endMs: SOURCE.durationMs },
  workPlan: {
    schema: "studio.forecast.work-plan.v1",
    planId: "plan:fixture",
    operations: [{
      operationId: "operation:fixture",
      kind: "runtime.worker-contract-proof",
      range: { startMs: 0, endMs: SOURCE.durationMs },
    }],
  },
});
const FORECAST_CONTENT = PLAN_FORECAST.content.contentId;

function makeAnalysisRequest(targetLanguage = "en", duration = SOURCE.durationMs / 1_000): AnalysisRequest {
  return {
    rangeMode: "custom",
    start: 0,
    end: duration,
    targetLanguage,
    outputDepth: "evidence",
    speechScope: "foreground",
    includeLyrics: false,
    speaker: null,
    honorifics: "preserve",
    translationStyle: "natural",
    captionDensity: "balanced",
    slowAnalysis: false,
    acceptLongLocal: false,
  };
}

function acknowledgement(
  schema: "studio.local-runtime-start-ack.v1" | "studio.local-runtime-status.v1" =
    "studio.local-runtime-start-ack.v1",
): RuntimeHostStartAcknowledgement | Record<string, unknown> {
  const commandId = "runtime-start:fixture";
  const runtimeId = "runtime:fixture";
  const journalId = "journal:fixture";
  const analysisRequestId = "analysis-request:fixture";
  const forecast = {
    forecastId: "forecast:fixture",
    contentId: FORECAST_CONTENT,
    frozenForecastId: "forecast-freeze:fixture",
    baselineStatus: "floor_only" as const,
  };
  return {
    schema,
    commandId,
    runtimeId,
    journalId,
    lifecycle: "terminal",
    acceptedAt: "2026-07-15T12:00:00.000Z",
    lastTransitionAt: "2026-07-15T12:00:01.000Z",
    reason: null,
    sourceSessionId: SOURCE.sourceSessionId,
    sourceRevisionId: SOURCE.sourceRevisionId,
    analysisRequestId,
    forecast,
    runStartReceipt: {
      contentId: RECEIPT_CONTENT,
      record: {
        schema: "studio.runtime-start.v1",
        commandId,
        runtimeId,
        journalId,
        sourceSession: {
          sessionId: SOURCE.sourceSessionId,
          revisionId: SOURCE.sourceRevisionId,
        },
        analysisRequest: {
          requestId: analysisRequestId,
        },
        forecast: {
          forecastId: forecast.forecastId,
          content: { contentId: forecast.contentId },
        },
        frozenForecast: { freezeId: forecast.frozenForecastId },
      },
    },
    journalHead: 7,
    terminal: true,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("existing AnalysisRequest maps to product-only host input with stable registered source identities", () => {
  const analysisRequest = {
    ...makeAnalysisRequest(),
    start: 1.25,
    end: 41.75,
    outputDepth: "evidence" as const,
    speechScope: "all" as const,
    includeLyrics: true,
  };
  const mapped = mapAnalysisRequestToRuntimeStart({
    source: SOURCE,
    analysisRequest,
    requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
    selectedLanguagePackId: "ko-v3",
  });

  assert.deepEqual(mapped, {
    sourceSessionId: SOURCE.sourceSessionId,
    sourceRevisionId: SOURCE.sourceRevisionId,
    range: { startMs: 1_250, endMs: 41_750 },
    requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
    targetLanguage: "en",
    selectedLanguagePackId: "ko-v3",
    outputDepth: "evidence",
    options: {
      speechScope: "all",
      includeLyrics: true,
      speaker: null,
      honorifics: "preserve",
      translationStyle: "natural",
      captionDensity: "balanced",
      slowAnalysis: false,
    },
  });
  assert.deepEqual(parseRuntimeHostStartRequest(mapped), mapped);
  assert.doesNotMatch(JSON.stringify(mapped), /(?:path|directory|runtimeRoot|journalPath|token)/i);
});

test("client mapping rejects path-like pack input and ranges outside the registered revision", () => {
  assert.throws(
    () => mapAnalysisRequestToRuntimeStart({
      source: SOURCE,
      analysisRequest: makeAnalysisRequest(),
      requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
      selectedLanguagePackId: "/tmp/pack",
    }),
    /must not contain path characters/,
  );
  assert.throws(
    () => mapAnalysisRequestToRuntimeStart({
      source: SOURCE,
      analysisRequest: makeAnalysisRequest("en", 60),
      requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
      selectedLanguagePackId: null,
    }),
    /exceeds the registered source duration/,
  );
});

test("lifecycle projection never promotes accepted or initializing to running and closes failures", () => {
  const accepted = projectLocalRuntimeLifecycle("accepted", null);
  const initializing = projectLocalRuntimeLifecycle("initializing", null);
  const running = projectLocalRuntimeLifecycle("running", null);
  const failed = projectLocalRuntimeLifecycle("failed", {
    code: "runtime_evidence_failed",
    message: "Validated runtime evidence contains a failed task.",
  });

  assert.equal(accepted.running, false);
  assert.match(accepted.detail, /not yet evidenced/);
  assert.equal(initializing.running, false);
  assert.match(initializing.detail, /not running/);
  assert.equal(running.running, true);
  assert.match(running.detail, /host reports validated/);
  assert.equal(failed.closed, true);
  assert.match(failed.detail, /runtime_evidence_failed/);
  assert.throws(() => projectLocalRuntimeLifecycle("interrupted", null), /requires a closed reason/);
});

test("browser client sends bearer auth, parses durable acknowledgement identities, and polls exact cursor", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/v1/source-sessions")) {
      return json({ schema: "studio.local-source-session-list.v1", sourceSessions: [SOURCE] });
    }
    if (url.endsWith("/v1/runtime-plans")) {
      return json({
        schema: "studio.local-runtime-plan.v1",
        commandId: "runtime-start:fixture",
        runtimeId: "runtime:fixture",
        sourceSessionId: SOURCE.sourceSessionId,
        sourceRevisionId: SOURCE.sourceRevisionId,
        analysisRequestId: "analysis-request:fixture",
        forecast: PLAN_FORECAST,
        acceptance: { status: "not_started", frozenForecastId: null },
      });
    }
    if (url.endsWith("/v1/runtime-starts")) return json(acknowledgement(), 202);
    if (url.endsWith("/v1/runtimes/runtime%3Afixture")) {
      return json(acknowledgement("studio.local-runtime-status.v1"));
    }
    if (url.endsWith("/v1/runtimes/runtime%3Afixture/events?after=7&limit=100")) {
      return json({
        schema: "studio.local-runtime-events.v1",
        commandId: "runtime-start:fixture",
        runtimeId: "runtime:fixture",
        lifecycle: "terminal",
        requestedCursor: 7,
        nextCursor: 7,
        journalHead: 7,
        events: [],
        reachedHead: true,
        terminal: true,
        reason: null,
      });
    }
    return json({ error: { code: "not_found", message: "Unexpected test URL." } }, 404);
  };
  const client = new LocalRuntimeHostClient({
    baseUrl: "http://127.0.0.1:4312/",
    token: "t".repeat(64),
    fetch: fetcher,
  });
  const sources = await client.listSourceSessions();
  const request = mapAnalysisRequestToRuntimeStart({
    source: sources[0],
    analysisRequest: makeAnalysisRequest("en", sources[0].durationMs / 1_000),
    requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
    selectedLanguagePackId: "ko-v3",
  });
  const plan = await client.plan(request);
  const start = await client.start(request);
  const status = await client.status(start.runtimeId);
  const poll = await client.poll(start.runtimeId, 7);

  assert.equal(client.baseUrl, "http://127.0.0.1:4312");
  assert.equal(plan.forecast.schema, "studio.forecast.v1");
  assert.equal(plan.forecast.scenarios.baseline.workload.requestedOperationMediaDurationMs, SOURCE.durationMs);
  assert.equal(plan.forecast.scenarios.baseline.elapsedDurationMs, null);
  assert.equal(plan.acceptance.frozenForecastId, null);
  assert.equal(start.commandId, "runtime-start:fixture");
  assert.equal(start.runStartReceipt?.contentId, RECEIPT_CONTENT);
  assert.equal(start.forecast?.frozenForecastId, "forecast-freeze:fixture");
  assert.equal(status.lifecycle, "terminal");
  assert.equal(poll.nextCursor, 7);
  assert.equal(poll.reachedHead, true);
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(new Headers(call.init?.headers).get("Authorization"), `Bearer ${"t".repeat(64)}`);
  }
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), request);
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), request);
});

test("browser client rejects a plan that invents elapsed, usage, or price values", async () => {
  const request = mapAnalysisRequestToRuntimeStart({
    source: SOURCE,
    analysisRequest: makeAnalysisRequest(),
    requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
    selectedLanguagePackId: null,
  });
  const invented = structuredClone(PLAN_FORECAST) as unknown as {
    scenarios: { baseline: { elapsedDurationMs: number | null } };
  };
  invented.scenarios.baseline.elapsedDurationMs = 12_345;
  const client = new LocalRuntimeHostClient({
    baseUrl: "http://127.0.0.1:4312",
    token: "t".repeat(64),
    fetch: async () => json({
      schema: "studio.local-runtime-plan.v1",
      commandId: "runtime-start:fixture",
      runtimeId: "runtime:fixture",
      sourceSessionId: SOURCE.sourceSessionId,
      sourceRevisionId: SOURCE.sourceRevisionId,
      analysisRequestId: "analysis-request:fixture",
      forecast: invented,
      acceptance: { status: "not_started", frozenForecastId: null },
    }),
  });

  await assert.rejects(
    client.plan(request),
    (error: unknown) => error instanceof RuntimeHostClientError &&
      error.code === "invalid_host_response" &&
      /elapsed duration and model usage must remain unavailable/.test(error.message),
  );
});

test("browser client surfaces host cursor errors and rejects inconsistent poll cursors", async () => {
  const hostErrorClient = new LocalRuntimeHostClient({
    baseUrl: "http://localhost:4312",
    token: "t".repeat(64),
    fetch: async () => json({
      schema: "studio.local-runtime-error.v1",
      error: { code: "cursor_past_head", message: "The requested cursor is beyond the validated journal head." },
    }, 409),
  });
  await assert.rejects(
    hostErrorClient.poll("runtime:fixture", 8),
    (error: unknown) => error instanceof RuntimeHostClientError &&
      error.code === "cursor_past_head" &&
      error.httpStatus === 409,
  );

  const invalidClient = new LocalRuntimeHostClient({
    baseUrl: "http://127.0.0.1:4312",
    token: "t".repeat(64),
    fetch: async () => json({
      schema: "studio.local-runtime-events.v1",
      commandId: "runtime-start:fixture",
      runtimeId: "runtime:fixture",
      lifecycle: "running",
      requestedCursor: 4,
      nextCursor: 5,
      journalHead: 5,
      events: [],
      reachedHead: true,
      terminal: false,
      reason: null,
    }),
  });
  await assert.rejects(
    invalidClient.poll("runtime:fixture", 4),
    (error: unknown) => error instanceof RuntimeHostClientError && error.code === "invalid_host_response",
  );
});

test("host configuration accepts only exact loopback HTTP origins", () => {
  assert.equal(normalizeLocalRuntimeHostBaseUrl("http://localhost:4312/"), "http://localhost:4312");
  assert.equal(normalizeLocalRuntimeHostBaseUrl("http://[::1]:4312"), "http://[::1]:4312");
  assert.throws(() => normalizeLocalRuntimeHostBaseUrl("https://example.com"), /exact loopback HTTP origin/);
  assert.throws(() => normalizeLocalRuntimeHostBaseUrl("http://127.0.0.1:4312/v1"), /exact loopback HTTP origin/);
});
