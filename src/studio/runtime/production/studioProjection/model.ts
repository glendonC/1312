import type {
  ProductionStudioOperationView,
  ProductionStudioOrchestratorDecisionView,
  ProductionStudioGrantView,
  ProductionStudioReportView,
  ProductionStudioReportsWaitView,
  ProductionStudioRootOutputDispositionView,
  ProductionStudioSpawnView,
  ProductionStudioTaskLaunchView,
  ProductionStudioTaskView,
  ProductionStudioWorkerView,
} from "./executionViews.ts";
import type {
  ProductionStudioEvidenceArtifactView,
  ProductionStudioEvidenceAssessmentArtifactView,
  ProductionStudioEvidenceAssessmentView,
  ProductionStudioEvidenceDecisionArtifactView,
  ProductionStudioEvidenceDecisionView,
  ProductionStudioEvidenceReadView,
  ProductionStudioSemanticEvidenceView,
} from "./evidenceViews.ts";
import type {
  ProductionStudioCaptionArtifactView,
  ProductionStudioCaptionProductionView,
  ProductionStudioCaptionQualityControlView,
  ProductionStudioPublishReviewDecisionArtifactView,
  ProductionStudioPublishReviewDecisionView,
  ProductionStudioPublishReviewIntakeArtifactView,
  ProductionStudioPublishReviewIntakeView,
  ProductionStudioPublishReviewRevocationArtifactView,
  ProductionStudioPublishReviewRevocationView,
} from "./reviewViews.ts";
import type {
  ProductionStudioOwnedMediaStudyView,
  ProductionStudioStudyFollowUpView,
  ProductionStudioStudyPlanningDecisionView,
  ProductionStudioStudyReadinessView,
  ProductionStudioStudyReportStateView,
  ProductionStudioStudyReportView,
} from "./studyViews.ts";
import type {
  ProductionStudioOutputArtifactView,
  ProductionStudioSourceArtifactView,
} from "./artifactViews.ts";

export * from "./executionViews.ts";
export * from "./evidenceViews.ts";
export * from "./reviewViews.ts";
export * from "./studyViews.ts";
export * from "./artifactViews.ts";

export interface ProductionStudioProjection {
  schema: "studio.production-projection.v1";
  source: {
    kind: "production_runtime_journal";
    recordedDemo: false;
  };
  runId: string;
  lastSeq: number;
  tasks: ProductionStudioTaskView[];
  workers: ProductionStudioWorkerView[];
  grants: ProductionStudioGrantView[];
  reports: ProductionStudioReportView[];
  studyReports: ProductionStudioStudyReportView[];
  studyReportStates: ProductionStudioStudyReportStateView[];
  spawnRequests: ProductionStudioSpawnView[];
  taskLaunches: ProductionStudioTaskLaunchView[];
  reportWaits: ProductionStudioReportsWaitView[];
  orchestratorDecisions: ProductionStudioOrchestratorDecisionView[];
  rootOutputDispositions: ProductionStudioRootOutputDispositionView[];
  operations: ProductionStudioOperationView[];
  /** Present on real production projections; optional only for older typed UI fixtures. */
  semanticEvidence?: ProductionStudioSemanticEvidenceView[];
  evidenceReads: ProductionStudioEvidenceReadView[];
  evidenceAssessments: ProductionStudioEvidenceAssessmentView[];
  evidenceDecisions: ProductionStudioEvidenceDecisionView[];
  studyPlanningDecisions: ProductionStudioStudyPlanningDecisionView[];
  studyFollowUps: ProductionStudioStudyFollowUpView[];
  ownedMediaStudies: ProductionStudioOwnedMediaStudyView[];
  studyReadiness: ProductionStudioStudyReadinessView[];
  publishReviewIntakes: ProductionStudioPublishReviewIntakeView[];
  publishReviewDecisions: ProductionStudioPublishReviewDecisionView[];
  publishReviewRevocations: ProductionStudioPublishReviewRevocationView[];
  captionProductions: ProductionStudioCaptionProductionView[];
  captionQualityControls: ProductionStudioCaptionQualityControlView[];
  sourceArtifacts: ProductionStudioSourceArtifactView[];
  evidenceArtifacts: ProductionStudioEvidenceArtifactView[];
  assessmentArtifacts: ProductionStudioEvidenceAssessmentArtifactView[];
  decisionArtifacts: ProductionStudioEvidenceDecisionArtifactView[];
  publishReviewIntakeArtifacts: ProductionStudioPublishReviewIntakeArtifactView[];
  publishReviewDecisionArtifacts: ProductionStudioPublishReviewDecisionArtifactView[];
  publishReviewRevocationArtifacts: ProductionStudioPublishReviewRevocationArtifactView[];
  captionArtifacts: ProductionStudioCaptionArtifactView[];
  outputArtifacts: ProductionStudioOutputArtifactView[];
  counts: {
    tasks: number;
    workers: number;
    grants: number;
    executions: number;
    reports: number;
    studyReports: number;
    studyReportStates: number;
    spawnRequests: number;
    taskLaunches: number;
    reportWaits: number;
    orchestratorDecisions: number;
    rootOutputDispositions: number;
    operations: number;
    semanticEvidence?: number;
    evidenceReads: number;
    evidenceAssessments: number;
    evidenceDecisions: number;
    studyPlanningDecisions: number;
    studyFollowUps: number;
    ownedMediaStudies: number;
    studyReadiness: number;
    publishReviewIntakes: number;
    publishReviewDecisions: number;
    publishReviewRevocations: number;
    captionProductions: number;
    captionQualityControls: number;
    sourceArtifacts: number;
    evidenceArtifacts: number;
    assessmentArtifacts: number;
    decisionArtifacts: number;
    publishReviewIntakeArtifacts: number;
    publishReviewDecisionArtifacts: number;
    publishReviewRevocationArtifacts: number;
    captionArtifacts: number;
    outputArtifacts: number;
  };
}
