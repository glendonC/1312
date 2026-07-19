import type {
  ProductionAnalysisRequest,
  ProductionSourceSession,
  RuntimeArtifact,
  RuntimeStartRecord,
} from "../model.ts";
import type { ForecastArtifact } from "../forecast/model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import type { EvidenceAssessmentAudit } from "../assessmentAudit.ts";
import type { EvidenceDecisionReceiptVerification } from "../decisionReceiptAudit.ts";
import type { PublishReviewIntakeVerification } from "../review/publishReviewIntakeAudit.ts";
import type {
  PublishReviewDecisionRequest,
  PublishReviewOperator,
  PublishReviewRevocationRequest,
} from "../model.ts";
import type { PublishReviewDecisionVerification } from "../review/publishReviewDecisionAudit.ts";
import type {
  CaptionProductionVerification,
  VerifiedCaptionProductionResult,
} from "../captions/captionProductionAudit.ts";
import type { CaptionQualityControlVerification } from "../captions/captionQualityControlAudit.ts";
import type { VerifiedLanguageExplanationResult, VerifiedLearningPrepResult } from "../model.ts";

export const RUNTIME_HOST_LIFECYCLE_STATES = [
  "accepted",
  "initializing",
  "running",
  "terminal",
  "failed",
  "interrupted",
] as const;

export type RuntimeHostLifecycleState = (typeof RUNTIME_HOST_LIFECYCLE_STATES)[number];

export interface RuntimeHostFailureReason {
  code:
    | "initialization_failed"
    | "executor_failed"
    | "executor_interrupted"
    | "host_stopped_before_start_receipt"
    | "host_stopped_before_journal"
    | "host_stopped_before_executor_launch"
    | "executor_launch_unconfirmed"
    | "nonterminal_journal_after_restart"
    | "runtime_evidence_failed"
    | "stored_content_inconsistent"
    | "malformed_journal";
  message: string;
}

export interface RuntimeHostStartRequest {
  sourceSessionId: string;
  sourceRevisionId: string;
  range: { startMs: number; endMs: number };
  requestedSourceLanguage:
    | { mode: "declared"; languages: [string]; reason: null }
    | { mode: "automatic"; languages: []; reason: null }
    | { mode: "mixed"; languages: [string, string, ...string[]]; reason: null }
    | { mode: "unknown"; languages: []; reason: null }
    | { mode: "withheld"; languages: []; reason: string };
  targetLanguage: string;
  selectedLanguagePackId: string | null;
  outputDepth: "captions" | "evidence";
  options?: Partial<ProductionAnalysisRequest["options"]>;
  clientRequestId?: string;
  /**
   * Optional reviewed memory materialization to consume for this run. Absent or null keeps
   * reviewedMemory unavailable. Present values must already exist in the host memory store.
   */
  materializationId?: string | null;
}

export interface RuntimeHostCommandRecord {
  schema: "studio.local-runtime-command.v1";
  producer: { id: "studio.local-runtime-host"; version: "1" };
  commandId: string;
  requestContentId: string;
  sourceSessionId: string;
  sourceRevisionId: string;
  analysisRequestId: string;
  runtimeId: string;
  journalId: string;
  acceptedAt: string;
  lifecycle: RuntimeHostLifecycleState;
  lastTransitionAt: string;
  reason: RuntimeHostFailureReason | null;
  runStartReceiptContentId: string | null;
  forecastContentId: string | null;
  frozenForecastId: string | null;
  journalHead: number;
}

export interface RuntimeHostSourceSummary {
  sourceSessionId: string;
  sourceRevisionId: string;
  sourceContentId: string;
  sourceKind: "owned_local" | "youtube_local";
  label: string;
  rightsScope: ProductionSourceSession["sourceReceipt"]["rightsScope"];
  durationMs: number;
  trackCount: number;
  preflightSchema: ProductionSourceSession["preflight"]["schema"];
  detectedLanguageEvidenceAvailable: boolean;
}

export const PRIVATE_PLAYBACK_GRANT_TTL_MS = 10 * 60 * 1_000;

export const PRIVATE_PLAYBACK_MIME_TYPES = [
  "audio/flac",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "video/mp4",
  "video/ogg",
  "video/webm",
] as const;

export type PrivatePlaybackMimeType = (typeof PRIVATE_PLAYBACK_MIME_TYPES)[number];

export interface RuntimeHostPrivatePlaybackGrantRequest {
  schema: "studio.private-playback-grant-request.v1";
  source: {
    revisionId: string;
    artifactId: string;
    contentId: string;
  };
}

export interface RuntimeHostPrivatePlaybackGrant {
  schema: "studio.private-playback-grant.v1";
  grantId: string;
  runtimeId: string;
  source: {
    sessionId: string;
    revisionId: string;
    artifactId: string;
    contentId: string;
    bytes: number;
    durationMs: number;
  };
  mimeType: PrivatePlaybackMimeType;
  timestampOrigin: { kind: "source_media_zero"; offsetMs: 0 };
  mediaPath: string;
  issuedAt: string;
  expiresAt: string;
}

export interface RuntimeHostPrivatePlaybackGrantRevocationRequest {
  schema: "studio.private-playback-grant-revocation.v1";
}

export interface RuntimeHostPrivatePlaybackGrantRevocationResponse {
  schema: "studio.private-playback-grant-revoked.v1";
  grantId: string;
  runtimeId: string;
  state: "revoked";
  revokedAt: string;
}

export const OWNED_MEDIA_INGEST_STATES = [
  "queued",
  "probing",
  "sealing",
  "registered",
  "failed",
] as const;

export type OwnedMediaIngestState = (typeof OWNED_MEDIA_INGEST_STATES)[number];

export interface OwnedMediaIngestRequest {
  filename: string;
  declaredBytes: number;
  label: string;
  rightsHolder: string;
  rightsScope: "local_processing";
  ownershipAttested: true;
}

export interface OwnedMediaIngestFailure {
  code: "upload_failed" | "probe_failed" | "seal_failed" | "registration_failed";
  message: string;
}

export interface OwnedMediaIngestStatus {
  schema: "studio.owned-media-ingest.v1";
  ingestId: string;
  status: OwnedMediaIngestState;
  updatedAt: string;
  source: RuntimeHostSourceSummary | null;
  failure: OwnedMediaIngestFailure | null;
}

export const YOUTUBE_LOCAL_INGEST_STATES = [
  "queued",
  "resolving",
  "downloading",
  "probing",
  "sealing",
  "registered",
  "failed",
] as const;

export type YouTubeLocalIngestState = (typeof YOUTUBE_LOCAL_INGEST_STATES)[number];

export interface YouTubeLocalIngestRequest {
  url: string;
  startMs: number;
  endMs: number;
  localProcessingConfirmed: true;
}

export interface YouTubeLocalIngestFailure {
  code:
    | "resolution_failed"
    | "download_failed"
    | "probe_failed"
    | "seal_failed"
    | "registration_failed";
  message: string;
}

export interface YouTubeLocalIngestStatus {
  schema: "studio.youtube-local-ingest.v1";
  ingestId: string;
  status: YouTubeLocalIngestState;
  updatedAt: string;
  source: RuntimeHostSourceSummary | null;
  failure: YouTubeLocalIngestFailure | null;
}

export interface RuntimeHostPlanResponse {
  schema: "studio.local-runtime-plan.v1";
  commandId: string;
  runtimeId: string;
  sourceSessionId: string;
  sourceRevisionId: string;
  analysisRequestId: string;
  forecast: ForecastArtifact;
  acceptance: {
    status: "not_started";
    frozenForecastId: null;
  };
}

export interface RuntimeHostStatus {
  schema: "studio.local-runtime-status.v1";
  commandId: string;
  runtimeId: string;
  journalId: string;
  lifecycle: RuntimeHostLifecycleState;
  acceptedAt: string;
  lastTransitionAt: string;
  reason: RuntimeHostFailureReason | null;
  sourceSessionId: string;
  sourceRevisionId: string;
  analysisRequestId: string;
  forecast: null | {
    forecastId: string;
    contentId: string;
    frozenForecastId: string;
    baselineStatus: "floor_only";
  };
  runStartReceipt: null | {
    contentId: string;
    record: RuntimeStartRecord;
  };
  journalHead: number;
  terminal: boolean;
}

export interface RuntimeHostStartAcknowledgement extends Omit<RuntimeHostStatus, "schema"> {
  schema: "studio.local-runtime-start-ack.v1";
}

export interface RuntimeHostPollResponse {
  schema: "studio.local-runtime-events.v1";
  commandId: string;
  runtimeId: string;
  lifecycle: RuntimeHostLifecycleState;
  requestedCursor: number;
  nextCursor: number;
  journalHead: number;
  events: RuntimeEvent[];
  reachedHead: boolean;
  terminal: boolean;
  reason: RuntimeHostFailureReason | null;
}

export interface RuntimeHostAssessmentAuditResponse {
  schema: "studio.local-runtime-assessment-audits.v1";
  commandId: string;
  runtimeId: string;
  journalHead: number;
  audits: EvidenceAssessmentAudit[];
}

export interface RuntimeHostDecisionReceiptResponse {
  schema: "studio.local-runtime-decision-receipts.v1";
  commandId: string;
  runtimeId: string;
  journalHead: number;
  decisions: EvidenceDecisionReceiptVerification[];
}

export interface RuntimeHostPublishReviewIntakeResponse {
  schema: "studio.local-runtime-publish-review-intakes.v1";
  commandId: string;
  runtimeId: string;
  journalHead: number;
  intakes: PublishReviewIntakeVerification[];
}

export interface RuntimeHostPublishReviewOperator extends PublishReviewOperator {
  decisionAttestation: "I attest that I am the named reviewer and made this review decision.";
  revocationAttestation: "I attest that I am the named reviewer and made this revocation decision.";
}

export interface RuntimeHostPublishReviewDecisionResponse {
  schema: "studio.local-runtime-publish-review-decisions.v1";
  commandId: string;
  runtimeId: string;
  journalHead: number;
  reviewer: RuntimeHostPublishReviewOperator;
  reviews: PublishReviewDecisionVerification[];
}

export type RuntimeHostPublishReviewDecisionRequest = PublishReviewDecisionRequest;
export type RuntimeHostPublishReviewRevocationRequest = PublishReviewRevocationRequest;

export interface RuntimeHostCaptionProductionResponse {
  schema: "studio.local-runtime-caption-productions.v1";
  commandId: string;
  runtimeId: string;
  journalHead: number;
  captions: CaptionProductionVerification[];
}

export interface RuntimeHostCaptionProductionResultsResponse {
  schema: "studio.local-runtime-caption-production-results.v1";
  commandId: string;
  runtimeId: string;
  journalHead: number;
  results: VerifiedCaptionProductionResult[];
}

export interface RuntimeHostCaptionQualityControlResponse {
  schema: "studio.local-runtime-caption-quality-controls.v1";
  commandId: string;
  runtimeId: string;
  journalHead: number;
  qualityControls: CaptionQualityControlVerification[];
}

export type RuntimeHostCaptionProductionRequest = import("../model.ts").CaptionProductionRequest;
export type RuntimeHostCaptionQualityControlRequest = import("../model.ts").CaptionQualityControlRequest;

export interface RuntimeHostLanguageExplanationResponse {
  schema: "studio.local-runtime-language-explanations.v1";
  commandId: string;
  runtimeId: string;
  journalHead: number;
  attempts: import("../model.ts").LanguageExplanationAttemptState[];
  results: VerifiedLanguageExplanationResult[];
}

export type RuntimeHostLanguageExplanationRequest = import("../model.ts").LanguageExplanationRequest;

export interface RuntimeHostLearningPrepResponse {
  schema: "studio.local-runtime-learning-preps.v1";
  commandId: string;
  runtimeId: string;
  journalHead: number;
  attempts: import("../model.ts").LearningPrepAttemptState[];
  results: VerifiedLearningPrepResult[];
}

export type RuntimeHostLearningPrepRequest = import("../model.ts").LearningPrepRequest;

export interface InitializedRuntimeApplication {
  runtimeRoot: string;
  journalPath: string;
  artifactStoreRoot: string;
  runStartPath: string;
  runStart: RuntimeStartRecord;
  sourceArtifact: RuntimeArtifact;
  evidenceArtifacts: RuntimeArtifact[];
  sourceSession: ProductionSourceSession;
}
