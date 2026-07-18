import type {
  ResearchDocumentSnapshotReceipt,
  ResearchFailureReason,
  ResearchGapBinding,
  ResearchLimits,
  ResearchRequest,
  ResearchSearchReceipt,
} from "../model.ts";
import type { RuntimeEventBase } from "./base.ts";

export interface ResearchOperationStartedEvent extends RuntimeEventBase {
  type: "research.operation_started";
  data: {
    request: ResearchRequest;
    gap: ResearchGapBinding;
    executionId: string;
    launchClaimId: string;
    requestFingerprint: string;
    limits: ResearchLimits;
    allowedDomains: string[];
  };
}

export interface ResearchOperationCompletedEvent extends RuntimeEventBase {
  type: "research.operation_completed";
  data: {
    operationId: string;
    op: "search" | "document_snapshot";
    receiptArtifactId: string;
    receiptContentId: string;
    receipt: ResearchSearchReceipt | ResearchDocumentSnapshotReceipt;
    documentArtifactId: string | null;
    extractionArtifactId: string | null;
  };
}

export interface ResearchOperationFailedEvent extends RuntimeEventBase {
  type: "research.operation_failed";
  data: { operationId: string; reason: ResearchFailureReason };
}
