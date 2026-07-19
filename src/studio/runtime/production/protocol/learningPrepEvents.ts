import type {
  LearningPrepGrant,
  LearningPrepInputAuthority,
  LearningPrepReceipt,
  LearningPrepRequest,
} from "../model.ts";
import type { RuntimeEventBase } from "./base.ts";

export interface LearningPrepStartedEvent extends RuntimeEventBase {
  type: "learning.prep_started";
  data: {
    jobId: string;
    request: LearningPrepRequest;
    grant: LearningPrepGrant;
    input: LearningPrepInputAuthority;
  };
}

export interface LearningPrepCompletedEvent extends RuntimeEventBase {
  type: "learning.prep_completed";
  data: {
    jobId: string;
    artifactId: string;
    contentId: string;
    receiptArtifactId: string;
    receiptContentId: string;
    receipt: LearningPrepReceipt;
  };
}

export interface LearningPrepFailedEvent extends RuntimeEventBase {
  type: "learning.prep_failed";
  data: { jobId: string; reason: string };
}
