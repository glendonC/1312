import { assertRuntimeArtifact } from "../assertions.ts";
import type {
  ContentIdentity,
  ExecutorSpanReceipt,
  OwnedMediaStudyArtifact,
  OwnedMediaStudyExecutorReceipt,
  RuntimeArtifact,
  StudyPlanningDecisionReceipt,
  StudyReadinessReceipt,
  StudyReportArtifact,
} from "../model.ts";
import { canonicalSha256 } from "./contentIdentity.ts";

export function buildStudyPlanningDecisionArtifact(input: {
    runId: string;
    receipt: StudyPlanningDecisionReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({ runId: input.runId, decisionId: input.receipt.decisionId, kind: "study-planning-decision", contentId: input.storedReceipt.content.contentId })}`,
      runId: input.runId,
      kind: "studio.study-planning-decision.receipt.v1",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: input.receipt.input.reports.map((report) => report.artifactId),
      producerTaskId: input.receipt.modelExecutor.taskId,
      producerAgentId: input.receipt.modelExecutor.agentId,
      origin: {
        kind: "study_planning_decision",
        decisionId: input.receipt.decisionId,
        inputId: input.receipt.input.inputId,
        executionId: input.receipt.modelExecutor.executionId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

export function buildOwnedMediaStudyArtifact(input: {
    runId: string;
    receipt: OwnedMediaStudyExecutorReceipt;
    receiptContentId: string;
    prepared: {
      artifactId: string;
      studyId: string;
      envelope: OwnedMediaStudyArtifact;
      content: ContentIdentity;
      storageKey: string;
    };
  }): RuntimeArtifact {
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: input.prepared.artifactId,
      runId: input.runId,
      kind: "studio.owned-media-study.v1",
      mediaClass: "non_media",
      publication: "private",
      content: input.prepared.content,
      storageKey: input.prepared.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: input.prepared.envelope.sourceArtifacts.map((source) => source.artifactId),
      producerTaskId: input.prepared.envelope.root.taskId,
      producerAgentId: input.prepared.envelope.root.agentId,
      origin: {
        kind: "owned_media_study",
        studyId: input.prepared.studyId,
        planningDecisionId: input.prepared.envelope.planning.decisionId,
        executionId: input.prepared.envelope.root.executionId,
        executorReceiptId: input.receipt.receiptId,
        executorReceiptContentId: input.receiptContentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

export function buildStudyReadinessArtifact(input: {
    runId: string;
    studyId: string;
    receipt: StudyReadinessReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({ runId: input.runId, readinessId: input.receipt.readinessId, kind: "study-readiness", contentId: input.storedReceipt.content.contentId })}`,
      runId: input.runId,
      kind: "studio.study-readiness.receipt.v1",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [input.receipt.input.artifactId],
      producerTaskId: null,
      producerAgentId: null,
      origin: {
        kind: "study_readiness",
        readinessId: input.receipt.readinessId,
        studyId: input.studyId,
        studyArtifactId: input.receipt.input.artifactId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
        outcome: input.receipt.result.outcome,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

export function buildStudyReportArtifact(input: {
    runId: string;
    receipt: ExecutorSpanReceipt;
    receiptContentId: string;
    prepared: {
      artifactId: string;
      envelope: StudyReportArtifact;
      content: ContentIdentity;
      storageKey: string;
    };
  }): RuntimeArtifact {
    const { envelope } = input.prepared;
    if (
      envelope.runId !== input.runId ||
      envelope.task.taskId !== input.receipt.taskId ||
      envelope.task.agentId !== input.receipt.agentId ||
      !input.receipt.outputArtifactIds.includes(input.prepared.artifactId)
    ) throw new Error("Study report does not match its executor receipt");
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: input.prepared.artifactId,
      runId: input.runId,
      kind: "studio.study-report.v1",
      mediaClass: "non_media",
      publication: "private",
      content: input.prepared.content,
      storageKey: input.prepared.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: envelope.sourceArtifacts.map((source) => source.artifactId),
      producerTaskId: envelope.task.taskId,
      producerAgentId: envelope.task.agentId,
      origin: {
        kind: "study_report",
        executionId: input.receipt.executionId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.receiptContentId,
        jobContextId: envelope.task.jobContextId,
        outputSlotName: envelope.outputSlot.name,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }
