import type {
  ConditionalSeparationFailureReason,
  ConditionalSeparationLimits,
  ConditionalSeparationReceipt,
  ConditionalSeparationRequest,
  MediaScope,
  RawStemComparisonReceipt,
  U6SpeakerOverlapSeparationTrigger,
} from "../model.ts";
import type { RuntimeEventBase } from "./base.ts";

export interface ConditionalSeparationStartedEvent extends RuntimeEventBase {
  type: "media.conditional_separation_started";
  data: {
    request: ConditionalSeparationRequest;
    scope: MediaScope;
    sourceContentId: string;
    executionId: string;
    launchClaimId: string;
    requestFingerprint: string;
    trigger: U6SpeakerOverlapSeparationTrigger;
    limits: ConditionalSeparationLimits;
  };
}

export interface ConditionalSeparationCompletedEvent extends RuntimeEventBase {
  type: "media.conditional_separation_completed";
  data: {
    operationId: string;
    stemArtifactIds: [string, string];
    receiptArtifactId: string;
    receiptContentId: string;
    receipt: ConditionalSeparationReceipt;
    comparisonArtifactId: string;
    comparisonReceiptArtifactId: string;
    comparisonReceiptContentId: string;
    comparisonReceipt: RawStemComparisonReceipt;
  };
}

export interface ConditionalSeparationFailedEvent extends RuntimeEventBase {
  type: "media.conditional_separation_failed";
  data: { operationId: string; reason: ConditionalSeparationFailureReason };
}
