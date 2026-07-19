import type {
  OwnedMediaIngestRequest,
  OwnedMediaIngestStatus,
  RuntimeHostCaptionProductionRequest,
  RuntimeHostPrivatePlaybackGrant,
  RuntimeHostPrivatePlaybackGrantRequest,
  RuntimeHostPrivatePlaybackGrantRevocationRequest,
  RuntimeHostPublishReviewDecisionRequest,
  RuntimeHostPublishReviewRevocationRequest,
  RuntimeHostStartRequest,
  YouTubeLocalIngestRequest,
} from "../../studio/runtime/production/runtimeHost/model.ts";
import {
  ASSESSMENT_AUDITS_200,
  CAPTION_PRODUCTION_409,
  LANGUAGE_EXPLANATIONS_200,
  PUBLISH_REVIEW_DECISION_201,
  PUBLISH_REVIEW_INTAKES_200,
  RUNTIME_EVENTS_200,
  RUNTIME_PLAN_200,
  RUNTIME_START_ACK_202,
  RUNTIME_STATUS_200,
  SOURCE_SESSIONS_200,
  UNKNOWN_QUERY_400,
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

export const INGEST_STATUS_EXAMPLE = {
  schema: "studio.owned-media-ingest.v1",
  ingestId: "ingest-5b21d8",
  status: "queued",
  updatedAt: "2026-07-18T09:00:02.000Z",
  source: null,
  failure: null,
} satisfies OwnedMediaIngestStatus;

export const REVIEW_DECISION_EXAMPLE = {
  intake: {
    intakeId: "publish-review-intake:d5de1955c1403139502d5740a8d04b4e8c1e1d9a7437f12c265bef2fbe0425ae",
    artifactId: "artifact:99cceac7181985f69eeca33b15895fc0e860a0c8615399798eb90173788bf0f8",
    receiptId: "publish-review-intake-receipt:1c0b759f9f240367ca898422dddbd00836d7e5d0d5c45c2b476832bac453cb35",
    receiptContentId: "sha256:30d25055c5754fc51bab6fc9a235e15a20cb9fc4553fe2581beecfd03cdf31e0",
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
    reviewId: "publish-review:034269a4d347a017e3571f4adfd46d31854c7d2905e42fe414440dd606284489",
    artifactId: "artifact:36935fe16b283c526d0698a4ea65eee82d8047b2b891ecb9df1020d0a69183f9",
    receiptId: "publish-review-decision-receipt:b3808b2e9a083769ec640e93d276abb2976d4aaac988be922d0d9d56af920e79",
    receiptContentId: "sha256:63b79ac0b5991444ca9da036a1324548ad0fc655b0cf057edb094dfb8ec15129",
  },
} satisfies RuntimeHostCaptionProductionRequest;

export const REVIEW_REVOCATION_EXAMPLE = {
  approval: {
    reviewId: CAPTION_REQUEST_EXAMPLE.approval.reviewId,
    artifactId: CAPTION_REQUEST_EXAMPLE.approval.artifactId,
    receiptId: CAPTION_REQUEST_EXAMPLE.approval.receiptId,
    receiptContentId: CAPTION_REQUEST_EXAMPLE.approval.receiptContentId,
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

export const PLAYBACK_GRANT_EXAMPLE = {
  schema: "studio.private-playback-grant.v1",
  grantId: "grant-b2f1c0",
  runtimeId: "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
  source: {
    sessionId: RUN_005_SESSION_ID,
    revisionId: RUN_005_REVISION_ID,
    artifactId: RUN_005_SOURCE_ARTIFACT_ID,
    contentId: RUN_005_CONTENT_ID,
    bytes: 329_662,
    durationMs: 47_200,
  },
  mimeType: "audio/mp4",
  timestampOrigin: { kind: "source_media_zero", offsetMs: 0 },
  mediaPath: "/v1/private-source-media/grant-b2f1c0/{secret}",
  issuedAt: "2026-07-18T09:00:00.000Z",
  expiresAt: "2026-07-18T09:10:00.000Z",
} satisfies RuntimeHostPrivatePlaybackGrant;

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
# Default recorded caption executor may refuse fixture authority: that is fail-closed, not a host gap.`;

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
    detail: "Private caption candidates and structural QC. Not publication.",
  },
  {
    href: "/api/playback/",
    label: "Private Playback",
    detail: "Mint an origin-bound grant, then stream exact private source bytes.",
  },
  {
    href: "/api/language/",
    label: "Language Explanations",
    detail: "Typed facets over one verified caption span.",
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

const ingestStatusPanel = (title: string): ApiCodePanel => ({
  kind: "response",
  title: `${title} · Illustrative`,
  body: JSON.stringify(INGEST_STATUS_EXAMPLE, null, 2),
});

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
          ingestStatusPanel("202 · Ingest Status"),
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
            body: curlBinaryPut("/v1/owned-media-ingests/$INGEST_ID/media", "clip.m4a"),
          },
          ingestStatusPanel("202 · Ingest Status"),
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
          ingestStatusPanel("200 · Ingest Status"),
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
        ],
        panels: [
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
        ],
      },
    ],
  },
  {
    id: "captions",
    title: "Captions And QC",
    note: "Private caption candidates, verified timed lines, and structural QC. Not publication.",
    endpoints: [
      {
        methods: ["GET", "POST"],
        path: "/v1/runtimes/:runtimeId/caption-productions",
        summary: "Request or reopen private caption candidates from one unrevoked approval receipt.",
        responseSchema: "studio.local-runtime-caption-productions.v1",
        fieldTables: [
          CAPTION_PRODUCTION_REQUEST_FIELDS,
          listEnvelopeFields("captions", "Private caption production records for this runtime."),
        ],
        panels: [
          {
            kind: "request",
            title: "Request",
            body: curlFor("POST", "/v1/runtimes/$RUNTIME_ID/caption-productions", CAPTION_REQUEST_EXAMPLE),
          },
          {
            kind: "response",
            title: "409 · Fail-Closed · Captured",
            body: CAPTION_PRODUCTION_409,
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
        ],
      },
      {
        methods: ["GET", "POST"],
        path: "/v1/runtimes/:runtimeId/caption-quality-controls",
        summary: "Run or reopen the deterministic structural caption QC gate.",
        responseSchema: "studio.local-runtime-caption-quality-controls.v1",
        fieldTables: [
          CAPTION_QC_REQUEST_FIELDS,
          listEnvelopeFields("qualityControls", "Structural QC records; empty until a candidate is submitted."),
        ],
        panels: [
          {
            kind: "request",
            title: "Request · Read",
            body: curlFor("GET", "/v1/runtimes/$RUNTIME_ID/caption-quality-controls"),
          },
        ],
      },
    ],
  },
  {
    id: "language",
    title: "Language Explanations",
    note: "Typed facets over one verified caption span. Failed attempts stay visible; empty results are honest.",
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
        ],
      },
    ],
  },
  {
    id: "playback",
    title: "Private Playback",
    note: "Mint a short-lived origin-bound grant, then stream exact private source bytes. Media authorizes by grant secret, not the bearer token.",
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
            body: curlFor("POST", "/v1/runtimes/$RUNTIME_ID/private-playback-grants", PLAYBACK_GRANT_REQUEST_EXAMPLE),
          },
          {
            kind: "response",
            title: "201 · Playback Grant · Illustrative",
            body: JSON.stringify(PLAYBACK_GRANT_EXAMPLE, null, 2),
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
            body: curlFor(
              "POST",
              "/v1/runtimes/$RUNTIME_ID/private-playback-grants/$GRANT_ID/revocations",
              PLAYBACK_REVOKE_EXAMPLE,
            ),
          },
        ],
      },
      {
        methods: ["GET", "HEAD"],
        path: "/v1/private-source-media/:grantId/:secret",
        summary: "Stream granted media bytes with HTTP Range support. Binary response, no JSON envelope.",
        responseSchema: null,
        fieldTables: [],
        panels: [
          {
            kind: "request",
            title: "Request · HEAD + Range",
            body: curlPrivateMediaHead(),
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
