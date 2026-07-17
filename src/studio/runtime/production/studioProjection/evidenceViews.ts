import type { EvidenceDecisionReasonCode, EvidenceKind } from "../model.ts";

export interface ProductionStudioEvidenceArtifactView {
  artifactId: string;
  kind: string;
  evidenceKind: EvidenceKind;
  receiptSchema: "studio.speech-activity.v1" | "studio.language-ranges.v1";
  producerId: "silero-vad" | "whisper-language-id";
  contentId: string;
  bytes: number;
  sourceArtifactIds: string[];
  preflightId: string;
  preflightContentId: string;
}

export interface ProductionStudioEvidenceReadView {
  operationId: string;
  capability: "evidence.read";
  status: "started" | "completed" | "failed";
  taskId: string;
  agentId: string;
  grantId: string;
  inputArtifactId: string;
  evidenceKind: EvidenceKind;
  sourceArtifactId: string;
  startMs: number;
  endMs: number;
  maxBytes: number;
  maxItems: number;
  receiptId: string | null;
  receiptContentId: string | null;
  returnedItems: number | null;
  returnedFactBytes: number | null;
  truncated: boolean | null;
  failure: string | null;
}

export interface ProductionStudioEvidenceAssessmentView {
  operationId: string;
  capability: "analysis.evidence.assess";
  status: "started" | "completed" | "failed";
  taskId: string;
  agentId: string;
  grantId: string;
  readReceiptIds: string[];
  readReceiptContentIds: string[];
  maxReadReceipts: number;
  maxClaims: number;
  maxCitations: number;
  maxTokens: number;
  outputArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  claimCount: number | null;
  citationCount: number | null;
  tokenCount: number | null;
  failure: string | null;
}

export interface ProductionStudioEvidenceAssessmentArtifactView {
  artifactId: string;
  kind: "evidence-assessment-receipt";
  contentId: string;
  bytes: number;
  producerTaskId: string;
  producerAgentId: string;
  operationId: string;
  receiptId: string;
  receiptContentId: string;
  readReceiptIds: string[];
  readReceiptContentIds: string[];
}

export interface ProductionStudioEvidenceDecisionView {
  operationId: string;
  capability: "analysis.evidence.decide";
  status: "started" | "completed" | "failed";
  taskId: string;
  agentId: string;
  grantId: string;
  assessmentOperationIds: string[];
  assessmentArtifactIds: string[];
  assessmentReceiptIds: string[];
  assessmentReceiptContentIds: string[];
  maxAuditedAssessments: number;
  outputArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  outcome: "withheld" | "proceed_to_publish_review" | null;
  reasonCodes: EvidenceDecisionReasonCode[];
  auditedClaimCount: number | null;
  failure: string | null;
}

export interface ProductionStudioEvidenceDecisionArtifactView {
  artifactId: string;
  kind: "evidence-decision-receipt";
  contentId: string;
  bytes: number;
  producerTaskId: string;
  producerAgentId: string;
  operationId: string;
  receiptId: string;
  receiptContentId: string;
  assessmentOperationIds: string[];
  assessmentArtifactIds: string[];
  assessmentReceiptIds: string[];
  assessmentReceiptContentIds: string[];
}

export interface ProductionStudioSemanticEvidenceView {
  operationId: string;
  capability: "speech.transcribe";
  status: "started" | "completed" | "failed";
  audit: "not_completed" | "verified_at_completion" | "verified_on_reopen" | "absent_or_invalid";
  producer: {
    id: string;
    version: string;
    model: string | null;
    runtimeId: string;
    runtimeVersion: string;
    configurationId: string;
    configurationContentId: string;
    executionScope: "current_run";
  };
  executor: { taskId: string; agentId: string; executionId: string; launchClaimId: string; grantId: string };
  source: {
    artifactId: string;
    contentId: string;
    trackId: string;
    range: { startMs: number; endMs: number };
  };
  returnedRange: { startMs: number; endMs: number } | null;
  artifact: { artifactId: string; contentId: string } | null;
  receipt: { receiptId: string; contentId: string } | null;
  observationCount: number | null;
  availability: {
    id: string;
    state: "available" | "empty" | "unavailable" | "unknown";
    truncated: boolean;
  } | null;
  failure: string | null;
}
