import type {
  FrameSamplingCompletedEvent,
  FrameSamplingFailedEvent,
  FrameSamplingStartedEvent,
} from "./protocol/frameEvents.ts";
import type { OcrCompletedEvent, OcrFailedEvent, OcrStartedEvent } from "./protocol/ocrEvents.ts";
import type { VisualTransitionCompletedEvent, VisualTransitionFailedEvent, VisualTransitionStartedEvent } from "./protocol/visualTransitionEvents.ts";
import type { SpeakerOverlapCompletedEvent, SpeakerOverlapFailedEvent, SpeakerOverlapStartedEvent } from "./protocol/speakerEvents.ts";
import type { ConditionalSeparationCompletedEvent, ConditionalSeparationFailedEvent, ConditionalSeparationStartedEvent } from "./protocol/separationEvents.ts";
import type { ResearchExhaustionRecordedEvent, ResearchOperationCompletedEvent, ResearchOperationFailedEvent, ResearchOperationStartedEvent, ResearchRequestInputRecordedEvent } from "./protocol/researchEvents.ts";
import type { ComputerUseOperationCompletedEvent, ComputerUseOperationFailedEvent, ComputerUseOperationStartedEvent } from "./protocol/computerUseEvents.ts";
import type {
  AgentRegisteredEvent,
  ArtifactRecordedEvent,
  ExecutorFinishedEvent,
  ExecutorStartedEvent,
  MediaOperationCompletedEvent,
  MediaOperationFailedEvent,
  MediaOperationStartedEvent,
  ModelUsageRecordedEvent,
  OrchestratorDecisionRecordedEvent,
  OrchestratorToolCalledEvent,
  ReportDecidedEvent,
  ReportsWaitReturnedEvent,
  ReportsWaitStartedEvent,
  ReportSubmittedEvent,
  RuntimeInterruptedEvent,
  SpawnDecidedEvent,
  SpawnRequestedEvent,
  TaskCreatedEvent,
  TaskLaunchClaimedEvent,
  TaskTransitionedEvent,
} from "./protocol/executionEvents.ts";
import type {
  EvidenceAssessmentCompletedEvent,
  EvidenceAssessmentFailedEvent,
  EvidenceAssessmentStartedEvent,
  EvidenceDecisionCompletedEvent,
  EvidenceDecisionFailedEvent,
  EvidenceDecisionStartedEvent,
  EvidenceReadCompletedEvent,
  EvidenceReadFailedEvent,
  EvidenceReadStartedEvent,
  SemanticEvidenceCompletedEvent,
  SemanticEvidenceFailedEvent,
  SemanticEvidenceStartedEvent,
} from "./protocol/evidenceEvents.ts";
import type {
  CaptionProductionCompletedEvent,
  CaptionProductionFailedEvent,
  CaptionProductionStartedEvent,
  CaptionQualityControlDecidedEvent,
  ParentArtifactDispositionRecordedEvent,
  ParentArtifactReadCompletedEvent,
  ParentArtifactReadFailedEvent,
  ParentArtifactReadStartedEvent,
  PublishReviewDecisionCompletedEvent,
  PublishReviewDecisionFailedEvent,
  PublishReviewDecisionStartedEvent,
  PublishReviewIntakeCompletedEvent,
  PublishReviewIntakeFailedEvent,
  PublishReviewIntakeStartedEvent,
  PublishReviewRevocationCompletedEvent,
  PublishReviewRevocationFailedEvent,
  PublishReviewRevocationStartedEvent,
  RootOutputDispositionRecordedEvent,
} from "./protocol/reviewEvents.ts";
import type {
  OwnedMediaStudyCompletedEvent,
  StudyFollowUpLinkedEvent,
  StudyPlanningDecisionRecordedEvent,
  StudyReadinessAuditedEvent,
  GeneralizedParentAdmissionRecordedEvent,
  GeneralizedParentArtifactReadCompletedEvent,
  GeneralizedOwnedMediaStudyCompletedEvent,
  GeneralizedStudyReadinessAuditedEvent,
  StudyRestudyPassRequestedEvent,
  StudyRestudyPassDecidedEvent,
  StudyRestudyPassTerminalRecordedEvent,
  RestudiedOwnedMediaStudyCompletedEvent,
  RestudiedStudyReadinessAuditedEvent,
} from "./protocol/studyEvents.ts";
import type {
  LanguageExplanationCompletedEvent,
  LanguageExplanationFailedEvent,
  LanguageExplanationStartedEvent,
} from "./protocol/languageExplanationEvents.ts";
import type {
  LearningPrepCompletedEvent,
  LearningPrepFailedEvent,
  LearningPrepStartedEvent,
} from "./protocol/learningPrepEvents.ts";
import type {
  AgentRecoveryAuthorizedEvent,
  AgentRecoveryTerminalRecordedEvent,
  ExecutorFailureClassifiedEvent,
} from "./protocol/agentRecoveryEvents.ts";

export * from "./protocol/base.ts";
export * from "./protocol/executionEvents.ts";
export * from "./protocol/evidenceEvents.ts";
export * from "./protocol/frameEvents.ts";
export * from "./protocol/ocrEvents.ts";
export * from "./protocol/visualTransitionEvents.ts";
export * from "./protocol/speakerEvents.ts";
export * from "./protocol/separationEvents.ts";
export * from "./protocol/researchEvents.ts";
export * from "./protocol/computerUseEvents.ts";
export * from "./protocol/reviewEvents.ts";
export * from "./protocol/studyEvents.ts";
export * from "./protocol/languageExplanationEvents.ts";
export * from "./protocol/learningPrepEvents.ts";
export * from "./protocol/agentRecoveryEvents.ts";

export type RuntimeEvent =
  | ArtifactRecordedEvent
  | TaskCreatedEvent
  | SpawnRequestedEvent
  | SpawnDecidedEvent
  | TaskLaunchClaimedEvent
  | AgentRegisteredEvent
  | OrchestratorToolCalledEvent
  | ReportsWaitStartedEvent
  | ReportsWaitReturnedEvent
  | OrchestratorDecisionRecordedEvent
  | RuntimeInterruptedEvent
  | TaskTransitionedEvent
  | ExecutorStartedEvent
  | ModelUsageRecordedEvent
  | ExecutorFinishedEvent
  | MediaOperationStartedEvent
  | MediaOperationCompletedEvent
  | MediaOperationFailedEvent
  | FrameSamplingStartedEvent
  | FrameSamplingCompletedEvent
  | FrameSamplingFailedEvent
  | OcrStartedEvent
  | OcrCompletedEvent
  | OcrFailedEvent
  | VisualTransitionStartedEvent
  | VisualTransitionCompletedEvent
  | VisualTransitionFailedEvent
  | SpeakerOverlapStartedEvent
  | SpeakerOverlapCompletedEvent
  | SpeakerOverlapFailedEvent
  | ConditionalSeparationStartedEvent
  | ConditionalSeparationCompletedEvent
  | ConditionalSeparationFailedEvent
  | ResearchOperationStartedEvent
  | ResearchOperationCompletedEvent
  | ResearchOperationFailedEvent
  | ResearchExhaustionRecordedEvent
  | ResearchRequestInputRecordedEvent
  | ComputerUseOperationStartedEvent
  | ComputerUseOperationCompletedEvent
  | ComputerUseOperationFailedEvent
  | SemanticEvidenceStartedEvent
  | SemanticEvidenceCompletedEvent
  | SemanticEvidenceFailedEvent
  | EvidenceReadStartedEvent
  | EvidenceReadCompletedEvent
  | EvidenceReadFailedEvent
  | EvidenceAssessmentStartedEvent
  | EvidenceAssessmentCompletedEvent
  | EvidenceAssessmentFailedEvent
  | EvidenceDecisionStartedEvent
  | EvidenceDecisionCompletedEvent
  | EvidenceDecisionFailedEvent
  | PublishReviewIntakeStartedEvent
  | PublishReviewIntakeCompletedEvent
  | PublishReviewIntakeFailedEvent
  | PublishReviewDecisionStartedEvent
  | PublishReviewDecisionCompletedEvent
  | PublishReviewDecisionFailedEvent
  | PublishReviewRevocationStartedEvent
  | PublishReviewRevocationCompletedEvent
  | PublishReviewRevocationFailedEvent
  | CaptionProductionStartedEvent
  | CaptionProductionCompletedEvent
  | CaptionProductionFailedEvent
  | CaptionQualityControlDecidedEvent
  | LanguageExplanationStartedEvent
  | LanguageExplanationCompletedEvent
  | LanguageExplanationFailedEvent
  | LearningPrepStartedEvent
  | LearningPrepCompletedEvent
  | LearningPrepFailedEvent
  | ReportSubmittedEvent
  | ReportDecidedEvent
  | RootOutputDispositionRecordedEvent
  | ParentArtifactDispositionRecordedEvent
  | ParentArtifactReadStartedEvent
  | ParentArtifactReadCompletedEvent
  | ParentArtifactReadFailedEvent
  | StudyPlanningDecisionRecordedEvent
  | StudyFollowUpLinkedEvent
  | OwnedMediaStudyCompletedEvent
  | StudyReadinessAuditedEvent
  | GeneralizedParentAdmissionRecordedEvent
  | GeneralizedParentArtifactReadCompletedEvent
  | GeneralizedOwnedMediaStudyCompletedEvent
  | GeneralizedStudyReadinessAuditedEvent
  | StudyRestudyPassRequestedEvent
  | StudyRestudyPassDecidedEvent
  | StudyRestudyPassTerminalRecordedEvent
  | RestudiedOwnedMediaStudyCompletedEvent
  | RestudiedStudyReadinessAuditedEvent
  | ExecutorFailureClassifiedEvent
  | AgentRecoveryAuthorizedEvent
  | AgentRecoveryTerminalRecordedEvent;

export type PendingRuntimeEvent = RuntimeEvent extends infer Event
  ? Event extends RuntimeEvent
    ? Pick<Event, "type" | "data">
    : never
  : never;
