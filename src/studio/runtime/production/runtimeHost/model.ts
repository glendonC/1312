import type {
  ProductionAnalysisRequest,
  ProductionSourceSession,
  RuntimeArtifact,
  RuntimeStartRecord,
} from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";

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
    | "stored_content_inconsistent";
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
  durationMs: number;
  preflightSchema: ProductionSourceSession["preflight"]["schema"];
  detectedLanguageEvidenceAvailable: boolean;
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

export interface InitializedRuntimeApplication {
  runtimeRoot: string;
  journalPath: string;
  artifactStoreRoot: string;
  runStartPath: string;
  runStart: RuntimeStartRecord;
  sourceArtifact: RuntimeArtifact;
  sourceSession: ProductionSourceSession;
}
