import type {
  ForecastArtifact,
  ForecastWorkPlan,
  FrozenForecastArtifact,
} from "../forecast/model.ts";
import type { EvidenceKind, LanguageJobContext } from "./tasks.ts";

export interface ContentIdentity {
  algorithm: "sha256";
  digest: string;
  contentId: string;
  bytes: number;
}

export interface MediaTrackDescriptor {
  id: string;
  index: number;
  kind: "audio" | "video" | "subtitle" | "data" | "attachment";
  codec: string;
  durationMs: number | null;
}

/**
 * Provider-neutral output of a registered source adapter. Provider receipt fields stop before
 * this boundary; the runtime retains only an opaque receipt reference and enforceable scope.
 */
export interface SourceArtifactDescriptor {
  schema: "studio.source-artifact.v1";
  adapterId: string;
  sourceReceiptRef: string;
  publication: "private" | "public";
  path: string;
  content: ContentIdentity;
  durationMs: number;
  tracks: MediaTrackDescriptor[];
}

/** Host-only descriptor for producer-validated evidence that existed before runtime start. */
export interface PreflightEvidenceArtifactDescriptor {
  schema: "studio.preflight-evidence-artifact.v1" | "studio.preflight-evidence-artifact.v2";
  evidenceKind: EvidenceKind;
  receiptSchema: "studio.speech-activity.v1" | "studio.language-ranges.v1" | "studio.acoustic-observations.v1";
  producerId: "silero-vad" | "whisper-language-id" | "yamnet-acoustic-triage";
  path: string;
  content: ContentIdentity;
  producerReceiptPath?: string;
  producerReceiptContent?: ContentIdentity;
  preflightId: string;
  preflightContentId: string;
}

export interface ProductionSourceSession {
  schema: "studio.source-session.v1";
  sessionId: string;
  revisionId: string;
  adapterId: "owned-local-source-adapter.v1" | "youtube-local-source-adapter.v1";
  sourceReceipt: {
    schema: "studio.ingest.owned-local.v1" | "studio.ingest.youtube-local.v1";
    receiptId: string;
    contentId: string;
    rightsScope: "local_processing" | "redistribution";
  };
  source: {
    contentId: string;
    bytes: number;
    durationMs: number;
  };
  mediaProbe: {
    schema: "studio.media-probe.v1";
    producer: "scripts/probe-media.mjs";
    contentId: string;
  };
  preflight: {
      schema: "studio.preflight-bundle.v1" | "studio.preflight-bundle.v2" | "studio.preflight-bundle.v3" | "studio.preflight-bundle.v4";
    preflightId: string;
    contentId: string;
  };
  detectedLanguageEvidenceContentIds: string[];
}

export interface ProductionAnalysisRequest {
  schema: "studio.analysis-request.v1";
  requestId: string;
  sourceSessionId: string;
  sourceRevisionId: string;
  sourceContentId: string;
  range: { startMs: number; endMs: number };
  language: LanguageJobContext;
  outputDepth: "captions" | "evidence";
  options: {
    speechScope: "foreground" | "all";
    includeLyrics: boolean;
    speaker: string | null;
    honorifics: "preserve" | "naturalize";
    translationStyle: "literal" | "natural";
    captionDensity: "compact" | "balanced" | "relaxed";
    slowAnalysis: boolean;
  };
}

export interface RuntimeStartRecord {
  schema: "studio.runtime-start.v1";
  producer: { id: "studio.local-runtime-start"; version: "1" };
  commandId: string;
  runtimeId: string;
  journalId: string;
  sourceSession: ProductionSourceSession;
  sourceArtifactId: string;
  analysisRequest: ProductionAnalysisRequest;
  workPlan: ForecastWorkPlan;
  forecast: ForecastArtifact;
  frozenForecast: FrozenForecastArtifact;
  startedAt: string;
}
