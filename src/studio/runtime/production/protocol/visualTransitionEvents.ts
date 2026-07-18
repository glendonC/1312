import type {
  VisualTransitionFailureReason,
  VisualTransitionLimits,
  VisualTransitionReceipt,
  VisualTransitionRequest,
} from "../model/visualTransitions.ts";
import type { MediaScope } from "../model/tasks.ts";
import type { RuntimeEventBase } from "./base.ts";

export interface VisualTransitionStartedEvent extends RuntimeEventBase {
  type: "media.visual_transitions_started";
  data: {
    request: VisualTransitionRequest;
    scope: MediaScope;
    sourceContentId: string;
    executionId: string;
    launchClaimId: string;
    requestFingerprint: string;
    limits: VisualTransitionLimits;
  };
}

export interface VisualTransitionCompletedEvent extends RuntimeEventBase {
  type: "media.visual_transitions_completed";
  data: {
    operationId: string;
    outputArtifactId: string;
    receiptArtifactId: string;
    receiptContentId: string;
    receipt: VisualTransitionReceipt;
  };
}

export interface VisualTransitionFailedEvent extends RuntimeEventBase {
  type: "media.visual_transitions_failed";
  data: { operationId: string; reason: VisualTransitionFailureReason };
}
