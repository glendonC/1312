import type {
  CapabilityGrant,
  MediaScope,
  WorkerKind,
} from "./tasks.ts";
import type { StudyReportSubmissionBinding } from "./studyReports.ts";
import type { StudyReportSubmissionBindingV2 } from "./studyReportsV2.ts";

export interface ReportRecord {
  id: string;
  taskId: string;
  agentId: string;
  parentTaskId: string;
  parentAgentId: string;
  outputArtifactIds: string[];
  summary: string;
  /** Null for the legacy structural-output path; version-selected for typed study reports. */
  study: StudyReportSubmissionBinding | StudyReportSubmissionBindingV2 | null;
  status: "submitted" | "accepted" | "rejected";
  decisionReason: string | null;
}

export interface ReportSubmitRequest {
  taskId: string;
  agentId: string;
  outputArtifactIds: string[];
  summary: string;
}

export interface ReportDecisionRequest {
  reportId: string;
  decidedByTaskId: string;
  decidedByAgentId: string;
  accepted: boolean;
  reason: string;
}

export interface RootOutputDispositionRequest {
  reportId: string;
  rootTaskId: string;
  rootAgentId: string;
  outputArtifactId: string;
  outcome: "promoted_to_root" | "rejected_by_root";
  reason: string;
}

export interface RootOutputDispositionReceipt {
  schema: "studio.root-output-disposition.receipt.v1";
  receiptId: string;
  dispositionId: string;
  delegation: {
    spawnRequestId: string;
    requestedByTaskId: string;
    requestedByAgentId: string;
    childTaskId: string;
    childAgentId: string;
    workerKind: WorkerKind;
    mediaScope: MediaScope[];
    grants: CapabilityGrant[];
  };
  report: {
    reportId: string;
    decisionReason: string;
  };
  input: {
    artifactId: string;
    contentId: string;
    kind: string;
    producerTaskId: string;
    producerAgentId: string;
    executionId: string;
    executorReceiptId: string;
    executorReceiptContentId: string;
  };
  authority: {
    rootTaskId: string;
    rootAgentId: string;
  };
  producer: {
    id: "studio.root-output-disposition";
    version: "1";
    policy: "accepted_or_rejected_child_report_exact_output_only";
  };
  decision: {
    outcome: "promoted_to_root" | "rejected_by_root";
    reason: string;
  };
}

export interface RootOutputDispositionRecord {
  id: string;
  reportId: string;
  spawnRequestId: string;
  rootTaskId: string;
  rootAgentId: string;
  childTaskId: string;
  childAgentId: string;
  inputArtifactId: string;
  outputArtifactId: string;
  outcome: "promoted_to_root" | "rejected_by_root";
  receiptId: string;
  receiptContentId: string;
}
