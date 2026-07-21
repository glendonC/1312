import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  CAPTION_PRODUCTION_201,
  CAPTION_PRODUCTIONS_200,
  CAPTION_PRODUCTION_RESULTS_200,
  CAPTION_PRODUCTION_RESULTS_TEST_SEAM_200,
  CAPTION_QC_409,
  CAPTION_QUALITY_CONTROLS_200,
  CAPTION_QUALITY_CONTROLS_TEST_SEAM_200,
  DECISION_RECEIPTS_200,
  LANGUAGE_EXPLANATIONS_200,
  LANGUAGE_EXPLANATIONS_201,
  OWNED_MEDIA_INGEST_GET_200,
  OWNED_MEDIA_INGEST_POST_202,
  OWNED_MEDIA_INGEST_PUT_202,
  PRIVATE_PLAYBACK_GRANT_201,
  PRIVATE_PLAYBACK_REVOKE_200,
  PUBLISH_REVIEW_DECISION_201,
  PUBLISH_REVIEW_DECISIONS_200,
  PUBLISH_REVIEW_REVOCATION_201,
  RUNTIME_EVENTS_200,
  RUNTIME_PLAN_200,
  RUNTIME_START_ACK_202,
  RUNTIME_STATUS_200,
  YOUTUBE_INGEST_202,
  YOUTUBE_INGEST_GET_200,
} from "../src/features/api/examples.ts";
import {
  API_ENDPOINT_GROUPS,
  API_PAGES,
  API_SUCCESSFUL_PATH,
  type ApiResponsePanel,
  CAPTION_REQUEST_EXAMPLE,
  ERROR_SCHEMA,
  LANGUAGE_REQUEST_EXAMPLE,
  PRIVATE_MEDIA_STATUS_LINE,
  REVIEW_DECISION_EXAMPLE,
  REVIEW_REVOCATION_EXAMPLE,
  SMOKE_TO_TERMINAL_DISPLAY,
  START_REQUEST_EXAMPLE,
  WORKER_TOOLS,
} from "../src/features/api/model.ts";

const RUNTIME_HOST_DIR = new URL("../src/studio/runtime/production/runtimeHost/", import.meta.url);
const EXECUTOR_DIR = new URL("../src/studio/runtime/production/executor/", import.meta.url);

const readHostSource = async (file: string): Promise<string> =>
  readFile(new URL(file, RUNTIME_HOST_DIR), "utf8");

test("every documented endpoint path is present in the runtime host router source", async () => {
  const routerSource = await readHostSource("httpServer.ts");
  const endpoints = API_ENDPOINT_GROUPS.flatMap((group) => group.endpoints);
  assert.ok(endpoints.length >= 20, "the documented surface covers the full router");
  for (const endpoint of endpoints) {
    assert.ok(endpoint.path.startsWith("/v1/"), `${endpoint.path} is versioned under /v1`);
    const staticSegments = endpoint.path
      .split("/")
      .filter((segment) => segment !== "" && segment !== "v1" && !segment.startsWith(":"));
    assert.ok(staticSegments.length > 0, `${endpoint.path} names at least one static segment`);
    for (const segment of staticSegments) {
      assert.ok(
        routerSource.includes(segment),
        `router source names the "${segment}" segment of ${endpoint.path}`,
      );
    }
    for (const method of endpoint.methods) {
      assert.ok(
        ["GET", "HEAD", "POST", "PUT"].includes(method),
        `${endpoint.path} documents a served method, got "${method}"`,
      );
    }
  }
});

test("every documented response schema is declared by the runtime host source", async () => {
  const contractSource = [
    await readHostSource("model.ts"),
    await readHostSource("service.ts"),
    await readHostSource("httpServer.ts"),
  ].join("\n");
  const schemas = new Set<string>([ERROR_SCHEMA]);
  for (const group of API_ENDPOINT_GROUPS) {
    for (const endpoint of group.endpoints) {
      if (endpoint.responseSchema !== null) schemas.add(endpoint.responseSchema);
    }
  }
  for (const schema of schemas) {
    assert.ok(
      contractSource.includes(`"${schema}"`),
      `runtime host source declares the "${schema}" schema tag`,
    );
  }
});

test("every documented field name exists in the runtime host contract source", async () => {
  const contractSource = [
    await readHostSource("model.ts"),
    await readHostSource("journalPolling.ts"),
    await readHostSource("../model/review.ts"),
    await readHostSource("../model/captions.ts"),
    await readHostSource("../model/languageExplanations.ts"),
  ].join("\n");
  const fields = API_ENDPOINT_GROUPS.flatMap((group) =>
    group.endpoints.flatMap((endpoint) => endpoint.fieldTables.flatMap((table) => table.fields)),
  );
  assert.ok(fields.length >= 30, "the field reference documents the core contract shapes");
  for (const field of fields) {
    const namePattern = new RegExp(`\\b${field.name}\\b`);
    assert.ok(
      namePattern.test(contractSource),
      `runtime host model declares the documented field "${field.name}"`,
    );
  }
});

test("every documented worker tool name exists in the executor bridge sources", async () => {
  const entries = await readdir(EXECUTOR_DIR);
  const sources = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".ts"))
      .map((entry) => readFile(new URL(entry, EXECUTOR_DIR), "utf8")),
  );
  const executorSource = sources.join("\n");
  for (const tool of WORKER_TOOLS) {
    assert.ok(
      executorSource.includes(`"${tool}"`),
      `executor sources declare the "${tool}" worker tool`,
    );
  }
});

test("code panels are executable requests or parseable captured responses", () => {
  const documented = new Set<string>([ERROR_SCHEMA]);
  for (const group of API_ENDPOINT_GROUPS) {
    for (const endpoint of group.endpoints) {
      if (endpoint.responseSchema !== null) documented.add(endpoint.responseSchema);
    }
  }
  const panels = API_ENDPOINT_GROUPS.flatMap((group) =>
    group.endpoints.flatMap((endpoint) => endpoint.panels),
  );
  const requests = panels.filter((panel) => panel.kind === "request");
  const responses = panels.filter((panel) => panel.kind === "response");
  assert.ok(requests.length >= 18, "request panels cover the surface");
  assert.ok(responses.length >= 8, "response panels cover the surface");
  for (const endpoint of API_ENDPOINT_GROUPS.flatMap((group) => group.endpoints)) {
    assert.ok(
      endpoint.panels.length > 0 || endpoint.fieldTables.length > 0,
      `${endpoint.methods.join("|")} ${endpoint.path} documents fields or an example panel`,
    );
  }
  for (const panel of requests) {
    assert.ok(panel.body.startsWith("curl"), `request panel "${panel.title}" is an executable curl`);
  }
  for (const endpoint of API_ENDPOINT_GROUPS.flatMap((group) => group.endpoints)) {
    for (const panel of endpoint.panels.filter(
      (candidate): candidate is ApiResponsePanel => candidate.kind === "response",
    )) {
      assert.ok(
        panel.provenance === "captured" || panel.provenance === "illustrative",
        `response panel "${panel.title}" declares captured or illustrative authority`,
      );
      assert.match(
        panel.status,
        /^\d{3}$/,
        `response panel "${panel.title}" names the HTTP status it answers with`,
      );
      if (endpoint.responseSchema === null) {
        assert.ok(
          !/^\s*\{/.test(panel.body),
          `binary response panel "${panel.title}" must not invent a JSON success body`,
        );
        continue;
      }
      const parsed = JSON.parse(panel.body) as { schema?: unknown };
      assert.equal(typeof parsed.schema, "string", `response panel "${panel.title}" carries a schema tag`);
      assert.ok(
        documented.has(parsed.schema as string),
        `response panel schema "${String(parsed.schema)}" is documented`,
      );
    }
  }
});

test("successful path matches host authority order and smoke stays local", () => {
  const hrefs = API_SUCCESSFUL_PATH.map((step) => step.href);
  assert.deepEqual(hrefs, [
    "/api/sources/",
    "/api/runtime/",
    "/api/audits/",
    "/api/review/",
    "/api/captions/",
    "/api/playback/",
    "/api/language/",
  ]);
  assert.ok(!hrefs.includes("/api/improve/"), "Improve is not a Successful Path /v1 step");
  assert.ok(SMOKE_TO_TERMINAL_DISPLAY.includes("/v1/source-sessions"));
  assert.ok(SMOKE_TO_TERMINAL_DISPLAY.includes("/v1/runtime-plans"));
  assert.ok(SMOKE_TO_TERMINAL_DISPLAY.includes("/v1/runtime-starts"));
  assert.ok(SMOKE_TO_TERMINAL_DISPLAY.includes("/v1/runtimes/$RUNTIME_ID/events"));
  assert.ok(SMOKE_TO_TERMINAL_DISPLAY.includes("no SaaS"));
  assert.ok(SMOKE_TO_TERMINAL_DISPLAY.includes("Publish Review"));
  assert.ok(
    SMOKE_TO_TERMINAL_DISPLAY.includes("--allow-deterministic-caption-test-seam"),
    "smoke notes caption opt-in seam",
  );
  assert.ok(
    SMOKE_TO_TERMINAL_DISPLAY.includes("--allow-real-language-explanation"),
    "smoke notes language opt-in flags",
  );

  const captionsPath = API_SUCCESSFUL_PATH.find((step) => step.href === "/api/captions/");
  const languagePath = API_SUCCESSFUL_PATH.find((step) => step.href === "/api/language/");
  assert.ok(captionsPath?.detail.includes("opt-in"), "Successful Path captions mark opt-in 201");
  assert.ok(languagePath?.detail.includes("opt-in"), "Successful Path language marks opt-in 201");

  const improvePage = API_PAGES.find((page) => page.slug === "improve");
  assert.ok(improvePage?.description.includes("not a /v1"), "Improve page meta denies host surface");
});

test("documented example shapes stay bound to the contract they claim", () => {
  assert.equal(START_REQUEST_EXAMPLE.requestedSourceLanguage.mode, "declared");
  assert.ok(START_REQUEST_EXAMPLE.range.endMs > START_REQUEST_EXAMPLE.range.startMs);

  const plan = JSON.parse(RUNTIME_PLAN_200) as { schema?: string; acceptance?: { status?: string } };
  const start = JSON.parse(RUNTIME_START_ACK_202) as {
    schema?: string;
    lifecycle?: string;
    terminal?: boolean;
    commandId?: string;
    runtimeId?: string;
  };
  const status = JSON.parse(RUNTIME_STATUS_200) as {
    schema?: string;
    lifecycle?: string;
    terminal?: boolean;
    commandId?: string;
    runtimeId?: string;
  };
  assert.equal(plan.schema, "studio.local-runtime-plan.v1");
  assert.equal(plan.acceptance?.status, "not_started");
  assert.equal(start.schema, "studio.local-runtime-start-ack.v1");
  assert.equal(start.lifecycle, "initializing");
  assert.equal(start.terminal, false);
  assert.equal(status.schema, "studio.local-runtime-status.v1");
  assert.equal(status.lifecycle, "terminal");
  assert.equal(status.terminal, true);
  assert.equal(start.commandId, status.commandId);
  assert.equal(start.runtimeId, status.runtimeId);

  const startAck = JSON.parse(RUNTIME_START_ACK_202) as { acceptedAt?: string };
  const eventsPage = JSON.parse(RUNTIME_EVENTS_200) as {
    schema?: string;
    runtimeId?: string;
    commandId?: string;
    reachedHead?: boolean;
    events?: Array<{ recordedAt?: string; seq?: number }>;
  };
  assert.equal(eventsPage.schema, "studio.local-runtime-events.v1");
  assert.equal(eventsPage.runtimeId, status.runtimeId);
  assert.equal(eventsPage.commandId, status.commandId);
  assert.equal(eventsPage.reachedHead, false, "events panel is a truncated continuous-session sample");
  assert.ok((eventsPage.events?.length ?? 0) >= 1);
  assert.ok(
    (eventsPage.events?.[0]?.recordedAt ?? "") >= (startAck.acceptedAt ?? ""),
    "Option B events are not from an earlier host session than start",
  );

  const decision201 = JSON.parse(PUBLISH_REVIEW_DECISION_201) as {
    schema?: string;
    runtimeId?: string;
    reviews?: Array<{ reviewId?: string; artifactId?: string; receiptContentId?: string }>;
  };
  assert.equal(decision201.schema, "studio.local-runtime-publish-review-decisions.v1");
  assert.equal(decision201.runtimeId, status.runtimeId);
  assert.equal(decision201.reviews?.[0]?.reviewId, CAPTION_REQUEST_EXAMPLE.approval.reviewId);
  assert.ok(REVIEW_DECISION_EXAMPLE.intake.intakeId.startsWith("publish-review-intake:"));
  assert.notEqual(
    decision201.reviews?.[0]?.reviewId,
    REVIEW_REVOCATION_EXAMPLE.approval.reviewId,
    "continuous approve is a separate family from parked revocation",
  );

  const decisionsGet = JSON.parse(PUBLISH_REVIEW_DECISIONS_200) as {
    schema?: string;
    reviews?: unknown[];
    reviewer?: { id?: string };
  };
  const revocation = JSON.parse(PUBLISH_REVIEW_REVOCATION_201) as {
    schema?: string;
    reviews?: Array<{
      state?: string;
      reviewId?: string;
      revocation?: { reasonCodes?: string[] } | null;
    }>;
  };
  const youtubePost = JSON.parse(YOUTUBE_INGEST_202) as {
    schema?: string;
    status?: string;
    source?: unknown;
    failure?: unknown;
    ingestId?: string;
  };
  const youtubeGet = JSON.parse(YOUTUBE_INGEST_GET_200) as {
    schema?: string;
    status?: string;
    source?: {
      sourceKind?: string;
      rightsScope?: string;
      durationMs?: number;
      detectedLanguageEvidenceAvailable?: boolean;
    } | null;
    failure?: unknown;
    ingestId?: string;
  };
  const captionProductions = JSON.parse(CAPTION_PRODUCTIONS_200) as {
    schema?: string;
    captions?: unknown[];
    runtimeId?: string;
  };
  const captionResults = JSON.parse(CAPTION_PRODUCTION_RESULTS_200) as {
    schema?: string;
    results?: unknown[];
  };
  const captionQc = JSON.parse(CAPTION_QUALITY_CONTROLS_200) as {
    schema?: string;
    qualityControls?: unknown[];
  };
  assert.equal(decisionsGet.schema, "studio.local-runtime-publish-review-decisions.v1");
  assert.deepEqual(decisionsGet.reviews, []);
  assert.equal(decisionsGet.reviewer?.id, "reviewer:local-operator");
  assert.equal(revocation.schema, "studio.local-runtime-publish-review-decisions.v1");
  assert.equal(revocation.reviews?.[0]?.state, "approval_revoked");
  assert.ok(revocation.reviews?.[0]?.revocation);
  assert.deepEqual(revocation.reviews?.[0]?.revocation?.reasonCodes, ["approval_entered_in_error"]);
  assert.equal(revocation.reviews?.[0]?.reviewId, REVIEW_REVOCATION_EXAMPLE.approval.reviewId);
  assert.equal(youtubePost.schema, "studio.youtube-local-ingest.v1");
  assert.equal(youtubePost.status, "queued");
  assert.equal(youtubePost.source, null);
  assert.equal(youtubePost.failure, null);
  assert.equal(youtubeGet.schema, "studio.youtube-local-ingest.v1");
  assert.equal(youtubeGet.status, "registered");
  assert.equal(youtubeGet.failure, null);
  assert.equal(youtubePost.ingestId, youtubeGet.ingestId);
  assert.equal(youtubeGet.source?.sourceKind, "youtube_local");
  assert.equal(youtubeGet.source?.rightsScope, "local_processing");
  assert.equal(youtubeGet.source?.durationMs, 30_030);
  assert.equal(youtubeGet.source?.detectedLanguageEvidenceAvailable, false);
  const youtubeGetPanel = API_ENDPOINT_GROUPS.flatMap((group) => group.endpoints)
    .find((endpoint) => endpoint.path === "/v1/youtube-local-ingests/:ingestId")
    ?.panels.find((panel): panel is ApiResponsePanel => panel.kind === "response");
  assert.ok(
    youtubeGetPanel?.body.includes('"status": "registered"'),
    "YouTube GET documents a registered capture",
  );
  assert.ok(
    !youtubeGetPanel?.body.includes('"status": "resolving"'),
    "YouTube GET no longer claims resolving-only",
  );
  assert.equal(captionProductions.schema, "studio.local-runtime-caption-productions.v1");
  assert.deepEqual(captionProductions.captions, []);
  assert.equal(captionProductions.runtimeId, status.runtimeId);
  assert.equal(captionResults.schema, "studio.local-runtime-caption-production-results.v1");
  assert.deepEqual(captionResults.results, []);
  assert.equal(captionQc.schema, "studio.local-runtime-caption-quality-controls.v1");
  assert.deepEqual(captionQc.qualityControls, []);

  const caption201 = JSON.parse(CAPTION_PRODUCTION_201) as {
    schema?: string;
    captions?: Array<{
      jobId?: string;
      approval?: { reviewId?: string; receiptContentId?: string };
      executor?: {
        classification?: string;
        cognitionClaim?: string;
        executionScope?: string;
      };
      result?: { status?: string; lineCount?: number };
    }>;
  };
  const captionResultsSeam = JSON.parse(CAPTION_PRODUCTION_RESULTS_TEST_SEAM_200) as {
    schema?: string;
    results?: unknown[];
    runtimeId?: string;
  };
  const captionQcSeam = JSON.parse(CAPTION_QUALITY_CONTROLS_TEST_SEAM_200) as {
    schema?: string;
    qualityControls?: Array<{ outcome?: string; reasonCodes?: string[] }>;
    runtimeId?: string;
  };
  const captionQcConflict = JSON.parse(CAPTION_QC_409) as {
    schema?: string;
    error?: { code?: string };
  };
  assert.equal(caption201.schema, "studio.local-runtime-caption-productions.v1");
  assert.equal(caption201.captions?.length, 1);
  assert.equal(caption201.captions?.[0]?.approval?.reviewId, CAPTION_REQUEST_EXAMPLE.approval.reviewId);
  assert.equal(
    caption201.captions?.[0]?.approval?.receiptContentId,
    CAPTION_REQUEST_EXAMPLE.approval.receiptContentId,
  );
  assert.equal(caption201.captions?.[0]?.executor?.classification, "deterministic_current_run_test_seam");
  assert.equal(caption201.captions?.[0]?.executor?.cognitionClaim, "none");
  assert.equal(caption201.captions?.[0]?.executor?.executionScope, "current_run");
  assert.equal(caption201.captions?.[0]?.result?.status, "completed");
  assert.equal(caption201.captions?.[0]?.result?.lineCount, 6);
  assert.equal(captionResultsSeam.schema, "studio.local-runtime-caption-production-results.v1");
  assert.equal(captionResultsSeam.results?.length, 1);
  assert.equal(captionResultsSeam.runtimeId, status.runtimeId);
  assert.equal(captionQcSeam.schema, "studio.local-runtime-caption-quality-controls.v1");
  assert.equal(captionQcSeam.qualityControls?.length, 1);
  assert.equal(captionQcSeam.qualityControls?.[0]?.outcome, "accepted");
  assert.deepEqual(captionQcSeam.qualityControls?.[0]?.reasonCodes, [
    "current_run_candidate_structurally_complete",
  ]);
  assert.equal(captionQcSeam.runtimeId, status.runtimeId);
  assert.equal(captionQcConflict.schema, "studio.local-runtime-error.v1");
  assert.equal(captionQcConflict.error?.code, "illegal_caption_qc_transition");
  assert.match(SMOKE_TO_TERMINAL_DISPLAY, /deterministic-test/);
  assert.match(SMOKE_TO_TERMINAL_DISPLAY, /allow-deterministic-caption-test-seam/);

  const decisionReceipts = JSON.parse(DECISION_RECEIPTS_200) as {
    schema?: string;
    decisions?: unknown[];
    runtimeId?: string;
  };
  const playbackRevoke = JSON.parse(PRIVATE_PLAYBACK_REVOKE_200) as {
    schema?: string;
    state?: string;
    grantId?: string;
    runtimeId?: string;
  };
  const playbackGrant = JSON.parse(PRIVATE_PLAYBACK_GRANT_201) as {
    schema?: string;
    grantId?: string;
    runtimeId?: string;
    mimeType?: string;
    timestampOrigin?: { kind?: string; offsetMs?: number };
    mediaPath?: string;
    source?: { sessionId?: string; bytes?: number; durationMs?: number };
  };
  assert.equal(decisionReceipts.schema, "studio.local-runtime-decision-receipts.v1");
  assert.deepEqual(decisionReceipts.decisions, []);
  assert.equal(decisionReceipts.runtimeId, status.runtimeId);
  assert.equal(playbackRevoke.schema, "studio.private-playback-grant-revoked.v1");
  assert.equal(playbackRevoke.state, "revoked");
  assert.equal(playbackRevoke.runtimeId, status.runtimeId);
  assert.ok(playbackRevoke.grantId?.startsWith("private-playback-grant:"));
  assert.equal(playbackGrant.schema, "studio.private-playback-grant.v1");
  assert.equal(playbackGrant.runtimeId, status.runtimeId);
  assert.ok(playbackGrant.grantId?.startsWith("private-playback-grant:"));
  assert.equal(playbackGrant.mimeType, "audio/mp4");
  assert.equal(playbackGrant.timestampOrigin?.kind, "source_media_zero");
  assert.equal(playbackGrant.timestampOrigin?.offsetMs, 0);
  assert.equal(playbackGrant.source?.sessionId, START_REQUEST_EXAMPLE.sourceSessionId);
  assert.equal(playbackGrant.source?.bytes, 329_662);
  assert.equal(playbackGrant.source?.durationMs, 47_200);
  assert.ok(playbackGrant.mediaPath?.startsWith("/v1/private-source-media/"));
  assert.ok(!playbackGrant.mediaPath?.includes("cdn"), "grant mediaPath is not a CDN URL");
  assert.equal(
    playbackGrant.grantId,
    playbackRevoke.grantId,
    "Option B playback mint and revoke share one grantId",
  );

  const ownedPost = JSON.parse(OWNED_MEDIA_INGEST_POST_202) as {
    schema?: string;
    ingestId?: string;
    status?: string;
    source?: unknown;
    failure?: unknown;
  };
  const ownedPut = JSON.parse(OWNED_MEDIA_INGEST_PUT_202) as {
    schema?: string;
    ingestId?: string;
    status?: string;
  };
  const ownedGet = JSON.parse(OWNED_MEDIA_INGEST_GET_200) as {
    schema?: string;
    ingestId?: string;
    status?: string;
    source?: {
      sourceKind?: string;
      rightsScope?: string;
      preflightSchema?: string;
      detectedLanguageEvidenceAvailable?: boolean;
    } | null;
    failure?: unknown;
  };
  assert.equal(ownedPost.schema, "studio.owned-media-ingest.v1");
  assert.equal(ownedPut.schema, "studio.owned-media-ingest.v1");
  assert.equal(ownedGet.schema, "studio.owned-media-ingest.v1");
  assert.equal(ownedPost.status, "queued");
  assert.equal(ownedPut.status, "queued");
  assert.equal(ownedGet.status, "registered");
  assert.equal(ownedPost.source, null);
  assert.equal(ownedPost.failure, null);
  assert.equal(ownedGet.failure, null);
  assert.equal(ownedPost.ingestId, ownedPut.ingestId);
  assert.equal(ownedPost.ingestId, ownedGet.ingestId);
  assert.ok(ownedPost.ingestId?.startsWith("owned-ingest:"));
  assert.equal(ownedGet.source?.sourceKind, "owned_local");
  assert.equal(ownedGet.source?.rightsScope, "local_processing");
  assert.equal(ownedGet.source?.preflightSchema, "studio.preflight-bundle.v1");
  assert.equal(ownedGet.source?.detectedLanguageEvidenceAvailable, false);
  assert.notEqual(ownedGet.schema, "studio.youtube-local-ingest.v1");

  const youtubeQueued = JSON.parse(YOUTUBE_INGEST_202) as { ingestId?: string };
  assert.notEqual(ownedPost.ingestId, youtubeQueued.ingestId, "owned ingest must not reuse YouTube bodies");

  const playbackGrantRequest = API_ENDPOINT_GROUPS.flatMap((group) => group.endpoints)
    .find((endpoint) => endpoint.path === "/v1/runtimes/:runtimeId/private-playback-grants")
    ?.panels.find((panel) => panel.kind === "request");
  const playbackGrantResponse = API_ENDPOINT_GROUPS.flatMap((group) => group.endpoints)
    .find((endpoint) => endpoint.path === "/v1/runtimes/:runtimeId/private-playback-grants")
    ?.panels.find((panel): panel is ApiResponsePanel => panel.kind === "response");
  const playbackRevokeRequest = API_ENDPOINT_GROUPS.flatMap((group) => group.endpoints)
    .find((endpoint) => endpoint.path === "/v1/runtimes/:runtimeId/private-playback-grants/:grantId/revocations")
    ?.panels.find((panel) => panel.kind === "request");
  const ownedPostResponse = API_ENDPOINT_GROUPS.flatMap((group) => group.endpoints)
    .find((endpoint) => endpoint.path === "/v1/owned-media-ingests")
    ?.panels.find((panel): panel is ApiResponsePanel => panel.kind === "response");
  const ownedPutResponse = API_ENDPOINT_GROUPS.flatMap((group) => group.endpoints)
    .find((endpoint) => endpoint.path === "/v1/owned-media-ingests/:ingestId/media")
    ?.panels.find((panel): panel is ApiResponsePanel => panel.kind === "response");
  const ownedGetResponse = API_ENDPOINT_GROUPS.flatMap((group) => group.endpoints)
    .find((endpoint) => endpoint.path === "/v1/owned-media-ingests/:ingestId")
    ?.panels.find((panel): panel is ApiResponsePanel => panel.kind === "response");
  assert.ok(playbackGrantRequest?.body.includes('Origin: $ORIGIN'), "grant mint curl requires Origin");
  assert.ok(playbackRevokeRequest?.body.includes('Origin: $ORIGIN'), "grant revoke curl requires Origin");
  assert.equal(playbackGrantResponse?.provenance, "captured", "grant mint response is captured, not illustrative");
  assert.equal(ownedPostResponse?.provenance, "captured", "owned POST response is captured, not illustrative");
  assert.equal(ownedPutResponse?.provenance, "captured", "owned PUT response is captured");
  assert.equal(ownedGetResponse?.provenance, "captured", "owned GET response is captured");
  assert.ok(
    ownedGetResponse?.body.includes('"status": "registered"'),
    "owned GET shows registered status",
  );

  const privateMedia = API_ENDPOINT_GROUPS.flatMap((group) => group.endpoints).find(
    (endpoint) => endpoint.path === "/v1/private-source-media/:grantId/:secret",
  );
  const privateMediaResponse = privateMedia?.panels.find((panel): panel is ApiResponsePanel => panel.kind === "response");
  assert.equal(privateMedia?.responseSchema, null, "private media has no JSON response schema");
  assert.equal(privateMediaResponse?.provenance, "illustrative", "private media status line is illustrative");
  assert.ok(privateMediaResponse?.body.includes("206"), "private media notes Range 206");
  assert.ok(privateMediaResponse?.body.includes("grantId"), "private media notes grant-secret auth");
  assert.ok(privateMediaResponse?.body.includes("403"), "private media notes Origin 403");
  assert.ok(privateMediaResponse?.body.includes("410"), "private media notes revoked 410");
  assert.ok(privateMediaResponse?.body.includes("Not a CDN"), "private media denies CDN");
  assert.equal(privateMediaResponse?.body, PRIVATE_MEDIA_STATUS_LINE);
  assert.ok(
    privateMedia?.summary.includes("Origin required"),
    "private media summary requires Origin",
  );

  const languageEmpty = JSON.parse(LANGUAGE_EXPLANATIONS_200) as {
    schema?: string;
    attempts?: unknown[];
    results?: unknown[];
    runtimeId?: string;
  };
  const language201 = JSON.parse(LANGUAGE_EXPLANATIONS_201) as {
    schema?: string;
    attempts?: Array<{ status?: string; failure?: unknown }>;
    results?: Array<{
      verification?: {
        integrity?: string;
        caption?: { jobId?: string };
        executor?: { classification?: string; model?: string; id?: string };
        result?: { status?: string; availableFacetCount?: number };
      };
      artifact?: { rights?: { publication?: string } };
    }>;
    runtimeId?: string;
  };
  assert.equal(languageEmpty.schema, "studio.local-runtime-language-explanations.v1");
  assert.deepEqual(languageEmpty.attempts, []);
  assert.deepEqual(languageEmpty.results, []);
  assert.equal(languageEmpty.runtimeId, status.runtimeId);
  assert.equal(language201.schema, "studio.local-runtime-language-explanations.v1");
  assert.equal(language201.runtimeId, status.runtimeId);
  assert.equal(language201.attempts?.length, 1);
  assert.equal(language201.results?.length, 1);
  assert.equal(language201.attempts?.[0]?.status, "completed");
  assert.equal(language201.attempts?.[0]?.failure, null);
  assert.equal(
    language201.results?.[0]?.verification?.integrity,
    "stored_explanation_and_receipt_with_verified_current_caption",
  );
  assert.equal(language201.results?.[0]?.verification?.executor?.classification, "real_model");
  assert.equal(language201.results?.[0]?.verification?.executor?.model, "gpt-4o-mini");
  assert.equal(
    language201.results?.[0]?.verification?.executor?.id,
    "studio.openai-language-explanation-generator",
  );
  assert.equal(language201.results?.[0]?.verification?.result?.status, "completed");
  assert.equal(language201.results?.[0]?.verification?.result?.availableFacetCount, 2);
  assert.equal(language201.results?.[0]?.artifact?.rights?.publication, "private");
  assert.equal(LANGUAGE_REQUEST_EXAMPLE.lineId, "deterministic-current-run-line-001");
  assert.deepEqual(LANGUAGE_REQUEST_EXAMPLE.facetKinds, ["meaning", "word"]);
  assert.equal(LANGUAGE_REQUEST_EXAMPLE.selection.text, "테스");
  assert.equal(
    LANGUAGE_REQUEST_EXAMPLE.caption.jobId,
    caption201.captions?.[0]?.jobId,
    "language request binds the continuous-family caption job",
  );
  assert.equal(
    language201.results?.[0]?.verification?.caption?.jobId,
    caption201.captions?.[0]?.jobId,
    "language 201 result binds the continuous-family caption job",
  );

  const languagePanels = API_ENDPOINT_GROUPS.flatMap((group) => group.endpoints)
    .find((endpoint) => endpoint.path === "/v1/runtimes/:runtimeId/language-explanations")
    ?.panels ?? [];
  assert.ok(
    languagePanels.some((panel) => panel.kind === "response" && panel.body.includes('"results": []')),
    "language documents the default empty result list",
  );
  assert.ok(
    languagePanels.some((panel) => panel.title.includes("OpenAI executor")),
    "language 201 example names its opt-in executor",
  );
  assert.ok(
    languagePanels.some((panel) => panel.body.includes("gpt-4o-mini")),
    "language 201 example names the captured model",
  );
  assert.ok(languagePanels.some((panel) => panel.kind === "request" && panel.title.includes("Create")));
});

test("every reference page has a unique slug and every endpoint group has a page", () => {
  const slugs = API_PAGES.map((page) => page.slug);
  assert.equal(new Set(slugs).size, slugs.length, "page slugs are unique");
  assert.ok(slugs.includes(""), "the overview page exists");
  for (const page of API_PAGES) {
    assert.ok(page.title.length > 0, `page "${page.slug}" has a title`);
    assert.ok(page.description.length > 0, `page "${page.slug}" has a meta description`);
  }
  for (const group of API_ENDPOINT_GROUPS) {
    const page = API_PAGES.find((candidate) => candidate.slug === group.id);
    assert.ok(page, `endpoint group "${group.id}" has a reference page`);
    assert.equal(page?.group, "Endpoints", `page "${group.id}" sits in the Endpoints nav group`);
  }
});

test("the API routes compose the feature and stay in the public navigation", async () => {
  const indexSource = await readFile(
    new URL("../src/pages/api/index.astro", import.meta.url),
    "utf8",
  );
  const slugSource = await readFile(
    new URL("../src/pages/api/[slug].astro", import.meta.url),
    "utf8",
  );
  for (const [name, source] of [
    ["index", indexSource],
    ["[slug]", slugSource],
  ]) {
    assert.ok(source.includes("SiteLayout"), `the ${name} route uses the shared site layout`);
    assert.ok(source.includes("ApiDocsShell"), `the ${name} route renders the docs shell`);
  }
  assert.ok(slugSource.includes("getStaticPaths"), "the [slug] route builds from the page registry");
  const navSource = await readFile(
    new URL("../src/components/GlassNav.astro", import.meta.url),
    "utf8",
  );
  assert.ok(navSource.includes('href: "/api/"'), "the site navigation links /api/");
});
