import type { CurrentRunRecognizerDescriptor } from "./semanticEvidence.ts";
import type { ContentIdentity } from "./source.ts";
import type { RequestedSourceLanguage } from "./tasks.ts";

export const CONDITIONAL_SEPARATION_HOST_ARTIFACT_KINDS = [
  "studio.separated-audio-stem.v1",
  "studio.conditional-separation.receipt.v1",
  "studio.raw-stem-comparison.v1",
  "studio.raw-stem-comparison.receipt.v1",
] as const;

export function isConditionalSeparationHostArtifactKind(value: string): boolean {
  return (CONDITIONAL_SEPARATION_HOST_ARTIFACT_KINDS as readonly string[]).includes(value);
}

export const CONDITIONAL_SEPARATION_LIMITS = {
  maxRangeMs: 10_000,
  maxSourceBytes: 512 * 1024 * 1024,
  maxNormalizedAudioBytes: 160_128,
  maxDecodedSamples: 80_000,
  maxStems: 2,
  maxStemBytes: 160_128,
  maxReceiptBytes: 256 * 1024,
  maxComparisonBytes: 512 * 1024,
  maxComparisonReceiptBytes: 256 * 1024,
  maxRecognizerSegmentsPerInput: 256,
  maxWallMs: 60_000,
  maxCalls: 1,
} as const;

export const SEPARATION_METHOD = {
  id: "speechbrain-sepformer-wsj02mix",
  version: "1",
  modelId: "speechbrain/sepformer-wsj02mix",
  modelRevision: "3a2826343a10e2d2e8a75f79aeab5ff3a2473531",
  modelContentIds: [
    "sha256:939c86a8d36c52ae148859de34a3e7b984f4b576213957bdba09462cc88168bf",
    "sha256:3139bb880b29ea77ae8a168b8f2ad6e8eb5c2c0904289676c223d0e93cd2a35d",
    "sha256:abea1a2d41151331b4c36071d1b3205aed940a189721f008b12a703e9c63e7e4",
    "sha256:57dd5f49bf21c5a2101bb4e46648d05d34d517a59e26f0b06646d0bebe8214c7",
  ],
  configurationContentId: "sha256:ddf92728a965dc19e84a530be2ce8dcc64cec5828d3de046597c0bc6bfa5b23b",
} as const;

export interface ConditionalSeparationLimits {
  maxRangeMs: number;
  maxSourceBytes: number;
  maxNormalizedAudioBytes: number;
  maxDecodedSamples: number;
  maxStems: number;
  maxStemBytes: number;
  maxReceiptBytes: number;
  maxComparisonBytes: number;
  maxComparisonReceiptBytes: number;
  maxRecognizerSegmentsPerInput: number;
  maxWallMs: number;
  maxCalls: number;
}

export interface U6SpeakerOverlapSeparationTrigger {
  kind: "u6_speaker_overlap";
  operationId: string;
  observationsArtifactId: string;
  observationsContentId: string;
  receiptArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  observationId: string;
  range: { startMs: number; endMs: number };
}

/**
 * U7.1 second eligible cause. A cold-audited acoustic cell classified `mixed` proves two
 * co-present source families (strong speech and music above support) in one exact range. Lineage
 * anchors on the preflight acoustic-observations artifact and its content-addressed producer
 * receipt (there is no acoustic ledger operation and no separate receipt artifact, unlike U6).
 * `observationId` is the content-addressed acoustic observation identity; `observationIndex` locates
 * the exact partition cell on reopen; `trackId` lets the synchronous scheduler resolve the audio
 * track without reparsing the receipt.
 */
export interface U1AcousticSeparationTrigger {
  kind: "u1_acoustic_mixed";
  observationsArtifactId: string;
  observationsContentId: string;
  receiptId: string;
  receiptContentId: string;
  observationId: string;
  observationIndex: number;
  trackId: string;
  range: { startMs: number; endMs: number };
}

export type ConditionalSeparationTrigger = U6SpeakerOverlapSeparationTrigger | U1AcousticSeparationTrigger;

export interface ConditionalSeparationTriggerOption {
  triggerId: string;
  source: ConditionalSeparationGrantScope["source"];
  trigger: ConditionalSeparationTrigger;
}

export interface ConditionalSeparationRequestInput {
  schema: "studio.separation-request-input.v1";
  inputId: string;
  runId: string;
  root: { taskId: string; agentId: string; executionId: string };
  triggers: ConditionalSeparationTriggerOption[];
}

export interface ConditionalSeparationGrantScope {
  schema: "studio.conditional-separation-grant.v1";
  source: {
    artifactId: string;
    contentId: string;
    trackId: string;
    range: { startMs: number; endMs: number };
  };
  trigger: ConditionalSeparationTrigger;
  producerPolicy: {
    methodId: typeof SEPARATION_METHOD.id;
    methodVersion: typeof SEPARATION_METHOD.version;
    modelId: typeof SEPARATION_METHOD.modelId;
    modelRevision: typeof SEPARATION_METHOD.modelRevision;
    modelContentIds: string[];
    configurationContentId: string;
    stemRoles: ["source_estimate_1", "source_estimate_2"];
  };
  limits: ConditionalSeparationLimits;
}

/** Every field is injected by the task-private bridge; the child-facing call remains `{}`. */
export interface ConditionalSeparationRequest {
  operationId: string;
  taskId: string;
  agentId: string;
  grantId: string;
}

export interface SeparationRuntimeFileIdentity {
  name: string;
  content: ContentIdentity;
}

export interface SeparationProducerLineage {
  schema: "studio.source-separation-lineage.v1";
  adapter: { id: typeof SEPARATION_METHOD.id; version: typeof SEPARATION_METHOD.version };
  runtime: {
    python: { version: "3.14"; platform: "darwin"; arch: "arm64" };
    packages: {
      speechbrain: { version: "1.1.0" };
      torch: { version: "2.11.0" };
      torchaudio: { version: "2.11.0" };
    };
    files: SeparationRuntimeFileIdentity[];
    execution: { engine: "python_subprocess"; provider: "cpu"; threads: 1; network: "disabled" };
  };
  model: {
    id: typeof SEPARATION_METHOD.modelId;
    revision: typeof SEPARATION_METHOD.modelRevision;
    license: "Apache-2.0-model-card-declaration";
    trainingDomain: "wsj0-2mix";
    files: SeparationRuntimeFileIdentity[];
  };
  configuration: {
    contentId: string;
    sampleRateHz: 8_000;
    channels: 1;
    sampleFormat: "pcm_s16le_wav";
    estimatedSources: 2;
    outputRoles: ["source_estimate_1", "source_estimate_2"];
    timing: "exact_granted_range_relative_audio";
  };
}

export interface SeparationStemOutput {
  role: "source_estimate_1" | "source_estimate_2";
  artifactId: string;
  contentId: string;
  bytes: number;
  trackId: string;
  durationMs: number;
  sampleCount: number;
}

export interface ConditionalSeparationReceipt {
  schema: "studio.conditional-separation.receipt.v1";
  receiptId: string;
  operationId: string;
  capability: "media.audio.separate";
  authorization: {
    grantId: string;
    taskId: string;
    agentId: string;
    executionId: string;
    launchClaimId: string;
  };
  source: ConditionalSeparationGrantScope["source"] & {
    sourceBytes: number;
    normalizedAudio: { content: ContentIdentity; sampleRateHz: 8_000; channels: 1; sampleFormat: "pcm_s16le_wav"; sampleCount: number };
  };
  trigger: ConditionalSeparationTrigger;
  producer: SeparationProducerLineage;
  limits: ConditionalSeparationLimits;
  execution: { wallMs: number; measuredBeforeReceiptMs: number; wallAccounting: "full_grant_charged_before_atomic_completion" };
  outputs: [SeparationStemOutput, SeparationStemOutput];
  nonClaims: {
    speakerIdentity: "not_assessed";
    sourceIdentity: "anonymous_estimate_only";
    separationQuality: "not_assessed";
    semanticPreference: "not_granted";
    captionAuthority: "not_granted";
    publication: "not_granted";
  };
}

export interface SeparationRecognizerResult {
  availability: "available" | "empty" | "unavailable" | "unknown" | "truncated";
  reason: string;
  segments: Array<{ startMs: number; endMs: number; state: "available" | "unavailable" | "unknown"; text: string | null }>;
}

export interface RawStemComparison {
  schema: "studio.raw-stem-comparison.v1";
  operationId: string;
  runId: string;
  source: ConditionalSeparationGrantScope["source"];
  separationReceiptId: string;
  recognizer: CurrentRunRecognizerDescriptor;
  requestedSourceLanguage: RequestedSourceLanguage;
  inputs: {
    raw: { artifactId: string; contentId: string; result: SeparationRecognizerResult };
    stems: Array<{ role: SeparationStemOutput["role"]; artifactId: string; contentId: string; result: SeparationRecognizerResult }>;
  };
  outcome: "agreement" | "disagreement" | "abstention";
  reason: "normalized_text_agrees" | "normalized_text_disagrees" | "recognizer_unavailable_or_incomplete";
  deterministicGate: {
    lineage: "verified";
    comparable: true;
    sameRecognizer: true;
    exactRange: true;
    semanticPreference: null;
    semanticAuthority: "not_granted";
    captionAuthority: "not_granted";
  };
}

export interface RawStemComparisonReceipt {
  schema: "studio.raw-stem-comparison.receipt.v1";
  receiptId: string;
  operationId: string;
  separationReceiptId: string;
  comparison: { artifactId: string; contentId: string; bytes: number; outcome: RawStemComparison["outcome"] };
  recognizer: CurrentRunRecognizerDescriptor;
  inputArtifactIds: [string, string, string];
  nonClaims: ConditionalSeparationReceipt["nonClaims"];
}

export type ConditionalSeparationFailureReason =
  | "source_unavailable"
  | "input_oversized"
  | "trigger_invalid"
  | "model_unavailable"
  | "runtime_drift"
  | "decoder_failed"
  | "separator_timeout"
  | "separator_failed"
  | "recognizer_failed"
  | "artifact_oversized";

export interface ConditionalSeparationOperationRecord {
  id: string;
  taskId: string;
  agentId: string;
  grantId: string;
  executionId: string;
  launchClaimId: string;
  sourceArtifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  requestFingerprint: string;
  trigger: ConditionalSeparationTrigger;
  limits: ConditionalSeparationLimits;
  status: "started" | "completed" | "failed";
  stemArtifactIds: string[];
  receiptArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  comparisonArtifactId: string | null;
  comparisonReceiptArtifactId: string | null;
  comparisonReceiptId: string | null;
  failure: ConditionalSeparationFailureReason | null;
}
