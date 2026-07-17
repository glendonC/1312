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
  RangePassRequestReceipt,
  RangePassTerminalReceipt,
  SpawnRejection,
  OwnedMediaStudyExecutorReceiptV3,
  OwnedMediaStudyCoverageRangeV3,
  RangePassRecord,
  StudyReadinessReceiptV4,
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

export interface StudyRestudyPassRequestedEvent extends RuntimeEventBase {
  type: "study.restudy_pass_requested";
  data: { receiptContentId: string; receipt: RangePassRequestReceipt };
}

export interface StudyRestudyPassDecidedEvent extends RuntimeEventBase {
  type: "study.restudy_pass_decided";
  data: {
    passId: string;
    spawnRequestId: string;
    accepted: boolean;
    rejection: SpawnRejection | null;
    taskId: string | null;
    agentId: string | null;
  };
}

export interface StudyRestudyPassTerminalRecordedEvent extends RuntimeEventBase {
  type: "study.restudy_pass_terminal_recorded";
  data: { receiptContentId: string; receipt: RangePassTerminalReceipt };
}

export interface RestudiedOwnedMediaStudyCompletedEvent extends RuntimeEventBase {
  type: "study.restudied_synthesis_completed";
  data: {
    studyId: string;
    outputArtifactId: string;
    outputContentId: string;
    executorReceiptContentId: string;
    executorReceipt: OwnedMediaStudyExecutorReceiptV3;
    projection: {
      reports: import("../model.ts").AdmittedStudyReportV2[];
      passes: RangePassRecord[];
      coverage: OwnedMediaStudyCoverageRangeV3[];
      claims: OwnedMediaStudyClaimV2[];
      evidenceCitations: EvidenceCitationEnvelope[];
    };
  };
}

export interface RestudiedStudyReadinessAuditedEvent extends RuntimeEventBase {
  type: "study.restudied_readiness_audited";
  data: {
    studyId: string;
    outputArtifactId: string;
    receiptContentId: string;
    receipt: StudyReadinessReceiptV4;
    study: {
      study: import("../model.ts").OwnedMediaStudyV3Identity;
      executorReceiptId: string;
      executorReceiptContentId: string;
    };
  };
}
