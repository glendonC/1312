import type {
  OwnedMediaStudyConflict,
  OwnedMediaStudyCoverageRange,
  OwnedMediaStudyExecutorReceipt,
  StudyFollowUpRecord,
  StudyPlanningDecisionReceipt,
  StudyReadinessReceipt,
} from "../model.ts";
import type { RuntimeEventBase } from "./base.ts";

export interface StudyPlanningDecisionRecordedEvent extends RuntimeEventBase {
  type: "study.planning_decision_recorded";
  data: {
    outputArtifactId: string;
    receiptContentId: string;
    receipt: StudyPlanningDecisionReceipt;
  };
}

export interface StudyFollowUpLinkedEvent extends RuntimeEventBase {
  type: "study.follow_up_linked";
  data: { followUp: StudyFollowUpRecord };
}

export interface OwnedMediaStudyCompletedEvent extends RuntimeEventBase {
  type: "study.synthesis_completed";
  data: {
    studyId: string;
    outputArtifactId: string;
    outputContentId: string;
    executorReceiptContentId: string;
    executorReceipt: OwnedMediaStudyExecutorReceipt;
    projection: {
      coverage: OwnedMediaStudyCoverageRange[];
      conflicts: OwnedMediaStudyConflict[];
    };
  };
}

export interface StudyReadinessAuditedEvent extends RuntimeEventBase {
  type: "study.readiness_audited";
  data: {
    studyId: string;
    outputArtifactId: string;
    receiptContentId: string;
    receipt: StudyReadinessReceipt;
  };
}
