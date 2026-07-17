import type { RuntimeArtifact } from "./artifacts.ts";
import type {
  CaptionProductionRecord,
  CaptionQualityControlRecord,
} from "./captions.ts";
import type {
  EvidenceAssessmentRecord,
  EvidenceDecisionRecord,
  EvidenceReadRecord,
} from "./evidence.ts";
import type {
  ExecutorRecord,
  ModelUsageReceipt,
} from "./execution.ts";
import type { OperationRecord } from "./media.ts";
import type { FrameSampleRecord } from "./frames.ts";
import type { SemanticEvidenceRecord } from "./semanticEvidence.ts";
import type {
  ReportRecord,
  RootOutputDispositionRecord,
} from "./reports.ts";
import type {
  ParentArtifactDispositionRecord,
  ParentArtifactReadGrant,
  ParentArtifactReadRecord,
} from "./studyReports.ts";
import type {
  PublishReviewDecisionRecord,
  PublishReviewIntakeRecord,
  PublishReviewRevocationRecord,
} from "./review.ts";
import type {
  AgentRecord,
  OrchestratorDecisionRecord,
  OrchestratorToolCallRecord,
  ReportsWaitRecord,
  SpawnRequestRecord,
  TaskLaunchRecord,
  TaskRecord,
} from "./tasks.ts";
import type {
  OwnedMediaStudyRecord,
  StudyFollowUpRecord,
  StudyPlanningDecisionRecord,
  StudyReadinessRecord,
} from "./studies.ts";

export interface RuntimeProjection {
  runId: string;
  lastSeq: number;
  tasks: Record<string, TaskRecord>;
  agents: Record<string, AgentRecord>;
  artifacts: Record<string, RuntimeArtifact>;
  spawnRequests: Record<string, SpawnRequestRecord>;
  taskLaunches: Record<string, TaskLaunchRecord>;
  orchestratorToolCalls: Record<string, OrchestratorToolCallRecord>;
  reportWaits: Record<string, ReportsWaitRecord>;
  orchestratorDecisions: Record<string, OrchestratorDecisionRecord>;
  operations: Record<string, OperationRecord>;
  frameSamples: Record<string, FrameSampleRecord>;
  semanticEvidence: Record<string, SemanticEvidenceRecord>;
  evidenceReads: Record<string, EvidenceReadRecord>;
  evidenceAssessments: Record<string, EvidenceAssessmentRecord>;
  evidenceDecisions: Record<string, EvidenceDecisionRecord>;
  publishReviewIntakes: Record<string, PublishReviewIntakeRecord>;
  publishReviewDecisions: Record<string, PublishReviewDecisionRecord>;
  publishReviewRevocations: Record<string, PublishReviewRevocationRecord>;
  captionProductions: Record<string, CaptionProductionRecord>;
  captionQualityControls: Record<string, CaptionQualityControlRecord>;
  executions: Record<string, ExecutorRecord>;
  modelUsage: Record<string, ModelUsageReceipt>;
  reports: Record<string, ReportRecord>;
  rootOutputDispositions: Record<string, RootOutputDispositionRecord>;
  parentArtifactDispositions: Record<string, ParentArtifactDispositionRecord>;
  parentArtifactReadGrants: Record<string, ParentArtifactReadGrant>;
  parentArtifactReads: Record<string, ParentArtifactReadRecord>;
  studyPlanningDecisions: Record<string, StudyPlanningDecisionRecord>;
  studyFollowUps: Record<string, StudyFollowUpRecord>;
  ownedMediaStudies: Record<string, OwnedMediaStudyRecord>;
  studyReadiness: Record<string, StudyReadinessRecord>;
}
