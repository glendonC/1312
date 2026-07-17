import type {
  OwnedMediaStudyConflict,
  OwnedMediaStudyCoverageRange,
  OwnedMediaStudyExecutorReceipt,
  StudyFollowUpRecord,
  StudyPlanningDecisionReceipt,
  StudyReadinessReceipt,
  ParentArtifactAdmissionReceiptV2,
  ParentArtifactReadReceiptV2,
  OwnedMediaStudyExecutorReceiptV2,
  OwnedMediaStudyCoverageRangeV2,
  OwnedMediaStudyClaimV2,
  EvidenceCitationEnvelope,
  StudyReadinessReceiptV3,
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

export interface GeneralizedParentAdmissionRecordedEvent extends RuntimeEventBase {
  type: "parent.generalized_admission_recorded";
  data: {
    reportId: string;
    outputArtifactId: string;
    admissionArtifactId: string;
    receiptContentId: string;
    receipt: ParentArtifactAdmissionReceiptV2;
  };
}

export interface GeneralizedParentArtifactReadCompletedEvent extends RuntimeEventBase {
  type: "parent.generalized_artifact_read_completed";
  data: {
    parentTaskId: string;
    parentAgentId: string;
    receiptArtifactId: string;
    receiptContentId: string;
    receipt: ParentArtifactReadReceiptV2;
  };
}

export interface GeneralizedOwnedMediaStudyCompletedEvent extends RuntimeEventBase {
  type: "study.generalized_synthesis_completed";
  data: {
    studyId: string;
    outputArtifactId: string;
    outputContentId: string;
    executorReceiptContentId: string;
    executorReceipt: OwnedMediaStudyExecutorReceiptV2;
    projection: {
      reports: import("../model.ts").AdmittedStudyReportV2[];
      coverage: OwnedMediaStudyCoverageRangeV2[];
      claims: OwnedMediaStudyClaimV2[];
      evidenceCitations: EvidenceCitationEnvelope[];
    };
  };
}

export interface GeneralizedStudyReadinessAuditedEvent extends RuntimeEventBase {
  type: "study.generalized_readiness_audited";
  data: {
    studyId: string;
    outputArtifactId: string;
    receiptContentId: string;
    receipt: StudyReadinessReceiptV3;
    study: {
      study: import("../model.ts").OwnedMediaStudyV2Identity;
      executorReceiptId: string;
      executorReceiptContentId: string;
    };
  };
}
