import type {
  OwnedMediaStudyConflict,
  OwnedMediaStudyCoverageRange,
  SpawnRejection,
  StudyPlanningConflictIdentity,
  StudyPlanningCoverageIdentity,
  StudyPlanningGapIdentity,
  StudyPlanningOutcome,
  StudyPlanningReportInput,
  StudyReadinessOutcome,
  StudyReadinessReasonCode,
} from "../model.ts";

export interface ProductionStudioStudyReportView {
  reportId: string;
  artifactId: string;
  contentId: string;
  jobContextId: string;
  outputSlot: { name: string; artifactKind: "studio.study-report.v1" };
  coverage: import("../model.ts").StudyCoverageRange[];
  counts: import("../model.ts").StudyReportCounts;
  claims: import("../model.ts").StudyClaim[];
  sourceArtifacts: Array<{ artifactId: string; contentId: string }>;
  reportStatus: "submitted" | "accepted" | "rejected";
  disposition: {
    state: "absent" | "accepted" | "rejected";
    dispositionId: string | null;
    receiptId: string | null;
    receiptContentId: string | null;
  };
  admission: {
    state: "absent" | "admitted";
    admissionId: string | null;
    receiptId: string | null;
    receiptContentId: string | null;
    grant: import("../model.ts").ParentArtifactReadGrant | null;
  };
  reads: Array<{
    operationId: string;
    status: "started" | "completed" | "failed";
    returnedBytes: number | null;
    returnedItems: number | null;
    receiptId: string | null;
    failure: string | null;
  }>;
  audit: "not_checked" | "verified_on_reopen" | "absent_or_invalid";
}

export interface ProductionStudioStudyReportStateView {
  taskId: string;
  agentId: string;
  parentTaskId: string | null;
  parentAgentId: string | null;
  outputSlot: { name: string; artifactKind: "studio.study-report.v1" };
  state: "absent" | "submitted" | "accepted" | "rejected" | "failed" | "withheld" | "interrupted";
  reportId: string | null;
  artifactId: string | null;
  reason: string | null;
}

export interface ProductionStudioStudyPlanningDecisionView {
  decisionId: string;
  inputId: string;
  rootTaskId: string;
  rootAgentId: string;
  executionId: string;
  artifactId: string;
  receiptId: string;
  receiptContentId: string;
  outcome: StudyPlanningOutcome;
  reason: string;
  reports: StudyPlanningReportInput[];
  coverage: StudyPlanningCoverageIdentity[];
  gaps: StudyPlanningGapIdentity[];
  conflicts: StudyPlanningConflictIdentity[];
  citedGapIds: string[];
  citedConflictIds: string[];
}

export interface ProductionStudioStudyFollowUpView {
  followUpId: string;
  planningDecisionId: string;
  cause: { kind: "gap" | "conflict"; id: string };
  spawnRequestId: string;
  accepted: boolean;
  rejection: SpawnRejection | null;
  taskId: string | null;
  agentId: string | null;
}

export interface ProductionStudioOwnedMediaStudyView {
  studyId: string;
  planningDecisionId: string;
  rootTaskId: string;
  rootAgentId: string;
  executionId: string;
  artifactId: string;
  contentId: string;
  executorReceiptId: string;
  executorReceiptContentId: string;
  coverage: OwnedMediaStudyCoverageRange[];
  conflicts: OwnedMediaStudyConflict[];
}

export interface ProductionStudioStudyReadinessView {
  readinessId: string;
  studyId: string;
  studyArtifactId: string;
  studyContentId: string;
  artifactId: string;
  receiptId: string;
  receiptContentId: string;
  outcome: StudyReadinessOutcome;
  reasonCodes: StudyReadinessReasonCode[];
}
