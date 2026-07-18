import type { ComputerUseGrantScope, ComputerUseRequest, ComputerUseSessionReceipt } from "../model.ts";
import type { RuntimeEventBase } from "./base.ts";

export interface ComputerUseOperationStartedEvent extends RuntimeEventBase {
  type: "computer_use.operation_started";
  data: {
    request: ComputerUseRequest;
    scope: ComputerUseGrantScope;
    executionId: string;
    launchClaimId: string;
    requestFingerprint: string;
    sessionId: string;
  };
}

export interface ComputerUseOperationCompletedEvent extends RuntimeEventBase {
  type: "computer_use.operation_completed";
  data: {
    operationId: string;
    fixtureArtifactId: string;
    screenshotArtifactIds: string[];
    visibleContentArtifactIds: string[];
    actionArtifactIds: string[];
    sessionArtifactId: string;
    sessionReceiptContentId: string;
    receipt: ComputerUseSessionReceipt;
  };
}

export interface ComputerUseOperationFailedEvent extends RuntimeEventBase {
  type: "computer_use.operation_failed";
  data: { operationId: string; reason: "producer_failed" };
}
