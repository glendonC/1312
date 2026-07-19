import type {
  OwnedMediaIngestRequest,
  RuntimeHostCaptionProductionRequest,
  RuntimeHostCaptionQualityControlRequest,
  RuntimeHostLanguageExplanationRequest,
  RuntimeHostPrivatePlaybackGrantRequest,
  RuntimeHostPrivatePlaybackGrantRevocationRequest,
  RuntimeHostPublishReviewDecisionRequest,
  RuntimeHostPublishReviewRevocationRequest,
  RuntimeHostStartRequest,
  YouTubeLocalIngestRequest,
} from "../../studio/runtime/production/runtimeHost/model.ts";
import {
  ASSESSMENT_AUDITS_200,
  CAPTION_PRODUCTION_201,
  CAPTION_PRODUCTION_409,
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
  PUBLISH_REVIEW_INTAKES_200,
  PUBLISH_REVIEW_REVOCATION_201,
  RUNTIME_EVENTS_200,
  RUNTIME_PLAN_200,
  RUNTIME_START_ACK_202,
  RUNTIME_STATUS_200,
  SOURCE_SESSIONS_200,
  UNKNOWN_QUERY_400,
  YOUTUBE_INGEST_202,
  YOUTUBE_INGEST_GET_200,
} from "./examples.ts";

export const BASE_URL = "http://127.0.0.1:4312";

export interface ApiField {
  name: string;
  type: string;
  note: string;
  required?: boolean;
}

export interface ApiFieldTable {
  title: string;
  label: string;
  fields: ApiField[];
}

export interface ApiCodePanel {
  kind: "request" | "response";
  title: string;
  body: string;
}

export interface ApiEndpoint {
  methods: string[];
  path: string;
  summary: string;
  responseSchema: string | null;
  fieldTables: ApiFieldTable[];
  panels: ApiCodePanel[];
}

export interface ApiEndpointGroup {
  id: string;
  title: string;
  /** Short page description under the title. */
  note: string | null;
  endpoints: ApiEndpoint[];
}

export type ApiPalette = "coral" | "citron" | "blue" | "lilac" | "peach" | "teal";

export interface ApiPageDef {
  slug: string;
  title: string;
  group: "Getting Started" | "Endpoints" | "Concepts";
  palette: ApiPalette;
  description: string;
}

export const ERROR_SCHEMA = "studio.local-runtime-error.v1";

const curlFor = (method: "GET" | "POST" | "PUT", path: string, body?: object): string => {
  const lines = [
    `curl${method === "GET" ? "" : ` -X ${method}`} ${BASE_URL}${path} \\`,
    `  -H "Authorization: Bearer $TOKEN"${body === undefined ? "" : " \\"}`,
  ];
  if (body !== undefined) {
    lines.push(`  -H "Content-Type: application/json" \\`);
    lines.push(`  -d '${JSON.stringify(body, null, 2)}'`);
  }
  return lines.join("\n");
};

/** Private playback mint/revoke require an allowlisted Origin in addition to the bearer token. */
const curlForOrigin = (method: "GET" | "POST", path: string, body?: object): string => {
  const lines = [
    `curl${method === "GET" ? "" : ` -X ${method}`} ${BASE_URL}${path} \\`,
    `  -H "Authorization: Bearer $TOKEN" \\`,
    `  -H "Origin: $ORIGIN"${body === undefined ? "" : " \\"}`,
  ];
  if (body !== undefined) {
    lines.push(`  -H "Content-Type: application/json" \\`);
    lines.push(`  -d '${JSON.stringify(body, null, 2)}'`);
  }
  return lines.join("\n");
};

const curlBinaryPut = (path: string, fileArg: string): string =>
  [
    `curl -X PUT ${BASE_URL}${path} \\`,
    `  -H "Authorization: Bearer $TOKEN" \\`,
    `  -H "Content-Type: application/octet-stream" \\`,
    `  --data-binary @${fileArg}`,
  ].join("\n");

const curlPrivateMediaHead = (): string =>
  [
    `curl -I ${BASE_URL}/v1/private-source-media/$GRANT_ID/$SECRET \\`,
    `  -H "Origin: $ORIGIN" \\`,
    `  -H "Range: bytes=0-1023"`,
  ].join("\n");

/**
 * Status/header note for binary private media. Composed from host tests
 * (tests/studio-private-playback.test.ts); not a JSON envelope and not a pasted body.
 */
export const PRIVATE_MEDIA_STATUS_LINE = `HTTP/1.1 206 Partial Content
Content-Type: audio/mp4
Content-Length: 8
Content-Range: bytes 0-7/329662
Accept-Ranges: bytes
Cache-Control: private, no-store, max-age=0
Access-Control-Allow-Origin: $ORIGIN

(binary media octets; not shown)

# Auth: allowlisted Origin required. Path :grantId/:secret authorizes the stream
# (not the bearer token). Full GET without Range returns 200 with the same header
# family. HEAD returns the same status and headers with an empty body.
# Failures use the JSON error envelope: 403 missing/disallowed Origin, 404 unknown
# or wrong secret, 410 revoked or expired, 416 unsatisfiable Range, 400 any query
# string, 405 non-GET/HEAD.
# Private loopback bytes only. Not a CDN URL and not publication.`;

/* Identities below are real: they come from the run-005 source receipt and from
   the captured live-run receipts in examples.ts. */

const RUN_005_SESSION_ID =
  "source-session:50e48113837e62499233f29f53ab91f5ed591d39bda98879effb02364e2a03a2";
const RUN_005_REVISION_ID =
  "source-revision:6800f536f61f5d73dc474443cf0469c823ae94a984a209192940fc28b94afa09";
const RUN_005_CONTENT_ID =
  "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e";
const RUN_005_SOURCE_ARTIFACT_ID =
  "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70";

export const START_REQUEST_EXAMPLE = {
  sourceSessionId: RUN_005_SESSION_ID,
  sourceRevisionId: RUN_005_REVISION_ID,
  range: { startMs: 0, endMs: 47_200 },
  requestedSourceLanguage: { mode: "declared", languages: ["ko"], reason: null },
  targetLanguage: "en",
  selectedLanguagePackId: "ko-v3",
  outputDepth: "evidence",
} satisfies RuntimeHostStartRequest;

export const OWNED_INGEST_EXAMPLE = {
  filename: "clip.m4a",
  declaredBytes: 329_662,
  label: "Project-generated Korean conversation fixture",
  rightsHolder: "1321 project",
  rightsScope: "local_processing",
  ownershipAttested: true,
} satisfies OwnedMediaIngestRequest;

export const YOUTUBE_INGEST_EXAMPLE = {
  url: "https://www.youtube.com/watch?v=Ux-TMWnmntM",
  startMs: 754_000,
  endMs: 784_000,
  localProcessingConfirmed: true,
} satisfies YouTubeLocalIngestRequest;

export const REVIEW_DECISION_EXAMPLE = {
  intake: {
    intakeId: "publish-review-intake:d2e6ca337389d34b267c563a523eccede7e26960a50ac140a25cd8ba4ebac588",
    artifactId: "artifact:af9c320c97bd32daaa8a09cd4bc94b0305efa6891361fc566f63a5a188c9ecda",
    receiptId: "publish-review-intake-receipt:20cad736985710c6a9beb195a38a602bf57f8ae58bd63033df248d28f5932504",
    receiptContentId: "sha256:0befb1c0a44ac9726e4bccfb8a8ddaa542806e9f99fe6fb5d23389fca3fd5498",
  },
  reviewer: {
    id: "reviewer:local-operator",
    attestation: "I attest that I am the named reviewer and made this review decision.",
  },
  decision: {
    outcome: "approve_for_caption_production",
    reasonCodes: ["reviewer_attested_caption_production_may_proceed"],
    note: null,
  },
} satisfies RuntimeHostPublishReviewDecisionRequest;

export const CAPTION_REQUEST_EXAMPLE = {
  approval: {
    reviewId: "publish-review:55cb99708b008092cb1b8e9675468eb869016ad859cefb9397457e98c0d5cf08",
    artifactId: "artifact:e986d94e686a223f7c269d49d68188b45b8cba746f38f293189fa55803872e54",
    receiptId: "publish-review-decision-receipt:088b53b0a71ff278d4a5c5d349645f3c7d470f8c61f94151b3aa6ccb8cb8f1ee",
    receiptContentId: "sha256:85ad2898c419684dd4e49600b5ce8565e4c18bccc6e748e36fcd5e4ffe1205b3",
  },
} satisfies RuntimeHostCaptionProductionRequest;

/** Candidate span from the continuous-family gpt-4o-mini language 201 capture. */
export const LANGUAGE_REQUEST_EXAMPLE = {
  caption: {
    jobId: "caption-production:8632c0316e227114cb8eecc6f32c261800393099f491f0a30e3a6c583e87541d",
    artifactId: "artifact:ed7d787901b289b943809ac89c8cba823c63e09a19f4f1d4e7fe01661a997ba1",
    contentId: "sha256:f2690f4986365e18bb28bbafad81a84931f8155ee9d66060c39eba719382db01",
    receiptArtifactId: "artifact:68027e372b84749660fa0265ff2df40ed7e7ae191756baa09584a2469adaa614",
    receiptId: "caption-production-receipt:87aa6ac8e34b725ab1fc618e5b8b0392f6b7263a55731af07d61789d98399af8",
    receiptContentId: "sha256:d1dabde385d17b44c07c16ee65795004bbac94b1f12c387705718d19150f7d66",
  },
  lineId: "deterministic-current-run-line-001",
  selection: {
    side: "source",
    unit: "unicode_code_point",
    start: 0,
    end: 2,
    text: "테스",
  },
  facetKinds: [
    "meaning",
    "word"
  ],
} satisfies RuntimeHostLanguageExplanationRequest;

export const REVIEW_REVOCATION_EXAMPLE = {
  approval: {
    reviewId: "publish-review:fd270635f13ca8a82f9ab9858ffdf2d5e8e3fabbbfbdff196f589a4aeb992713",
    artifactId: "artifact:d3f53f5a25444737836e416ca86683594d1f0ea460facda6d52e60c1c3c01eca",
    receiptId: "publish-review-decision-receipt:436d61ef564f9b2897bb8a08813c619ffa4cd5cf1af905e2040ad42e8186dd1b",
    receiptContentId: "sha256:fc69cc44bb855d751f372be4af19a24195e50e0836659ef6747358944f8f5d39",
  },
  reviewer: {
    id: "reviewer:local-operator",
    attestation: "I attest that I am the named reviewer and made this revocation decision.",
  },
  revocation: {
    reasonCodes: ["approval_entered_in_error"],
    note: null,
  },
} satisfies RuntimeHostPublishReviewRevocationRequest;

/** Candidate ids from the deterministic test-seam caption 201 capture. Host auto-runs QC on create. */
export const CAPTION_QC_REQUEST_EXAMPLE = {
  candidate: {
    jobId: "caption-production:8632c0316e227114cb8eecc6f32c261800393099f491f0a30e3a6c583e87541d",
    captionArtifactId: "artifact:ed7d787901b289b943809ac89c8cba823c63e09a19f4f1d4e7fe01661a997ba1",
    captionContentId: "sha256:f2690f4986365e18bb28bbafad81a84931f8155ee9d66060c39eba719382db01",
    captionReceiptId: "caption-production-receipt:87aa6ac8e34b725ab1fc618e5b8b0392f6b7263a55731af07d61789d98399af8",
    captionReceiptContentId: "sha256:d1dabde385d17b44c07c16ee65795004bbac94b1f12c387705718d19150f7d66",
  },
} satisfies RuntimeHostCaptionQualityControlRequest;

export const PLAYBACK_GRANT_REQUEST_EXAMPLE = {
  schema: "studio.private-playback-grant-request.v1",
  source: {
    revisionId: RUN_005_REVISION_ID,
    artifactId: RUN_005_SOURCE_ARTIFACT_ID,
    contentId: RUN_005_CONTENT_ID,
  },
} satisfies RuntimeHostPrivatePlaybackGrantRequest;

export const PLAYBACK_REVOKE_EXAMPLE = {
  schema: "studio.private-playback-grant-revocation.v1",
} satisfies RuntimeHostPrivatePlaybackGrantRevocationRequest;

export const CURL_DISPLAY = `# printed on stdout when the host starts
TOKEN=<authorizationToken>

curl -H "Authorization: Bearer $TOKEN" \\
  ${BASE_URL}/v1/source-sessions`;

/**
 * First-win smoke on the default deterministic host (`npm run runtime:host`).
 * Proves auth, registered source, plan, start, and journal poll to terminal.
 * Does not claim captions, SaaS, or model spend.
 */
export const SMOKE_TO_TERMINAL_DISPLAY = `# First win: local host only (no SaaS, no model spend)
# 1. npm run runtime:host
# 2. Copy authorizationToken from the host stdout JSON
TOKEN=<authorizationToken>

# 3. Prove authorization and list registered sources (run-005 is pre-registered)
curl -H "Authorization: Bearer $TOKEN" \\
  ${BASE_URL}/v1/source-sessions

# 4. Forecast without writing a durable command
${curlFor("POST", "/v1/runtime-plans", START_REQUEST_EXAMPLE)}

# 5. Start one bounded study; read runtimeId from the 202 ack
${curlFor("POST", "/v1/runtime-starts", START_REQUEST_EXAMPLE)}

# 6. Poll the journal until lifecycle is terminal (or reachedHead)
curl -H "Authorization: Bearer $TOKEN" \\
  "${BASE_URL}/v1/runtimes/$RUNTIME_ID/events?after=0&limit=100"

# Next authority step is Publish Review (after a queued intake), then Captions.
# Default recorded caption executor may refuse fixture authority: that is fail-closed, not a host gap.
# Captured caption 201 panels need an opt-in host:
#   --caption-executor deterministic-test --allow-deterministic-caption-test-seam
# That seam sets cognitionClaim none; it is not default npm run runtime:host behavior.
# Captured language 201 panels need a further opt-in (after a caption seam):
#   --language-explanation-executor openai --allow-real-language-explanation
#   --language-explanation-model gpt-4o-mini
# Default host language stays honest-empty / unavailable.`;

/** Operator ladder for Overview / LLM paste. Order matches host authority, not nav density. */
export const API_SUCCESSFUL_PATH: ReadonlyArray<{
  href: string;
  label: string;
  detail: string;
}> = [
  {
    href: "/api/sources/",
    label: "Sources And Ingest",
    detail: "Register or list a local source before any study can start.",
  },
  {
    href: "/api/runtime/",
    label: "Runtime Lifecycle",
    detail: "Plan or start one bounded study, then poll its journal to terminal.",
  },
  {
    href: "/api/audits/",
    label: "Evidence Audits",
    detail: "Optional: reopen assessments and decision receipts without inventing facts.",
  },
  {
    href: "/api/review/",
    label: "Publish Review",
    detail: "Attested approve or reject. Required before private caption production.",
  },
  {
    href: "/api/captions/",
    label: "Captions And QC",
    detail:
      "Private caption candidates and structural QC. Not publication. Default host often 409; Captured 201 panels use an opt-in deterministic test seam.",
  },
  {
    href: "/api/playback/",
    label: "Private Playback",
    detail: "Mint an origin-bound grant, then stream exact private source bytes.",
  },
  {
    href: "/api/language/",
    label: "Language Explanations",
    detail:
      "Typed facets over one verified caption span. Default host stays empty; Captured 201 panels need opt-in OpenAI flags.",
  },
];

export const ERROR_DISPLAY = UNKNOWN_QUERY_400;

export const WORKER_TOOLS = [
  "media_extract",
  "media_seek",
  "evidence_read",
  "evidence_assess",
  "evidence_decide",
  "media_frames_sample",
  "media_frames_ocr",
  "media_visual_transitions_analyze",
  "media_speakers_analyze",
  "media_audio_separate",
  "research_search",
  "research_document_snapshot",
  "computer_use_readonly",
];

const INGEST_STATUS_FIELDS: ApiFieldTable = {
  title: "Ingest Status",
  label: "response",
  fields: [
    { name: "ingestId", type: "string", note: "Identity for polling this ingest." },
    {
      name: "status",
      type: '"queued" | "probing" | "sealing" | "registered" | "failed"',
      note: 'YouTube ingests add "resolving" and "downloading" before probing.',
    },
    { name: "updatedAt", type: "string", note: "ISO timestamp of the last state change." },
    { name: "source", type: "object | null", note: "Registered source summary once sealed, else null." },
    { name: "failure", type: "{ code, message } | null", note: "Closed failure-code set; null unless failed." },
  ],
};

const RUNTIME_START_FIELDS: ApiFieldTable = {
  title: "Request Body",
  label: "application/json",
  fields: [
    { name: "sourceSessionId", type: "string", required: true, note: "Registered source session to study." },
    { name: "sourceRevisionId", type: "string", required: true, note: "Exact source revision; a mismatch is rejected." },
    { name: "range", type: "{ startMs, endMs }", required: true, note: "Study window in integer milliseconds." },
    {
      name: "requestedSourceLanguage",
      type: "{ mode, languages, reason }",
      required: true,
      note: 'mode is "declared", "automatic", "mixed", "unknown", or "withheld". declared takes exactly one language, mixed at least two, withheld requires a reason.',
    },
    { name: "targetLanguage", type: "string", required: true, note: 'Translation target, for example "en".' },
    {
      name: "selectedLanguagePackId",
      type: "string | null",
      required: true,
      note: 'Language pack to apply, for example "ko-v3".',
    },
    {
      name: "outputDepth",
      type: '"captions" | "evidence"',
      required: true,
      note: "How deep the study output goes.",
    },
    { name: "options", type: "object", required: false, note: "Analysis options, validated by the host." },
    { name: "clientRequestId", type: "string", required: false, note: "Client-supplied request identifier." },
  ],
};

const RUNTIME_STATUS_FIELDS: ApiFieldTable = {
  title: "Status Response",
  label: "response",
  fields: [
    { name: "commandId", type: "string", note: "Accepted command identity." },
    { name: "runtimeId", type: "string", note: "Runtime identity for all per-runtime resources." },
    { name: "journalId", type: "string", note: "Journal backing this runtime." },
    {
      name: "lifecycle",
      type: '"accepted" | "initializing" | "running" | "terminal" | "failed" | "interrupted"',
      note: "The complete lifecycle state set.",
    },
    { name: "reason", type: "{ code, message } | null", note: "Closed failure-code set; null unless failed or interrupted." },
    { name: "forecast", type: "object | null", note: 'Frozen forecast identity once accepted; baselineStatus is "floor_only".' },
    { name: "runStartReceipt", type: "object | null", note: "Content id plus the run-start record once the runtime starts." },
    { name: "journalHead", type: "number", note: "Highest journal sequence written." },
    { name: "terminal", type: "boolean", note: "True once the lifecycle is terminal." },
  ],
};

const listEnvelopeFields = (payloadName: string, payloadNote: string): ApiFieldTable => ({
  title: "Response Envelope",
  label: "response",
  fields: [
    { name: "commandId", type: "string", note: "Accepted command identity." },
    { name: "runtimeId", type: "string", note: "Runtime identity for this journal." },
    { name: "journalHead", type: "number", note: "Highest journal sequence written." },
    { name: payloadName, type: "array", note: payloadNote },
  ],
});

const EVENTS_QUERY_FIELDS: ApiFieldTable = {
  title: "Query",
  label: "query",
  fields: [
    { name: "after", type: "number", note: "Cursor; only events with seq greater than after are returned. Defaults to 0." },
    { name: "limit", type: "number", note: "Page size; host-enforced maximum applies." },
  ],
};

const EVENTS_RESPONSE_FIELDS: ApiFieldTable = {
  title: "Events Response",
  label: "response",
  fields: [
    { name: "commandId", type: "string", note: "Accepted command identity." },
    { name: "runtimeId", type: "string", note: "Runtime identity for this journal." },
    { name: "lifecycle", type: "string", note: "Current lifecycle state at poll time." },
    { name: "requestedCursor", type: "number", note: "Echo of the after cursor used for this page." },
    { name: "nextCursor", type: "number", note: "Pass as after on the next poll." },
    { name: "journalHead", type: "number", note: "Highest journal sequence written." },
    { name: "events", type: "array", note: "Append-only runtime events in this page." },
    { name: "reachedHead", type: "boolean", note: "True when this page reached the current journal head." },
    { name: "terminal", type: "boolean", note: "True once the lifecycle is terminal." },
    { name: "reason", type: "{ code, message } | null", note: "Closed failure-code set; null unless failed or interrupted." },
  ],
};

const LANGUAGE_REQUEST_FIELDS: ApiFieldTable = {
  title: "Request Body",
  label: "application/json",
  fields: [
    {
      name: "caption",
      type: "object",
      required: true,
      note: "Exact verified caption identity: jobId, artifactId, contentId, receiptArtifactId, receiptId, receiptContentId.",
    },
    { name: "lineId", type: "string", required: true, note: "Verified caption line to explain." },
    {
      name: "selection",
      type: "{ side, unit, start, end, text }",
      required: true,
      note: 'Exact unicode_code_point span on "source" or "target"; text must match the selected range.',
    },
    {
      name: "facetKinds",
      type: "array",
      required: true,
      note: "Closed facet set: meaning, word, phrase, grammar, translation_choice.",
    },
  ],
};

const LANGUAGE_ENVELOPE_FIELDS: ApiFieldTable = {
  title: "Response Envelope",
  label: "response",
  fields: [
    { name: "commandId", type: "string", note: "Accepted command identity." },
    { name: "runtimeId", type: "string", note: "Runtime identity for this journal." },
    { name: "journalHead", type: "number", note: "Highest journal sequence written." },
    { name: "attempts", type: "array", note: "Immutable attempt history, including failures." },
    { name: "results", type: "array", note: "Verified facet results; empty until a successful attempt." },
  ],
};

const CAPTION_PRODUCTION_REQUEST_FIELDS: ApiFieldTable = {
  title: "Production Request",
  label: "application/json",
  fields: [
    {
      name: "approval",
      type: "object",
      required: true,
      note: "Exact unrevoked approval identity: reviewId, artifactId, receiptId, receiptContentId.",
    },
  ],
};

const CAPTION_QC_REQUEST_FIELDS: ApiFieldTable = {
  title: "QC Request",
  label: "application/json",
  fields: [
    {
      name: "candidate",
      type: "object",
      required: true,
      note: "Exact caption candidate identity: jobId, captionArtifactId, captionContentId, captionReceiptId, captionReceiptContentId.",
    },
  ],
};

const PLAYBACK_REVOKE_FIELDS: ApiFieldTable = {
  title: "Revocation Request",
  label: "application/json",
  fields: [
    {
      name: "schema",
      type: '"studio.private-playback-grant-revocation.v1"',
      required: true,
      note: "Literal schema tag; the path already names the grant.",
    },
  ],
};

export const API_ENDPOINT_GROUPS: ApiEndpointGroup[] = [
  {
    id: "sources",
    title: "Sources And Ingest",
    note: "Register owned media or a private YouTube range as a local source before any study can start.",
    endpoints: [
      {
        methods: ["GET"],
        path: "/v1/source-sessions",
        summary: "List registered local sources with rights scope, duration, and preflight identity.",
        responseSchema: "studio.local-source-session-list.v1",
        fieldTables: [
          {
            title: "Source Summary",
            label: "response object",
            fields: [
              { name: "sourceSessionId", type: "string", note: "Session identity used to start runtimes." },
              { name: "sourceRevisionId", type: "string", note: "Exact revision; requests naming a stale revision are rejected." },
              { name: "sourceContentId", type: "string", note: "Content address of the sealed bytes." },
              { name: "sourceKind", type: '"owned_local" | "youtube_local"', note: "Which registered producer sealed it." },
              { name: "rightsScope", type: "string", note: "Rights scope carried from the ingest receipt." },
              { name: "durationMs", type: "number", note: "Probed duration in milliseconds." },
              { name: "trackCount", type: "number", note: "Probed track count." },
              { name: "preflightSchema", type: "string", note: "Which preflight bundle version backs this source." },
              { name: "detectedLanguageEvidenceAvailable", type: "boolean", note: "Whether pinned language-range evidence exists." },
            ],
          },
        ],
        panels: [
          {
            kind: "response",
            title: "200 · Captured",
            body: SOURCE_SESSIONS_200,
          },
        ],
      },
      {
        methods: ["POST"],
        path: "/v1/owned-media-ingests",
        summary: "Open a rights-attested owned-media ingest from declared metadata.",
        responseSchema: "studio.owned-media-ingest.v1",
        fieldTables: [
          {
            title: "Request Body",
            label: "application/json",
            fields: [
              { name: "filename", type: "string", required: true, note: "Original basename, retained as provenance only." },
              { name: "declaredBytes", type: "number", required: true, note: "Byte count declared for the coming upload." },
              { name: "label", type: "string", required: true, note: "Operator-facing label for the source." },
              { name: "rightsHolder", type: "string", required: true, note: "Named rights holder for the bytes." },
              {
                name: "rightsScope",
                type: '"local_processing"',
                required: true,
                note: "The only scope that exists. Nothing here authorizes redistribution.",
              },
              {
                name: "ownershipAttested",
                type: "true",
                required: true,
                note: "Literal true. The request is rejected without the attestation.",
              },
            ],
          },
        ],
        panels: [
          {
            kind: "request",
            title: "Request",
            body: curlFor("POST", "/v1/owned-media-ingests", OWNED_INGEST_EXAMPLE),
          },
          {
            kind: "response",
            title: "202 · Captured · Queued",
            body: OWNED_MEDIA_INGEST_POST_202,
          },
        ],
      },
      {
        methods: ["PUT"],
        path: "/v1/owned-media-ingests/:ingestId/media",
        summary: "Upload the raw bytes for one open ingest as an octet stream.",
        responseSchema: "studio.owned-media-ingest.v1",
        fieldTables: [INGEST_STATUS_FIELDS],
        panels: [
          {
            kind: "request",
            title: "Request · Octet-Stream",
            body: curlBinaryPut(
              "/v1/owned-media-ingests/$INGEST_ID/media",
              "public/demo/runs/run-005/clip.m4a",
            ),
          },
          {
            kind: "response",
            title: "202 · Captured · Queued",
            body: OWNED_MEDIA_INGEST_PUT_202,
          },
        ],
      },
      {
        methods: ["GET"],
        path: "/v1/owned-media-ingests/:ingestId",
        summary: "Poll ingest state until registered or failed.",
        responseSchema: "studio.owned-media-ingest.v1",
        fieldTables: [INGEST_STATUS_FIELDS],
        panels: [
          {
            kind: "request",
            title: "Request",
            body: curlFor("GET", "/v1/owned-media-ingests/$INGEST_ID"),
          },
          {
            kind: "response",
            // Captured after octet-stream PUT on a temp owned-ingest-root without a
            // preloaded colliding --source-directory. Local processing only; not SaaS upload.
            title: "200 · Captured · Registered",
            body: OWNED_MEDIA_INGEST_GET_200,
          },
        ],
      },
      {
        methods: ["POST"],
        path: "/v1/youtube-local-ingests",
        summary: "Open a private local YouTube range ingest.",
        responseSchema: "studio.youtube-local-ingest.v1",
        fieldTables: [
          {
            title: "Request Body",
            label: "application/json",
            fields: [
              { name: "url", type: "string", required: true, note: "Watch URL of the video." },
              { name: "startMs", type: "number", required: true, note: "Range start in integer milliseconds." },
              { name: "endMs", type: "number", required: true, note: "Range end; the range cap is enforced by the host." },
              {
                name: "localProcessingConfirmed",
                type: "true",
                required: true,
                note: "Literal true. Confirms private local processing only.",
              },
            ],
          },
        ],
        panels: [
          {
            kind: "request",
            title: "Request",
            body: curlFor("POST", "/v1/youtube-local-ingests", YOUTUBE_INGEST_EXAMPLE),
          },
          {
            kind: "response",
            title: "202 · Captured · Queued",
            body: YOUTUBE_INGEST_202,
          },
        ],
      },
      {
        methods: ["GET"],
        path: "/v1/youtube-local-ingests/:ingestId",
        summary: "Poll YouTube-local ingest state.",
        responseSchema: "studio.youtube-local-ingest.v1",
        fieldTables: [INGEST_STATUS_FIELDS],
        panels: [
          {
            kind: "request",
            title: "Request",
            body: curlFor("GET", "/v1/youtube-local-ingests/$INGEST_ID"),
          },
          {
            kind: "response",
            // Captured after yt-dlp download + local seal/register. Private local_processing
            // only; not upload, CDN, or redistribution authority.
            title: "200 · Captured · Registered",
            body: YOUTUBE_INGEST_GET_200,
          },
        ],
      },
    ],
  },
  {
    id: "runtime",
    title: "Runtime Lifecycle",
    note: "Plan, start, and poll one bounded study. Callers name source and range; the scheduler owns tasks, grants, and budgets.",
    endpoints: [
      {
        methods: ["POST"],
        path: "/v1/runtime-plans",
        summary: "Plan one bounded study and return its forecast without starting anything. Accepts the same body as /v1/runtime-starts.",
        responseSchema: "studio.local-runtime-plan.v1",
        fieldTables: [RUNTIME_START_FIELDS],
        panels: [
          {
            kind: "request",
            title: "Request",
            body: curlFor("POST", "/v1/runtime-plans", START_REQUEST_EXAMPLE),
          },
          {
            kind: "response",
            title: "200 · Captured",
            body: RUNTIME_PLAN_200,
          },
        ],
      },
      {
        methods: ["POST"],
        path: "/v1/runtime-starts",
        summary: "Accept and start one bounded runtime over a registered source range.",
        responseSchema: "studio.local-runtime-start-ack.v1",
        fieldTables: [RUNTIME_START_FIELDS],
        panels: [
          {
            kind: "request",
            title: "Request",
            body: curlFor("POST", "/v1/runtime-starts", START_REQUEST_EXAMPLE),
          },
          {
            kind: "response",
            title: "202 · Captured",
            body: RUNTIME_START_ACK_202,
          },
        ],
      },
      {
        methods: ["GET"],
        path: "/v1/runtime-starts/:commandId",
        summary: "Read lifecycle status by the accepted command.",
        responseSchema: "studio.local-runtime-status.v1",
        fieldTables: [RUNTIME_STATUS_FIELDS],
        panels: [
          {
            kind: "request",
            title: "Request",
            body: curlFor("GET", "/v1/runtime-starts/$COMMAND_ID"),
          },
          {
            kind: "response",
            title: "200 · Terminal · Captured",
            body: RUNTIME_STATUS_200,
          },
        ],
      },
      {
        methods: ["GET"],
        path: "/v1/runtimes/:runtimeId",
        summary: "Read lifecycle status by runtime identity. Same response as the command read.",
        responseSchema: "studio.local-runtime-status.v1",
        fieldTables: [RUNTIME_STATUS_FIELDS],
        panels: [
          {
            kind: "request",
            title: "Request",
            body: curlFor("GET", "/v1/runtimes/$RUNTIME_ID"),
          },
          {
            kind: "response",
            title: "200 · Terminal · Captured",
            body: RUNTIME_STATUS_200,
          },
        ],
      },
      {
        methods: ["GET"],
        path: "/v1/runtimes/:runtimeId/events",
        summary: "Cursor-poll the append-only journal. Only after and limit are accepted.",
        responseSchema: "studio.local-runtime-events.v1",
        fieldTables: [EVENTS_QUERY_FIELDS, EVENTS_RESPONSE_FIELDS],
        panels: [
          {
            kind: "request",
            title: "Request",
            body: curlFor("GET", "/v1/runtimes/$RUNTIME_ID/events?after=0&limit=2"),
          },
          {
            kind: "response",
            title: "200 · events?after=0&limit=2 · Captured",
            body: RUNTIME_EVENTS_200,
          },
        ],
      },
    ],
  },
  {
    id: "audits",
    title: "Evidence Audits",
    note: "Reopen stored assessments and decision receipts by content identity. Integrity is not semantic quality.",
    endpoints: [
      {
        methods: ["GET"],
        path: "/v1/runtimes/:runtimeId/assessment-audits",
        summary: "Reopen stored evidence assessments and re-verify hashes and citation closure.",
        responseSchema: "studio.local-runtime-assessment-audits.v1",
        fieldTables: [listEnvelopeFields("audits", "Reopened assessment audits; empty when none are stored.")],
        panels: [
          {
            kind: "request",
            title: "Request",
            body: curlFor("GET", "/v1/runtimes/$RUNTIME_ID/assessment-audits"),
          },
          {
            kind: "response",
            title: "200 · Captured · Honest Empty",
            body: ASSESSMENT_AUDITS_200,
          },
        ],
      },
      {
        methods: ["GET"],
        path: "/v1/runtimes/:runtimeId/decision-receipts",
        summary: "Re-derive stored deterministic decisions from their audited inputs.",
        responseSchema: "studio.local-runtime-decision-receipts.v1",
        fieldTables: [listEnvelopeFields("decisions", "Re-derived decision receipts; empty when none are stored.")],
        panels: [
          {
            kind: "request",
            title: "Request",
            body: curlFor("GET", "/v1/runtimes/$RUNTIME_ID/decision-receipts"),
          },
          {
            kind: "response",
            title: "200 · Captured · Honest Empty",
            body: DECISION_RECEIPTS_200,
          },
        ],
      },
    ],
  },
  {
    id: "review",
    title: "Publish Review",
    note: "Attested human approve or reject before private caption production. Reviewer identity is host-configured; callers cannot invent it.",
    endpoints: [
      {
        methods: ["GET"],
        path: "/v1/runtimes/:runtimeId/publish-review-intakes",
        summary: "Read host-produced intake receipts with their full decision lineage.",
        responseSchema: "studio.local-runtime-publish-review-intakes.v1",
        fieldTables: [listEnvelopeFields("intakes", "Host-produced intake receipts with decision lineage.")],
        panels: [
          {
            kind: "request",
            title: "Request",
            body: curlFor("GET", "/v1/runtimes/$RUNTIME_ID/publish-review-intakes"),
          },
          {
            kind: "response",
            title: "200 · Captured",
            body: PUBLISH_REVIEW_INTAKES_200,
          },
        ],
      },
      {
        methods: ["GET", "POST"],
        path: "/v1/runtimes/:runtimeId/publish-review-decisions",
        summary: "Read reviews, or record one attested local approve or reject decision.",
        responseSchema: "studio.local-runtime-publish-review-decisions.v1",
        fieldTables: [
          {
            title: "Decision Request",
            label: "application/json",
            fields: [
              { name: "intake", type: "object", required: true, note: "Exact intake identity: intakeId, artifactId, receiptId, receiptContentId." },
              {
                name: "reviewer",
                type: "{ id, attestation }",
                required: true,
                note: "Must name the host-configured reviewer id and repeat the exact attestation string.",
              },
              {
                name: "decision",
                type: "{ outcome, reasonCodes, note }",
                required: true,
                note: 'outcome is "approve_for_caption_production" or "reject_with_reasons", with closed reason codes.',
              },
            ],
          },
          listEnvelopeFields("reviews", "Attested review decisions for this runtime; empty until one is recorded."),
        ],
        panels: [
          {
            kind: "request",
            title: "Request · Read",
            body: curlFor("GET", "/v1/runtimes/$RUNTIME_ID/publish-review-decisions"),
          },
          {
            kind: "response",
            title: "200 · Captured · Honest Empty",
            body: PUBLISH_REVIEW_DECISIONS_200,
          },
          {
            kind: "request",
            title: "Request · Approve",
            body: curlFor("POST", "/v1/runtimes/$RUNTIME_ID/publish-review-decisions", REVIEW_DECISION_EXAMPLE),
          },
          {
            kind: "response",
            title: "201 · Decision Receipt · Captured",
            body: PUBLISH_REVIEW_DECISION_201,
          },
        ],
      },
      {
        methods: ["POST"],
        path: "/v1/runtimes/:runtimeId/publish-review-revocations",
        summary: "Revoke a prior approval. Rejection and revocation stay visible forever.",
        responseSchema: "studio.local-runtime-publish-review-decisions.v1",
        fieldTables: [
          {
            title: "Revocation Request",
            label: "application/json",
            fields: [
              { name: "approval", type: "object", required: true, note: "Exact approval identity: reviewId, artifactId, receiptId, receiptContentId." },
              {
                name: "reviewer",
                type: "{ id, attestation }",
                required: true,
                note: "Must name the host-configured reviewer id and repeat the exact revocation attestation string.",
              },
              {
                name: "revocation",
                type: "{ reasonCodes, note }",
                required: true,
                note: "Closed revocation reason codes; note may be null.",
              },
            ],
          },
        ],
        panels: [
          {
            kind: "request",
            title: "Request · Revoke",
            body: curlFor("POST", "/v1/runtimes/$RUNTIME_ID/publish-review-revocations", REVIEW_REVOCATION_EXAMPLE),
          },
          {
            kind: "response",
            title: "201 · Revocation · Captured",
            body: PUBLISH_REVIEW_REVOCATION_201,
          },
        ],
      },
    ],
  },
  {
    id: "captions",
    title: "Captions And QC",
    note:
      "Private caption candidates, verified timed lines, and structural QC. Not publication. " +
      "Default npm run runtime:host uses the recorded caption executor and fails closed with 409. " +
      "201 panels were captured with --caption-executor deterministic-test " +
      "--allow-deterministic-caption-test-seam (cognitionClaim none). " +
      "The host auto-runs independent QC when caption create succeeds.",
    endpoints: [
      {
        methods: ["GET", "POST"],
        path: "/v1/runtimes/:runtimeId/caption-productions",
        summary: "Request or reopen private caption candidates from one unrevoked approval receipt.",
        responseSchema: "studio.local-runtime-caption-productions.v1",
        fieldTables: [
          CAPTION_PRODUCTION_REQUEST_FIELDS,
          listEnvelopeFields(
            "captions",
            "Private caption production records; empty until a current-run caption job completes.",
          ),
        ],
        panels: [
          {
            kind: "request",
            title: "Request · Read",
            body: curlFor("GET", "/v1/runtimes/$RUNTIME_ID/caption-productions"),
          },
          {
            kind: "response",
            title: "200 · Captured · Honest Empty",
            body: CAPTION_PRODUCTIONS_200,
          },
          {
            kind: "request",
            title: "Request · Create",
            body: curlFor("POST", "/v1/runtimes/$RUNTIME_ID/caption-productions", CAPTION_REQUEST_EXAMPLE),
          },
          {
            kind: "response",
            title: "409 · Fail-Closed · Captured",
            body: CAPTION_PRODUCTION_409,
          },
          {
            kind: "response",
            title: "201 · Captured · Deterministic Test Seam",
            body: CAPTION_PRODUCTION_201,
          },
        ],
      },
      {
        methods: ["GET"],
        path: "/v1/runtimes/:runtimeId/caption-production-results",
        summary: "Read verified timed lines with exact source, approval, and promotion lineage.",
        responseSchema: "studio.local-runtime-caption-production-results.v1",
        fieldTables: [listEnvelopeFields("results", "Verified timed caption results with lineage.")],
        panels: [
          {
            kind: "request",
            title: "Request",
            body: curlFor("GET", "/v1/runtimes/$RUNTIME_ID/caption-production-results"),
          },
          {
            kind: "response",
            title: "200 · Captured · Honest Empty",
            body: CAPTION_PRODUCTION_RESULTS_200,
          },
          {
            kind: "response",
            title: "200 · Captured · Deterministic Test Seam",
            body: CAPTION_PRODUCTION_RESULTS_TEST_SEAM_200,
          },
        ],
      },
      {
        methods: ["GET", "POST"],
        path: "/v1/runtimes/:runtimeId/caption-quality-controls",
        summary: "Run or reopen the deterministic structural caption QC gate.",
        responseSchema: "studio.local-runtime-caption-quality-controls.v1",
        fieldTables: [
          CAPTION_QC_REQUEST_FIELDS,
          listEnvelopeFields(
            "qualityControls",
            "Structural QC records; empty until a candidate is submitted. Successful caption create auto-runs one QC decision.",
          ),
        ],
        panels: [
          {
            kind: "request",
            title: "Request · Read",
            body: curlFor("GET", "/v1/runtimes/$RUNTIME_ID/caption-quality-controls"),
          },
          {
            kind: "response",
            title: "200 · Captured · Honest Empty",
            body: CAPTION_QUALITY_CONTROLS_200,
          },
          {
            kind: "response",
            title: "200 · Captured · Deterministic Test Seam",
            body: CAPTION_QUALITY_CONTROLS_TEST_SEAM_200,
          },
          {
            kind: "request",
            title: "Request · Create",
            body: curlFor("POST", "/v1/runtimes/$RUNTIME_ID/caption-quality-controls", CAPTION_QC_REQUEST_EXAMPLE),
          },
          {
            kind: "response",
            title: "409 · Fail-Closed · Captured",
            body: CAPTION_QC_409,
          },
        ],
      },
    ],
  },
  {
    id: "language",
    title: "Language Explanations",
    note:
      "Typed facets over one verified caption span. Default host has no language executor (honest empty). " +
      "201 panels were captured with --language-explanation-executor openai " +
      "--allow-real-language-explanation --language-explanation-model gpt-4o-mini after a " +
      "deterministic-test caption seam. Failed attempts stay visible.",
    endpoints: [
      {
        methods: ["GET", "POST"],
        path: "/v1/runtimes/:runtimeId/language-explanations",
        summary:
          "Request typed meaning, word, phrase, grammar, and translation-choice facets over one verified caption span.",
        responseSchema: "studio.local-runtime-language-explanations.v1",
        fieldTables: [LANGUAGE_REQUEST_FIELDS, LANGUAGE_ENVELOPE_FIELDS],
        panels: [
          {
            kind: "request",
            title: "Request · Read",
            body: curlFor("GET", "/v1/runtimes/$RUNTIME_ID/language-explanations"),
          },
          {
            kind: "response",
            title: "200 · Captured · Honest Empty",
            body: LANGUAGE_EXPLANATIONS_200,
          },
          {
            kind: "request",
            title: "Request · Create",
            body: curlFor("POST", "/v1/runtimes/$RUNTIME_ID/language-explanations", LANGUAGE_REQUEST_EXAMPLE),
          },
          {
            kind: "response",
            // Opt-in OpenAI after deterministic caption seam. Real model; private only.
            // Not default npm run runtime:host behavior.
            title: "201 · Captured · Opt-In OpenAI (gpt-4o-mini)",
            body: LANGUAGE_EXPLANATIONS_201,
          },
        ],
      },
    ],
  },
  {
    id: "playback",
    title: "Private Playback",
    note:
      "Mint a short-lived origin-bound grant, then stream exact private source bytes. " +
      "Media authorizes by grant secret, not the bearer token. Origin is required on mint, " +
      "revoke, and media bytes. Captured grant mint and revoke panels are one continuous host " +
      "session and share the same grantId. GET/HEAD media is binary with no JSON success envelope.",
    endpoints: [
      {
        methods: ["POST"],
        path: "/v1/runtimes/:runtimeId/private-playback-grants",
        summary: "Mint one short-lived, origin-bound grant for exact private source bytes.",
        responseSchema: "studio.private-playback-grant.v1",
        fieldTables: [
          {
            title: "Grant Response",
            label: "response",
            fields: [
              { name: "grantId", type: "string", note: "Grant identity, also embedded in mediaPath." },
              { name: "source", type: "object", note: "Exact session, revision, artifact, content id, bytes, and duration." },
              { name: "mimeType", type: "string", note: "One of nine allowed audio/video types; nothing else is served." },
              {
                name: "timestampOrigin",
                type: '{ kind: "source_media_zero", offsetMs: 0 }',
                note: "Playback time zero is source time zero.",
              },
              { name: "mediaPath", type: "string", note: "Relative media URL embedding the grant secret." },
              { name: "expiresAt", type: "string", note: "Ten minutes after issue." },
            ],
          },
        ],
        panels: [
          {
            kind: "request",
            title: "Request",
            body: curlForOrigin("POST", "/v1/runtimes/$RUNTIME_ID/private-playback-grants", PLAYBACK_GRANT_REQUEST_EXAMPLE),
          },
          {
            kind: "response",
            // Option B continuous family after smoke + caption seam. Origin required.
            // Private loopback grant only; mediaPath embeds a short-lived secret, not a CDN URL.
            title: "201 · Playback Grant · Captured",
            body: PRIVATE_PLAYBACK_GRANT_201,
          },
        ],
      },
      {
        methods: ["POST"],
        path: "/v1/runtimes/:runtimeId/private-playback-grants/:grantId/revocations",
        summary: "Revoke an active playback grant before it expires.",
        responseSchema: "studio.private-playback-grant-revoked.v1",
        fieldTables: [PLAYBACK_REVOKE_FIELDS],
        panels: [
          {
            kind: "request",
            title: "Request",
            body: curlForOrigin(
              "POST",
              "/v1/runtimes/$RUNTIME_ID/private-playback-grants/$GRANT_ID/revocations",
              PLAYBACK_REVOKE_EXAMPLE,
            ),
          },
          {
            kind: "response",
            // Same continuous session and same grantId as the mint 201 panel above.
            title: "200 · Revoked · Captured",
            body: PRIVATE_PLAYBACK_REVOKE_200,
          },
        ],
      },
      {
        methods: ["GET", "HEAD"],
        path: "/v1/private-source-media/:grantId/:secret",
        summary:
          "Stream granted media bytes with HTTP Range support. Binary response, no JSON envelope. Origin required; grant-secret path auth (not bearer). 200 full / 206 Range; failures 403/404/410/416.",
        responseSchema: null,
        fieldTables: [],
        panels: [
          {
            kind: "request",
            title: "Request · HEAD + Range",
            body: curlPrivateMediaHead(),
          },
          {
            kind: "response",
            // Illustrative status/header note from host tests. Success body is binary octets,
            // not a JSON envelope. Do not paste media bytes into the docs.
            title: "206 · Range Headers · Illustrative",
            body: PRIVATE_MEDIA_STATUS_LINE,
          },
        ],
      },
    ],
  },
];

export const API_PAGES: ApiPageDef[] = [
  {
    slug: "",
    title: "Overview",
    group: "Getting Started",
    palette: "teal",
    description:
      "Local /v1 for evidence-backed media understanding: register a source, run a bounded study, and read verifiable receipts.",
  },
  {
    slug: "authentication",
    title: "Authentication",
    group: "Getting Started",
    palette: "teal",
    description:
      "Bearer-token authorization, loopback base URL, origin allowlist, and host bootstrap for the 1321 runtime host API.",
  },
  {
    slug: "errors",
    title: "Errors",
    group: "Getting Started",
    palette: "coral",
    description: "Fail-closed request validation and the studio.local-runtime-error.v1 envelope.",
  },
  {
    slug: "sources",
    title: "Sources And Ingest",
    group: "Endpoints",
    palette: "teal",
    description: "Register owned media or a private YouTube range as a local source before any study.",
  },
  {
    slug: "runtime",
    title: "Runtime Lifecycle",
    group: "Endpoints",
    palette: "blue",
    description: "Plan, start, and poll one bounded study over a registered source range.",
  },
  {
    slug: "audits",
    title: "Evidence Audits",
    group: "Endpoints",
    palette: "citron",
    description: "Reopen and re-verify stored assessments and decision receipts without inventing facts.",
  },
  {
    slug: "review",
    title: "Publish Review",
    group: "Endpoints",
    palette: "lilac",
    description: "Attested human approve or reject before private caption production.",
  },
  {
    slug: "captions",
    title: "Captions And QC",
    group: "Endpoints",
    palette: "coral",
    description: "Private caption candidates, verified timed lines, and structural QC — not publication.",
  },
  {
    slug: "language",
    title: "Language Explanations",
    group: "Endpoints",
    palette: "peach",
    description: "Typed facets over one verified caption span, with immutable attempt history.",
  },
  {
    slug: "playback",
    title: "Private Playback",
    group: "Endpoints",
    palette: "blue",
    description: "Mint a short-lived origin-bound grant, then stream exact private source bytes.",
  },
  {
    slug: "receipts",
    title: "Receipts",
    group: "Concepts",
    palette: "citron",
    description: "What a receipt proves: schema tags, content identity, and fail-closed reads.",
  },
  {
    slug: "agents",
    title: "For Agentic Editors",
    group: "Concepts",
    palette: "blue",
    description: "Integrate at /v1 for proof-backed branching; workers stay grant-scoped.",
  },
  {
    slug: "improve",
    title: "Improve",
    group: "Concepts",
    palette: "teal",
    description:
      "Miss-to-gold conveyor concept, not a /v1 host surface. Exclusive routing, memory gate, and declared offline adapters.",
  },
  {
    slug: "non-claims",
    title: "Non-Claims",
    group: "Concepts",
    palette: "coral",
    description: "Standing non-claims so clients do not invent capability from a route list.",
  },
];

export const apiPageHref = (slug: string): string => (slug === "" ? "/api/" : `/api/${slug}/`);
