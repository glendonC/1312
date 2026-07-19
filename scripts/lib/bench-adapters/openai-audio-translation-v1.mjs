/**
 * One-call OpenAI audio translation adapter for rule-change qualification.
 *
 * The host owns invocation, charging, response persistence, and capture attribution. This module
 * owns one deterministic multipart request and one transport call. It never retries or selects.
 */

import { createHash } from "node:crypto";

export const OPENAI_AUDIO_TRANSLATION_ADAPTER_ID = "openai_audio_translation_v1";
export const OPENAI_AUDIO_TRANSLATION_ENDPOINT = "https://api.openai.com/v1/audio/translations";
export const PROVIDER_CALL_SCHEMA = "studio.bench.provider-call.v1";

const FAILURE_CODES = new Set([
  "provider_timeout",
  "provider_rate_limited",
  "provider_http_error",
  "provider_transport_failed",
  "provider_invalid_output",
  "provider_response_limit_exceeded",
]);

function fail(message) {
  throw new Error(`openai audio translation adapter: ${message}`);
}

function requiredText(value, context) {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${context} must be a non-empty string`);
  return value;
}

function exactTimestamp(value, context) {
  requiredText(value, context);
  if (Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail(`${context} must be an exact ISO-8601 UTC timestamp`);
  }
  return value;
}

function exactKeys(value, keys, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${context} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${context} keys must be exactly ${expected.join(", ")}`);
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  if (value === undefined) fail("receipt values cannot contain undefined");
  if (typeof value === "number" && !Number.isFinite(value)) fail("receipt numbers must be finite");
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function contentId(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function contentIdForJson(value) {
  return contentId(Buffer.from(canonicalJson(value)));
}

function receiptId(value) {
  const { provider_call_id: _id, ...body } = value;
  return `bench-provider-call:${contentIdForJson({ provider_call_id: null, ...body })}`;
}

function mediaType(filename) {
  const extension = filename.toLowerCase().split(".").pop();
  return new Map([
    ["flac", "audio/flac"],
    ["mp3", "audio/mpeg"],
    ["mp4", "video/mp4"],
    ["mpeg", "audio/mpeg"],
    ["mpga", "audio/mpeg"],
    ["m4a", "audio/mp4"],
    ["ogg", "audio/ogg"],
    ["wav", "audio/wav"],
    ["webm", "audio/webm"],
  ]).get(extension) ?? null;
}

function headerBlock(boundary, name, value) {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  );
}

function fileBlock(boundary, filename, type, bytes) {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    bytes,
    Buffer.from("\r\n"),
  ]);
}

function promptFor(hostContext) {
  const entries = hostContext.reviewed_memory.entries;
  if (!Array.isArray(entries) || entries.length > 1) fail("host context must carry zero or one candidate rule");
  const base = [
    "Translate the complete Korean recording into English.",
    "Preserve uncertainty, unfinished clauses, discourse linkage, names, quantities, and supported relationships.",
    "Do not use reference answers or invent content that the recording does not support.",
  ].join(" ");
  if (entries.length === 0) return { text: base, ruleContentId: null };
  const entry = entries[0];
  exactKeys(
    entry,
    ["namespace", "kind", "key", "value", "proposal_id", "rule_content_id", "status"],
    "candidate rule",
  );
  if (entry.kind !== "rule" || entry.status !== "qualification_candidate") {
    fail("host context entry is not a qualification candidate rule");
  }
  exactKeys(entry.value, ["instruction"], "candidate rule value");
  requiredText(entry.value.instruction, "candidate rule instruction");
  if (contentIdForJson(entry.value) !== entry.rule_content_id) fail("candidate rule content id is stale");
  return {
    text: `${base}\nCandidate rule: ${entry.value.instruction}`,
    ruleContentId: entry.rule_content_id,
  };
}

function configuration(invocation) {
  const config = invocation.hostContext.config;
  exactKeys(config, ["model", "provider", "reviewed_memory"], "certified provider config");
  exactKeys(
    config.provider,
    ["id", "operation", "response_format", "temperature", "timeout_ms", "max_response_bytes"],
    "certified provider config.provider",
  );
  exactKeys(config.reviewed_memory, ["rule_content_id"], "certified provider config.reviewed_memory");
  if (
    config.model !== "whisper-1" ||
    config.provider.id !== "openai" ||
    config.provider.operation !== "audio_translation" ||
    config.provider.response_format !== "verbose_json" ||
    config.provider.temperature !== 0 ||
    !Number.isInteger(config.provider.timeout_ms) ||
    config.provider.timeout_ms < 1 ||
    config.provider.timeout_ms > 600_000 ||
    !Number.isInteger(config.provider.max_response_bytes) ||
    config.provider.max_response_bytes < 1 ||
    config.provider.max_response_bytes > 16_777_216
  ) {
    fail("certified provider config is outside the closed audio translation contract");
  }
  return config;
}

function invocationShape(invocation) {
  exactKeys(
    invocation,
    ["attemptId", "run", "clipId", "repetition", "side", "source", "clip", "hostContext"],
    "invocation",
  );
  exactKeys(invocation.source, ["contentId", "bytes", "dataBase64", "filename"], "invocation.source");
  exactKeys(invocation.clip, ["durationS", "lang", "pair", "source"], "invocation.clip");
  requiredText(invocation.attemptId, "invocation.attemptId");
  requiredText(invocation.run, "invocation.run");
  requiredText(invocation.clipId, "invocation.clipId");
  if (!Number.isInteger(invocation.repetition) || invocation.repetition < 1) fail("invocation.repetition is invalid");
  if (!new Set(["without", "with"]).has(invocation.side)) fail("invocation.side is invalid");
  if (!/^sha256:[a-f0-9]{64}$/.test(invocation.source.contentId)) fail("invocation source content id is invalid");
  if (!Number.isInteger(invocation.source.bytes) || invocation.source.bytes < 1) fail("invocation source bytes are invalid");
  const sourceBytes = Buffer.from(invocation.source.dataBase64, "base64");
  if (sourceBytes.length !== invocation.source.bytes || contentId(sourceBytes) !== invocation.source.contentId) {
    fail("invocation source bytes differ from their certified identity");
  }
  const filename = requiredText(invocation.source.filename, "invocation source filename");
  if (filename.includes("/") || filename.includes("\\") || !mediaType(filename)) {
    fail("invocation source filename is not one supported media basename");
  }
  if (typeof invocation.clip.durationS !== "number" || invocation.clip.durationS <= 0) {
    fail("invocation clip duration is invalid");
  }
  requiredText(invocation.clip.lang, "invocation clip language");
  requiredText(invocation.clip.pair, "invocation clip pair");
  exactKeys(invocation.clip.source, ["kind", "url", "channel", "licence", "window", "attribution"], "invocation clip source");
  for (const key of ["kind", "url", "channel", "licence", "attribution"]) {
    if (typeof invocation.clip.source[key] !== "string") fail(`invocation clip source ${key} must be a string`);
  }
  return sourceBytes;
}

export function buildOpenAIAudioTranslationRequest(invocation) {
  const sourceBytes = invocationShape(invocation);
  const config = configuration(invocation);
  const prompt = promptFor(invocation.hostContext);
  if (config.reviewed_memory.rule_content_id !== prompt.ruleContentId) {
    fail("certified config rule content id differs from compiled host context");
  }
  const boundary = `studio-il03-${createHash("sha256").update(invocation.attemptId).digest("hex").slice(0, 32)}`;
  const body = Buffer.concat([
    fileBlock(boundary, invocation.source.filename, mediaType(invocation.source.filename), sourceBytes),
    headerBlock(boundary, "model", config.model),
    headerBlock(boundary, "prompt", prompt.text),
    headerBlock(boundary, "response_format", config.provider.response_format),
    headerBlock(boundary, "temperature", String(config.provider.temperature)),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  return {
    url: OPENAI_AUDIO_TRANSLATION_ENDPOINT,
    method: "POST",
    contentType: `multipart/form-data; boundary=${boundary}`,
    body,
    prompt: {
      content_id: contentId(Buffer.from(prompt.text)),
      bytes: Buffer.byteLength(prompt.text),
      rule_content_id: prompt.ruleContentId,
    },
    request: { content_id: contentId(body), bytes: body.length },
    config,
  };
}

export function preflightOpenAIAudioTranslation(invocation, execution) {
  buildOpenAIAudioTranslationRequest(invocation);
  exactKeys(execution, execution?.mode === "test" ? ["mode", "transport"] : ["mode", "allowLive", "environment", "apiKey"], "provider execution");
  if (execution.mode === "test") {
    if (typeof execution.transport !== "function") fail("test provider transport must be a function");
    return { executionMode: "test_injected" };
  }
  if (
    execution.mode !== "live" ||
    execution.allowLive !== true ||
    execution.environment !== "live" ||
    typeof execution.apiKey !== "string" ||
    execution.apiKey.length === 0
  ) {
    fail("live provider execution requires the explicit flag, live environment, and API key");
  }
  return { executionMode: "live_openai" };
}

function responseHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found ? String(found[1]) : null;
}

async function boundedFetchTransport(request, { apiKey, signal, maxResponseBytes }) {
  const response = await fetch(request.url, {
    method: request.method,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": request.contentType,
    },
    body: request.body,
    signal,
  });
  if (!response.body || typeof response.body.getReader !== "function") {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maxResponseBytes) {
      const error = new Error("provider response exceeded its certified byte limit");
      error.code = "PROVIDER_RESPONSE_LIMIT";
      throw error;
    }
    return { status: response.status, headers: response.headers, body };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxResponseBytes) {
      await reader.cancel();
      const error = new Error("provider response exceeded its certified byte limit");
      error.code = "PROVIDER_RESPONSE_LIMIT";
      throw error;
    }
    chunks.push(Buffer.from(value));
  }
  return { status: response.status, headers: response.headers, body: Buffer.concat(chunks) };
}

function providerFailure(error) {
  if (error?.code === "PROVIDER_RESPONSE_LIMIT") return "provider_response_limit_exceeded";
  if (error?.name === "AbortError" || error?.code === "ETIMEDOUT") return "provider_timeout";
  return "provider_transport_failed";
}

function parsedTranslation(bytes, durationLimit) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("provider response is not JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.text !== "string") {
    fail("provider response does not contain translation text");
  }
  if (value.segments !== undefined && !Array.isArray(value.segments)) fail("provider response segments are invalid");
  const segments = value.segments ?? [];
  const units = segments.map((segment, index) => {
    if (
      !segment ||
      typeof segment !== "object" ||
      typeof segment.start !== "number" ||
      typeof segment.end !== "number" ||
      segment.start < 0 ||
      segment.end < segment.start ||
      segment.end > durationLimit + 1 ||
      typeof segment.text !== "string"
    ) {
      fail(`provider response segment ${index} is invalid`);
    }
    return { t_start: segment.start, t_end: segment.end, text: segment.text.trim() };
  });
  if (units.length === 0 && value.text.trim().length > 0) {
    units.push({ t_start: 0, t_end: durationLimit, text: value.text.trim() });
  }
  return units;
}

export function captureFromOpenAIAudioTranslation(
  invocation,
  responseBytes,
  { completedAt, startedAt, providerResponsePath },
) {
  invocationShape(invocation);
  configuration(invocation);
  exactTimestamp(startedAt, "provider started_at");
  exactTimestamp(completedAt, "provider completed_at");
  if (Date.parse(completedAt) < Date.parse(startedAt)) fail("provider completion predates its start");
  const units = parsedTranslation(responseBytes, invocation.clip.durationS);
  const emitted = units.filter((unit) => unit.text.length > 0).length;
  const systemId = invocation.hostContext.system_id;
  return {
    schema_version: "0.1.0",
    kind: "capture",
    capture_id: invocation.run,
    captured_at: completedAt.slice(0, 10),
    scored: false,
    pack_evidence: false,
    clip: {
      id: invocation.clipId,
      duration_s: invocation.clip.durationS,
      lang: invocation.clip.lang,
      pair: invocation.clip.pair,
      media: null,
      source: structuredClone(invocation.clip.source),
    },
    reproducible: {
      deterministic: false,
      note: "One provider translation call with no retry or output selection. Provider behavior is not deterministic.",
    },
    systems: [{
      id: systemId,
      role: "subject",
      config: structuredClone(invocation.hostContext.config),
    }],
    measured: {
      [systemId]: {
        units_total: units.length,
        units_emitted: emitted,
        units_withheld: 0,
        coverage: units.length === 0 ? 0 : emitted / units.length,
        latency: {
          first_usable_s: null,
          complete_s: (Date.parse(completedAt) - Date.parse(startedAt)) / 1000,
        },
      },
    },
    unscored: {
      critical_meaning: null,
      critical_outcomes: null,
      catastrophic: null,
      reason: "Provider capture has no semantic authority. Human labels and separate scores are required.",
    },
    units: units.map((unit) => ({
      t_start: unit.t_start,
      t_end: unit.t_end,
      source: "",
      outputs: {
        [systemId]: { text: unit.text.length === 0 ? null : unit.text, withheld: null },
      },
      gold: null,
    })),
    artifacts: { provider_response: providerResponsePath },
    notes: "Unscored OpenAI audio translation capture. Empty source text records that the endpoint returned English translation only.",
  };
}

function evidenceBody(invocation, request, executionMode, startedAt, completedAt, outcome) {
  return {
    schema: PROVIDER_CALL_SCHEMA,
    attempt_id: invocation.attemptId,
    started_at: startedAt,
    completed_at: completedAt,
    execution_mode: executionMode,
    provider: "openai",
    operation: "audio_translation",
    endpoint: OPENAI_AUDIO_TRANSLATION_ENDPOINT,
    method: "POST",
    requested_model: request.config.model,
    host_context_id: invocation.hostContext.context_id,
    media: { content_id: invocation.source.contentId, bytes: invocation.source.bytes },
    prompt: request.prompt,
    request: request.request,
    http_status: outcome.httpStatus,
    provider_request_id: outcome.providerRequestId,
    response: null,
    outcome: outcome.failureCode === null ? "success" : "failed",
    failure_code: outcome.failureCode,
    transport_invocations: 1,
    retries: 0,
  };
}

export function materializeProviderCallReceipt(evidence, responseBinding) {
  const body = { ...evidence, response: responseBinding };
  if (!new Set(["success", "failed"]).has(body.outcome)) fail("provider outcome is invalid");
  if (body.outcome === "success" && (body.failure_code !== null || !responseBinding)) {
    fail("successful provider call must bind one response and no failure code");
  }
  if (body.outcome === "failed" && !FAILURE_CODES.has(body.failure_code)) {
    fail("failed provider call does not carry a registered failure code");
  }
  return { provider_call_id: receiptId(body), ...body };
}

export async function executeOpenAIAudioTranslation(
  invocation,
  execution,
  {
    startedAt = new Date().toISOString(),
    now = () => new Date().toISOString(),
    providerResponsePath,
  } = {},
) {
  const { executionMode } = preflightOpenAIAudioTranslation(invocation, execution);
  const request = buildOpenAIAudioTranslationRequest(invocation);
  const start = exactTimestamp(startedAt, "provider started_at");
  requiredText(providerResponsePath, "provider response path");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.config.provider.timeout_ms);
  let response = null;
  let failureCode = null;
  try {
    const transport = execution.mode === "test" ? execution.transport : boundedFetchTransport;
    response = await transport(request, {
      apiKey: execution.mode === "live" ? execution.apiKey : null,
      signal: controller.signal,
      maxResponseBytes: request.config.provider.max_response_bytes,
    });
  } catch (error) {
    failureCode = providerFailure(error);
  } finally {
    clearTimeout(timeout);
  }
  const completedAt = exactTimestamp(now(), "provider completed_at");
  if (Date.parse(completedAt) < Date.parse(start)) fail("provider completion predates its start");
  if (failureCode === null) {
    if (
      !response ||
      !Number.isInteger(response.status) ||
      response.status < 100 ||
      response.status > 599 ||
      !Buffer.isBuffer(response.body)
    ) {
      failureCode = "provider_transport_failed";
      response = null;
    } else if (response.body.length > request.config.provider.max_response_bytes) {
      failureCode = "provider_response_limit_exceeded";
    } else if (response.status === 429) {
      failureCode = "provider_rate_limited";
    } else if (response.status < 200 || response.status >= 300) {
      failureCode = "provider_http_error";
    } else {
      try {
        parsedTranslation(response.body, invocation.clip.durationS);
      } catch {
        failureCode = "provider_invalid_output";
      }
    }
  }
  const providerRequestId = responseHeader(response?.headers, "x-request-id");
  const evidence = evidenceBody(invocation, request, executionMode, start, completedAt, {
    httpStatus: response?.status ?? null,
    providerRequestId: providerRequestId && providerRequestId.length > 0 ? providerRequestId : null,
    failureCode,
  });
  if (failureCode !== null) {
    return { ok: false, evidence, responseBytes: response?.body ?? null, failureCode };
  }
  return {
    ok: true,
    evidence,
    responseBytes: response.body,
    capture: captureFromOpenAIAudioTranslation(invocation, response.body, {
      startedAt: start,
      completedAt,
      providerResponsePath,
    }),
  };
}
