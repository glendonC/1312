import type {
  CurrentRunRecognizerDescriptor,
  EvidenceAssessmentReceipt,
  EvidenceAssessmentRequest,
  EvidenceDecisionReceipt,
  EvidenceDecisionRequest,
  EvidenceReadReceipt,
  EvidenceReadRequest,
  SemanticMediaEvidenceReceipt,
  SpeechTranscribeRequest,
} from "../model.ts";
import type { RuntimeEventBase } from "./base.ts";

export interface SemanticEvidenceStartedEvent extends RuntimeEventBase {
  type: "semantic.evidence_started";
  data: {
    request: SpeechTranscribeRequest;
    grantId: string;
    executionId: string;
    launchClaimId: string;
    sourceContentId: string;
    producer: CurrentRunRecognizerDescriptor;
    limits: SemanticMediaEvidenceReceipt["limits"];
  };
}

export interface SemanticEvidenceCompletedEvent extends RuntimeEventBase {
  type: "semantic.evidence_completed";
  data: {
    operationId: string;
    outputArtifactId: string;
    outputContentId: string;
    receiptContentId: string;
    receipt: SemanticMediaEvidenceReceipt;
  };
}

export interface SemanticEvidenceFailedEvent extends RuntimeEventBase {
  type: "semantic.evidence_failed";
  data: { operationId: string; reason: string };
}

export interface EvidenceReadStartedEvent extends RuntimeEventBase {
  type: "evidence.read_started";
  data: {
    request: EvidenceReadRequest;
    grantId: string;
    evidenceKind: EvidenceReadReceipt["input"]["evidenceKind"];
    sourceArtifactId: string;
    startMs: number;
    endMs: number;
    maxBytes: number;
    maxItems: number;
  };
}

export interface EvidenceReadCompletedEvent extends RuntimeEventBase {
  type: "evidence.read_completed";
  data: { operationId: string; receiptContentId: string; receipt: EvidenceReadReceipt };
}

export interface EvidenceReadFailedEvent extends RuntimeEventBase {
  type: "evidence.read_failed";
  data: { operationId: string; reason: string };
}

export interface EvidenceAssessmentStartedEvent extends RuntimeEventBase {
  type: "analysis.evidence.assessment_started";
  data: {
    request: EvidenceAssessmentRequest;
    grantId: string;
    maxReadReceipts: number;
    maxClaims: number;
    maxCitations: number;
    maxTokens: number;
  };
}

export interface EvidenceAssessmentCompletedEvent extends RuntimeEventBase {
  type: "analysis.evidence.assessment_completed";
  data: {
    operationId: string;
    outputArtifactId: string;
    receiptContentId: string;
    receipt: EvidenceAssessmentReceipt;
  };
}

export interface EvidenceAssessmentFailedEvent extends RuntimeEventBase {
  type: "analysis.evidence.assessment_failed";
  data: { operationId: string; reason: string };
}

export interface EvidenceDecisionStartedEvent extends RuntimeEventBase {
  type: "analysis.evidence.decision_started";
  data: { request: EvidenceDecisionRequest; grantId: string; maxAuditedAssessments: number };
}

export interface EvidenceDecisionCompletedEvent extends RuntimeEventBase {
  type: "analysis.evidence.decision_completed";
  data: {
    operationId: string;
    outputArtifactId: string;
    receiptContentId: string;
    receipt: EvidenceDecisionReceipt;
  };
}

export interface EvidenceDecisionFailedEvent extends RuntimeEventBase {
  type: "analysis.evidence.decision_failed";
  data: { operationId: string; reason: string };
}
