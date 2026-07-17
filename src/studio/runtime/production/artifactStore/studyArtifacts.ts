import { assertRuntimeArtifact } from "../assertions.ts";
import type {
  ContentIdentity,
  ExecutorSpanReceipt,
  OwnedMediaStudyArtifact,
  OwnedMediaStudyExecutorReceipt,
  OwnedMediaStudyArtifactV2,
  OwnedMediaStudyExecutorReceiptV2,
  ParentArtifactAdmissionReceiptV2,
  ParentArtifactReadReceiptV2,
  RuntimeArtifact,
  StudyPlanningDecisionReceipt,
  StudyReadinessReceipt,
  StudyReadinessReceiptV3,
  StudyReportArtifact,
  StudyReportArtifactV2,
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
      kind: input.receipt.schema,
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
      envelope: StudyReportArtifact | StudyReportArtifactV2;
      outputSlotName?: string;
      content: ContentIdentity;
      storageKey: string;
    };
  }): RuntimeArtifact {
    const { envelope } = input.prepared;
    if (
      envelope.runId !== input.runId ||
      envelope.task.taskId !== input.receipt.taskId ||
      envelope.task.agentId !== input.receipt.agentId ||
      !input.receipt.outputArtifactIds.includes(input.prepared.artifactId) ||
      (envelope.schema === "studio.study-report.v2" && envelope.task.executionId !== input.receipt.executionId)
    ) throw new Error("Study report does not match its executor receipt");
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: input.prepared.artifactId,
      runId: input.runId,
      kind: envelope.schema,
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
        outputSlotName: envelope.schema === "studio.study-report.v1"
          ? envelope.outputSlot.name
          : input.prepared.outputSlotName ?? (() => { throw new Error("Study report v2 lost its immutable output slot"); })(),
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
}

export function buildGeneralizedParentAdmissionArtifact(input: {
  runId: string;
  reportId: string;
  parentTaskId: string;
  parentAgentId: string;
  receipt: ParentArtifactAdmissionReceiptV2;
  storedReceipt: { content: ContentIdentity; storageKey: string };
}): RuntimeArtifact {
  const artifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: `artifact:${canonicalSha256({ runId: input.runId, admissionId: input.receipt.admissionId, kind: input.receipt.schema, contentId: input.storedReceipt.content.contentId })}`,
    runId: input.runId,
    kind: input.receipt.schema,
    mediaClass: "non_media",
    publication: "private",
    content: input.storedReceipt.content,
    storageKey: input.storedReceipt.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: [input.receipt.report.artifactId],
    producerTaskId: input.parentTaskId,
    producerAgentId: input.parentAgentId,
    origin: {
      kind: "generalized_parent_admission",
      admissionId: input.receipt.admissionId,
      reportId: input.reportId,
      reportArtifactId: input.receipt.report.artifactId,
      receiptId: input.receipt.receiptId,
      receiptContentId: input.storedReceipt.content.contentId,
    },
  };
  assertRuntimeArtifact(artifact);
  return artifact;
}

export function buildGeneralizedParentReadArtifact(input: {
  runId: string;
  parentTaskId: string;
  parentAgentId: string;
  receipt: ParentArtifactReadReceiptV2;
  storedReceipt: { content: ContentIdentity; storageKey: string };
}): RuntimeArtifact {
  const artifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: `artifact:${canonicalSha256({ runId: input.runId, operationId: input.receipt.operationId, kind: input.receipt.schema, contentId: input.storedReceipt.content.contentId })}`,
    runId: input.runId,
    kind: input.receipt.schema,
    mediaClass: "non_media",
    publication: "private",
    content: input.storedReceipt.content,
    storageKey: input.storedReceipt.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: [input.receipt.returned.artifactId],
    producerTaskId: input.parentTaskId,
    producerAgentId: input.parentAgentId,
    origin: {
      kind: "generalized_parent_artifact_read",
      operationId: input.receipt.operationId,
      admissionId: input.receipt.admission.admissionId,
      reportArtifactId: input.receipt.returned.artifactId,
      receiptId: input.receipt.receiptId,
      receiptContentId: input.storedReceipt.content.contentId,
    },
  };
  assertRuntimeArtifact(artifact);
  return artifact;
}

export function buildOwnedMediaStudyArtifactV2(input: {
  runId: string;
  envelope: OwnedMediaStudyArtifactV2;
  receipt: OwnedMediaStudyExecutorReceiptV2;
  receiptContentId: string;
  storedStudy: { content: ContentIdentity; storageKey: string };
}): RuntimeArtifact {
  const artifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: input.receipt.output.artifactId,
    runId: input.runId,
    kind: input.envelope.schema,
    mediaClass: "non_media",
    publication: "private",
    content: input.storedStudy.content,
    storageKey: input.storedStudy.storageKey,
    durationMs: null,
    tracks: [],
    sourceArtifactIds: input.envelope.sourceArtifacts.map((source) => source.artifactId),
    producerTaskId: input.envelope.root.taskId,
    producerAgentId: input.envelope.root.agentId,
    origin: {
      kind: "generalized_owned_media_study",
      studyId: input.receipt.output.studyId,
      executionId: input.envelope.root.executionId,
      executorReceiptId: input.receipt.receiptId,
      executorReceiptContentId: input.receiptContentId,
    },
  };
  assertRuntimeArtifact(artifact);
  return artifact;
}

export function buildStudyReadinessArtifactV3(input: {
  runId: string;
  receipt: StudyReadinessReceiptV3;
  storedReceipt: { content: ContentIdentity; storageKey: string };
}): RuntimeArtifact {
  const artifact: RuntimeArtifact = {
    schema: "studio.runtime.artifact.v1",
    id: `artifact:${canonicalSha256({ runId: input.runId, readinessId: input.receipt.readinessId, kind: input.receipt.schema, contentId: input.storedReceipt.content.contentId })}`,
    runId: input.runId,
    kind: input.receipt.schema,
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
      kind: "generalized_study_readiness",
      readinessId: input.receipt.readinessId,
      studyId: input.receipt.input.studyId,
      studyArtifactId: input.receipt.input.artifactId,
      receiptId: input.receipt.receiptId,
      receiptContentId: input.storedReceipt.content.contentId,
      outcome: input.receipt.result.outcome,
    },
  };
  assertRuntimeArtifact(artifact);
  return artifact;
}
