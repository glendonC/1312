import type {
  OwnedMediaIngestRequest,
  OwnedMediaIngestStatus,
  RuntimeHostAssessmentAuditResponse,
  RuntimeHostCaptionProductionRequest,
  RuntimeHostCaptionProductionResultsResponse,
  RuntimeHostCaptionProductionResponse,
  RuntimeHostCaptionQualityControlRequest,
  RuntimeHostCaptionQualityControlResponse,
  RuntimeHostDecisionReceiptResponse,
  RuntimeHostLanguageExplanationRequest,
  RuntimeHostLanguageExplanationResponse,
  RuntimeHostLearningPrepRequest,
  RuntimeHostLearningPrepResponse,
  RuntimeHostSpanTranslationRequest,
  RuntimeHostSpanTranslationResponse,
  RuntimeHostPlanResponse,
  RuntimeHostPollResponse,
  RuntimeHostPublishReviewDecisionRequest,
  RuntimeHostPublishReviewDecisionResponse,
  RuntimeHostPublishReviewIntakeResponse,
  RuntimeHostPublishReviewRevocationRequest,
  RuntimeHostSourceSummary,
  RuntimeHostStartAcknowledgement,
  RuntimeHostStartRequest,
  RuntimeHostStatus,
  YouTubeLocalIngestRequest,
  YouTubeLocalIngestStatus,
} from "../../runtime/production/runtimeHost/model.ts";
import {
  assessmentAuditResponse,
  decisionReceiptResponse,
} from "./auditResponses.ts";
import {
  captionProductionResponse,
  captionProductionResultsResponse,
  captionQualityControlResponse,
} from "./captionResponses.ts";
import { planResponse } from "./planResponse.ts";
import { languageExplanationResponse } from "./languageExplanationResponses.ts";
import { learningPrepResponse } from "./learningPrepResponses.ts";
import { spanTranslationResponse } from "./spanTranslationResponses.ts";
import {
  contentId,
  exact,
  fail,
  identity,
  object,
  RuntimeHostClientError,
  string,
} from "./responseGuards.ts";
import {
  publishReviewDecisionResponse,
  publishReviewIntakeResponse,
} from "./reviewResponses.ts";
import { pollResponse, statusResponse } from "./runtimeResponses.ts";
import { ingestStatus, sourceSummary, youtubeLocalIngestStatus } from "./sourceResponses.ts";
import {
  privatePlaybackGrantResponse,
  privatePlaybackRevocationResponse,
  type PrivatePlaybackExpectation,
  type PrivatePlaybackHandle,
} from "./privatePlaybackResponse.ts";

type RuntimeHostFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function normalizeLocalRuntimeHostBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new RuntimeHostClientError("Local runtime host URL must be a valid absolute URL.", "invalid_base_url");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (
    url.protocol !== "http:" ||
    !loopback ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new RuntimeHostClientError(
      "Local runtime host URL must be an exact loopback HTTP origin with no path, query, or credentials.",
      "invalid_base_url",
    );
  }
  return url.origin;
}

export class LocalRuntimeHostClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly fetcher: RuntimeHostFetch;

  constructor(options: { baseUrl: string; token: string; fetch?: RuntimeHostFetch }) {
    this.baseUrl = normalizeLocalRuntimeHostBaseUrl(options.baseUrl);
    if (!options.token || options.token.trim() !== options.token) {
      throw new RuntimeHostClientError("Paste the exact runtime-host token without surrounding spaces.", "invalid_token");
    }
    this.token = options.token;
    // Window.fetch is receiver-sensitive in browsers; keep the call as a global function rather
    // than storing it and later invoking it with this client as its receiver.
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      const headers = new Headers(init.headers);
      headers.set("Accept", "application/json");
      headers.set("Authorization", `Bearer ${this.token}`);
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        headers,
      });
    } catch (error) {
      throw new RuntimeHostClientError(
        "Could not reach the local runtime host. Confirm it is running and the Studio origin is allowed.",
        "host_unreachable",
        null,
      );
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new RuntimeHostClientError("The local runtime host returned invalid JSON.", "invalid_host_response", response.status);
    }
    if (!response.ok) {
      const envelope = object(value, "Runtime host error");
      const error = object(envelope.error, "Runtime host error detail");
      throw new RuntimeHostClientError(
        string(error.message, "Runtime host error message"),
        string(error.code, "Runtime host error code"),
        response.status,
      );
    }
    return value;
  }

  async listSourceSessions(): Promise<RuntimeHostSourceSummary[]> {
    const value = object(await this.request("/v1/source-sessions"), "Runtime host source list");
    exact(value, ["schema", "sourceSessions"], "Runtime host source list");
    if (value.schema !== "studio.local-source-session-list.v1") {
      fail("Runtime host source list", "schema is unsupported.");
    }
    if (!Array.isArray(value.sourceSessions)) fail("Runtime host source list", "sourceSessions must be an array.");
    return value.sourceSessions.map(sourceSummary);
  }

  async createOwnedMediaIngest(request: OwnedMediaIngestRequest): Promise<OwnedMediaIngestStatus> {
    return ingestStatus(await this.request("/v1/owned-media-ingests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }));
  }

  async uploadOwnedMedia(ingestId: string, bytes: Blob): Promise<OwnedMediaIngestStatus> {
    const stableId = identity(ingestId, "Owned media ingest id");
    return ingestStatus(await this.request(
      `/v1/owned-media-ingests/${encodeURIComponent(stableId)}/media`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
      },
    ));
  }

  async ownedMediaIngestStatus(ingestId: string): Promise<OwnedMediaIngestStatus> {
    const stableId = identity(ingestId, "Owned media ingest id");
    return ingestStatus(await this.request(`/v1/owned-media-ingests/${encodeURIComponent(stableId)}`));
  }

  async createYouTubeLocalIngest(request: YouTubeLocalIngestRequest): Promise<YouTubeLocalIngestStatus> {
    return youtubeLocalIngestStatus(await this.request("/v1/youtube-local-ingests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }));
  }

  async youtubeLocalIngestStatus(ingestId: string): Promise<YouTubeLocalIngestStatus> {
    const stableId = identity(ingestId, "YouTube local ingest id");
    return youtubeLocalIngestStatus(
      await this.request(`/v1/youtube-local-ingests/${encodeURIComponent(stableId)}`),
    );
  }

  async plan(request: RuntimeHostStartRequest): Promise<RuntimeHostPlanResponse> {
    const plan = planResponse(await this.request("/v1/runtime-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }));
    if (
      plan.sourceSessionId !== request.sourceSessionId ||
      plan.sourceRevisionId !== request.sourceRevisionId ||
      plan.forecast.inputs.selectedRange.startMs !== request.range.startMs ||
      plan.forecast.inputs.selectedRange.endMs !== request.range.endMs
    ) {
      fail("Runtime host plan", "source or selected-range identities do not match the submitted request.");
    }
    return plan;
  }

  async start(request: RuntimeHostStartRequest): Promise<RuntimeHostStartAcknowledgement> {
    const acknowledgement = statusResponse(
      await this.request("/v1/runtime-starts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
      "studio.local-runtime-start-ack.v1",
    ) as RuntimeHostStartAcknowledgement;
    if (
      acknowledgement.sourceSessionId !== request.sourceSessionId ||
      acknowledgement.sourceRevisionId !== request.sourceRevisionId
    ) {
      fail("Runtime host start acknowledgement", "source identities do not match the submitted request.");
    }
    return acknowledgement;
  }

  async status(runtimeId: string): Promise<RuntimeHostStatus> {
    return statusResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}`),
      "studio.local-runtime-status.v1",
    ) as RuntimeHostStatus;
  }

  async poll(runtimeId: string, after: number, limit = 100): Promise<RuntimeHostPollResponse> {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new RuntimeHostClientError("Local runtime poll cursor or limit is invalid.", "invalid_cursor");
    }
    const value = await this.request(
      `/v1/runtimes/${encodeURIComponent(runtimeId)}/events?after=${after}&limit=${limit}`,
    );
    const parsed = pollResponse(value, runtimeId);
    if (parsed.requestedCursor !== after) {
      fail("Runtime host event poll", "the host did not honor the requested cursor.");
    }
    return parsed;
  }

  async assessmentAudits(runtimeId: string): Promise<RuntimeHostAssessmentAuditResponse> {
    return assessmentAuditResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/assessment-audits`),
      runtimeId,
    );
  }

  async decisionReceipts(runtimeId: string): Promise<RuntimeHostDecisionReceiptResponse> {
    return decisionReceiptResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/decision-receipts`),
      runtimeId,
    );
  }

  async publishReviewIntakes(runtimeId: string): Promise<RuntimeHostPublishReviewIntakeResponse> {
    return publishReviewIntakeResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/publish-review-intakes`),
      runtimeId,
    );
  }

  async publishReviewDecisions(runtimeId: string): Promise<RuntimeHostPublishReviewDecisionResponse> {
    return publishReviewDecisionResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/publish-review-decisions`),
      runtimeId,
    );
  }

  async createPublishReviewDecision(
    runtimeId: string,
    request: RuntimeHostPublishReviewDecisionRequest,
  ): Promise<RuntimeHostPublishReviewDecisionResponse> {
    return publishReviewDecisionResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/publish-review-decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
      runtimeId,
    );
  }

  async createPublishReviewRevocation(
    runtimeId: string,
    request: RuntimeHostPublishReviewRevocationRequest,
  ): Promise<RuntimeHostPublishReviewDecisionResponse> {
    return publishReviewDecisionResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/publish-review-revocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
      runtimeId,
    );
  }

  async captionProductions(runtimeId: string): Promise<RuntimeHostCaptionProductionResponse> {
    return captionProductionResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/caption-productions`),
      runtimeId,
    );
  }

  async captionProductionResults(
    runtimeId: string,
  ): Promise<RuntimeHostCaptionProductionResultsResponse> {
    return captionProductionResultsResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/caption-production-results`),
      runtimeId,
    );
  }

  async captionQualityControls(
    runtimeId: string,
  ): Promise<RuntimeHostCaptionQualityControlResponse> {
    return captionQualityControlResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/caption-quality-controls`),
      runtimeId,
    );
  }

  async createCaptionQualityControl(
    runtimeId: string,
    request: RuntimeHostCaptionQualityControlRequest,
  ): Promise<RuntimeHostCaptionQualityControlResponse> {
    return captionQualityControlResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/caption-quality-controls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
      runtimeId,
    );
  }

  async createCaptionProduction(
    runtimeId: string,
    request: RuntimeHostCaptionProductionRequest,
  ): Promise<RuntimeHostCaptionProductionResponse> {
    return captionProductionResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/caption-productions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
      runtimeId,
    );
  }

  async languageExplanations(runtimeId: string): Promise<RuntimeHostLanguageExplanationResponse> {
    return languageExplanationResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/language-explanations`),
      runtimeId,
    );
  }

  async createLanguageExplanation(
    runtimeId: string,
    request: RuntimeHostLanguageExplanationRequest,
  ): Promise<RuntimeHostLanguageExplanationResponse> {
    return languageExplanationResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/language-explanations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
      runtimeId,
    );
  }

  async spanTranslations(runtimeId: string): Promise<RuntimeHostSpanTranslationResponse> {
    return spanTranslationResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/span-translations`),
      runtimeId,
    );
  }

  async createSpanTranslation(
    runtimeId: string,
    request: RuntimeHostSpanTranslationRequest,
  ): Promise<RuntimeHostSpanTranslationResponse> {
    return spanTranslationResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/span-translations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
      runtimeId,
    );
  }

  async learningPreps(runtimeId: string): Promise<RuntimeHostLearningPrepResponse> {
    return learningPrepResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/learning-preps`),
      runtimeId,
    );
  }

  async createLearningPrep(
    runtimeId: string,
    request: RuntimeHostLearningPrepRequest,
  ): Promise<RuntimeHostLearningPrepResponse> {
    return learningPrepResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/learning-preps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
      runtimeId,
    );
  }

  async createPrivatePlaybackHandle(
    expected: PrivatePlaybackExpectation,
  ): Promise<PrivatePlaybackHandle> {
    const runtimeId = identity(expected.runtimeId, "Private playback runtime id");
    const sourceRevisionId = identity(expected.sourceRevisionId, "Private playback source revision id");
    const sourceArtifactId = identity(expected.sourceArtifactId, "Private playback source artifact id");
    const sourceContentId = contentId(expected.sourceContentId, "Private playback source content id");
    return privatePlaybackGrantResponse(
      await this.request(`/v1/runtimes/${encodeURIComponent(runtimeId)}/private-playback-grants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schema: "studio.private-playback-grant-request.v1",
          source: {
            revisionId: sourceRevisionId,
            artifactId: sourceArtifactId,
            contentId: sourceContentId,
          },
        }),
      }),
      {
        baseUrl: this.baseUrl,
        expected: { runtimeId, sourceRevisionId, sourceArtifactId, sourceContentId },
        revoke: (revokeRuntimeId, grantId) => this.revokePrivatePlaybackGrant(revokeRuntimeId, grantId),
      },
    );
  }

  private async revokePrivatePlaybackGrant(runtimeId: string, grantId: string) {
    return privatePlaybackRevocationResponse(
      await this.request(
        `/v1/runtimes/${encodeURIComponent(runtimeId)}/private-playback-grants/${encodeURIComponent(grantId)}/revocations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ schema: "studio.private-playback-grant-revocation.v1" }),
        },
      ),
      runtimeId,
      grantId,
    );
  }
}
