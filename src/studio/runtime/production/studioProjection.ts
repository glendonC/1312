import { assertRuntimeEvent } from "./assertions.ts";
import type {
  Capability,
  EvidenceAssessmentScope,
  EvidenceKind,
  EvidenceReadScope,
  MediaScope,
  RequiredOutput,
  RuntimeProjection,
  SpawnRejection,
  TaskStatus,
  WorkerKind,
} from "./model.ts";
import type { RuntimeEvent } from "./protocol.ts";
import { applyRuntimeEvent, initialRuntimeProjection } from "./projection.ts";

export interface ProductionStudioTaskView {
  taskId: string;
  workloadKey: string;
  objective: string;
  kind: WorkerKind;
  label: string;
  parentTaskId: string | null;
  parentAgentId: string | null;
  depth: number;
  assignedAgentId: string;
  ownerAgentId: string | null;
  status: TaskStatus;
  mediaScope: MediaScope[];
  inputArtifactIds: string[];
  requiredOutputs: RequiredOutput[];
  dependencies: string[];
}

export interface ProductionStudioWorkerView {
  agentId: string;
  taskId: string;
  label: string;
  kind: WorkerKind;
  status: "registered" | "working" | "reporting" | "retired";
  taskStatus: "scheduled" | "working" | "reported" | "completed" | "failed" | "withheld";
  objective: string;
  parentAgentId: string | null;
  parentTaskId: string | null;
  depth: number;
  capabilities: string[];
  mediaScope: MediaScope[];
  execution: null | {
    id: string;
    status: "active" | "completed" | "failed" | "timed_out";
    activeDurationMs: number | null;
    usage: null | {
      model: string | null;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      reasoningOutputTokens: number;
      billedAmount: null;
    };
  };
  report: null | {
    id: string;
    status: "submitted" | "accepted" | "rejected";
    summary: string;
  };
}

export interface ProductionStudioGrantView {
  grantId: string;
  taskId: string;
  agentId: string;
  capability: Capability;
  mediaScope: MediaScope[];
  evidenceScope: EvidenceReadScope[];
  assessmentScope: EvidenceAssessmentScope | null;
}

export interface ProductionStudioEvidenceArtifactView {
  artifactId: string;
  kind: string;
  evidenceKind: EvidenceKind;
  receiptSchema: "studio.speech-activity.v1" | "studio.language-ranges.v1";
  producerId: "silero-vad" | "whisper-language-id";
  contentId: string;
  bytes: number;
  sourceArtifactIds: string[];
  preflightId: string;
  preflightContentId: string;
}

export interface ProductionStudioEvidenceReadView {
  operationId: string;
  capability: "evidence.read";
  status: "started" | "completed" | "failed";
  taskId: string;
  agentId: string;
  grantId: string;
  inputArtifactId: string;
  evidenceKind: EvidenceKind;
  maxBytes: number;
  maxItems: number;
  receiptId: string | null;
  receiptContentId: string | null;
  returnedItems: number | null;
  returnedFactBytes: number | null;
  truncated: boolean | null;
  failure: string | null;
}

export interface ProductionStudioEvidenceAssessmentView {
  operationId: string;
  capability: "analysis.evidence.assess";
  status: "started" | "completed" | "failed";
  taskId: string;
  agentId: string;
  grantId: string;
  readReceiptIds: string[];
  readReceiptContentIds: string[];
  maxReadReceipts: number;
  maxClaims: number;
  maxCitations: number;
  maxTokens: number;
  outputArtifactId: string | null;
  receiptId: string | null;
  receiptContentId: string | null;
  claimCount: number | null;
  citationCount: number | null;
  tokenCount: number | null;
  failure: string | null;
}

export interface ProductionStudioEvidenceAssessmentArtifactView {
  artifactId: string;
  kind: "evidence-assessment-receipt";
  contentId: string;
  bytes: number;
  producerTaskId: string;
  producerAgentId: string;
  operationId: string;
  receiptId: string;
  receiptContentId: string;
  readReceiptIds: string[];
  readReceiptContentIds: string[];
}

export interface ProductionStudioReportView {
  reportId: string;
  taskId: string;
  agentId: string;
  parentTaskId: string;
  parentAgentId: string;
  outputArtifactIds: string[];
  summary: string;
  status: "submitted" | "accepted" | "rejected";
  decisionReason: string | null;
}

export interface ProductionStudioSpawnView {
  requestId: string;
  requestedByTaskId: string;
  requestedByAgentId: string;
  workloadKey: string;
  objective: string;
  workerKind: WorkerKind;
  workerLabel: string;
  mediaScope: MediaScope[];
  inputArtifactIds: string[];
  requiredOutputs: RequiredOutput[];
  requiredCapabilities: Capability[];
  dependencies: string[];
  decision: "pending" | "accepted" | "rejected";
  rejection: SpawnRejection | null;
  taskId: string | null;
  agentId: string | null;
}

export interface ProductionStudioOperationView {
  operationId: string;
  capability: "media.extract" | "media.seek";
  status: "started" | "completed" | "failed";
  taskId: string;
  agentId: string;
  grantId: string;
  inputArtifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  requestedDurationMs: number;
  outputArtifactId: string | null;
  receiptId: string | null;
  failure: string | null;
}

export type ProductionStudioOutputArtifactOrigin =
  | {
      kind: "media_operation" | "media_observation";
      operationId: string;
      receiptId: string;
      receiptContentId: string;
    }
  | {
      kind: "worker_output";
      executionId: string;
      receiptId: string;
      receiptContentId: string;
    };

export interface ProductionStudioSourceArtifactView {
  artifactId: string;
  kind: string;
  mediaClass: "raw";
  publication: "private" | "public";
  contentId: string;
  bytes: number;
  durationMs: number | null;
  trackCount: number;
}

export interface ProductionStudioOutputArtifactView {
  artifactId: string;
  kind: string;
  mediaClass: "derived" | "non_media";
  publication: "private" | "public";
  contentId: string;
  bytes: number;
  durationMs: number | null;
  producerTaskId: string;
  producerAgentId: string;
  sourceArtifactIds: string[];
  origin: ProductionStudioOutputArtifactOrigin;
  reportIds: string[];
}

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
  spawnRequests: ProductionStudioSpawnView[];
  operations: ProductionStudioOperationView[];
  evidenceReads: ProductionStudioEvidenceReadView[];
  evidenceAssessments: ProductionStudioEvidenceAssessmentView[];
  sourceArtifacts: ProductionStudioSourceArtifactView[];
  evidenceArtifacts: ProductionStudioEvidenceArtifactView[];
  assessmentArtifacts: ProductionStudioEvidenceAssessmentArtifactView[];
  outputArtifacts: ProductionStudioOutputArtifactView[];
  counts: {
    tasks: number;
    workers: number;
    grants: number;
    executions: number;
    reports: number;
    spawnRequests: number;
    operations: number;
    evidenceReads: number;
    evidenceAssessments: number;
    sourceArtifacts: number;
    evidenceArtifacts: number;
    assessmentArtifacts: number;
    outputArtifacts: number;
  };
}

export function adaptProductionRuntime(state: RuntimeProjection): ProductionStudioProjection {
  const tasks = Object.values(state.tasks)
    .map((task): ProductionStudioTaskView => ({
      taskId: task.id,
      workloadKey: task.workloadKey,
      objective: task.objective,
      kind: task.workerKind,
      label: task.workerLabel,
      parentTaskId: task.parentTaskId,
      parentAgentId: task.parentAgentId,
      depth: task.depth,
      assignedAgentId: task.assignedAgentId,
      ownerAgentId: task.ownerAgentId,
      status: task.status,
      mediaScope: structuredClone(task.mediaScope),
      inputArtifactIds: [...task.inputArtifactIds],
      requiredOutputs: structuredClone(task.requiredOutputs),
      dependencies: [...task.dependencies],
    }))
    .sort((left, right) => left.depth - right.depth || left.taskId.localeCompare(right.taskId));

  const grants = Object.values(state.tasks)
    .flatMap((task) => task.grants.map((grant): ProductionStudioGrantView => ({
      grantId: grant.id,
      taskId: grant.taskId,
      agentId: grant.agentId,
      capability: grant.capability,
      mediaScope: structuredClone(grant.mediaScope),
      evidenceScope: structuredClone(grant.evidenceScope),
      assessmentScope: structuredClone(grant.assessmentScope),
    })))
    .sort((left, right) => left.taskId.localeCompare(right.taskId) || left.grantId.localeCompare(right.grantId));
  if (new Set(grants.map((grant) => grant.grantId)).size !== grants.length) {
    throw new Error("Production Studio projection: grant identities must be unique across tasks");
  }

  const reports = Object.values(state.reports)
    .map((report): ProductionStudioReportView => ({
      reportId: report.id,
      taskId: report.taskId,
      agentId: report.agentId,
      parentTaskId: report.parentTaskId,
      parentAgentId: report.parentAgentId,
      outputArtifactIds: [...report.outputArtifactIds],
      summary: report.summary,
      status: report.status,
      decisionReason: report.decisionReason,
    }))
    .sort((left, right) => left.reportId.localeCompare(right.reportId));

  const spawnRequests = Object.values(state.spawnRequests)
    .map((request): ProductionStudioSpawnView => ({
      requestId: request.id,
      requestedByTaskId: request.requestedByTaskId,
      requestedByAgentId: request.requestedByAgentId,
      workloadKey: request.input.workloadKey,
      objective: request.input.objective,
      workerKind: request.input.workerKind,
      workerLabel: request.input.workerLabel,
      mediaScope: structuredClone(request.input.mediaScope),
      inputArtifactIds: [...request.input.inputArtifactIds],
      requiredOutputs: structuredClone(request.input.requiredOutputs),
      requiredCapabilities: [...request.input.requiredCapabilities].sort(),
      dependencies: [...request.input.dependencies],
      decision: request.accepted === null ? "pending" : request.accepted ? "accepted" : "rejected",
      rejection: request.rejection,
      taskId: request.taskId,
      agentId: request.agentId,
    }))
    .sort((left, right) => left.requestId.localeCompare(right.requestId));

  const operations = Object.values(state.operations)
    .map((operation): ProductionStudioOperationView => ({
      operationId: operation.id,
      capability: operation.capability,
      status: operation.status,
      taskId: operation.taskId,
      agentId: operation.agentId,
      grantId: operation.grantId,
      inputArtifactId: operation.artifactId,
      trackId: operation.trackId,
      startMs: operation.startMs,
      endMs: operation.endMs,
      requestedDurationMs: operation.endMs - operation.startMs,
      outputArtifactId: operation.outputArtifactId,
      receiptId: operation.receiptId,
      failure: operation.failure,
    }))
    .sort((left, right) => left.operationId.localeCompare(right.operationId));

  const evidenceReads = Object.values(state.evidenceReads)
    .map((operation): ProductionStudioEvidenceReadView => ({
      operationId: operation.id,
      capability: "evidence.read",
      status: operation.status,
      taskId: operation.taskId,
      agentId: operation.agentId,
      grantId: operation.grantId,
      inputArtifactId: operation.artifactId,
      evidenceKind: operation.evidenceKind,
      maxBytes: operation.maxBytes,
      maxItems: operation.maxItems,
      receiptId: operation.receiptId,
      receiptContentId: operation.receiptContentId,
      returnedItems: operation.returnedItems,
      returnedFactBytes: operation.returnedFactBytes,
      truncated: operation.truncated,
      failure: operation.failure,
    }))
    .sort((left, right) => left.operationId.localeCompare(right.operationId));

  const evidenceAssessments = Object.values(state.evidenceAssessments)
    .map((operation): ProductionStudioEvidenceAssessmentView => ({
      operationId: operation.id,
      capability: "analysis.evidence.assess",
      status: operation.status,
      taskId: operation.taskId,
      agentId: operation.agentId,
      grantId: operation.grantId,
      readReceiptIds: [...operation.readReceiptIds],
      readReceiptContentIds: [...operation.readReceiptContentIds],
      maxReadReceipts: operation.maxReadReceipts,
      maxClaims: operation.maxClaims,
      maxCitations: operation.maxCitations,
      maxTokens: operation.maxTokens,
      outputArtifactId: operation.artifactId,
      receiptId: operation.receiptId,
      receiptContentId: operation.receiptContentId,
      claimCount: operation.claimCount,
      citationCount: operation.citationCount,
      tokenCount: operation.tokenCount,
      failure: operation.failure,
    }))
    .sort((left, right) => left.operationId.localeCompare(right.operationId));

  const sourceArtifacts = Object.values(state.artifacts)
    .filter((artifact) => artifact.origin.kind === "ingest")
    .map((artifact): ProductionStudioSourceArtifactView => {
      if (artifact.origin.kind !== "ingest") {
        throw new Error(`Production Studio projection: source artifact ${artifact.id} has a non-ingest origin`);
      }
      if (artifact.mediaClass !== "raw") {
        throw new Error(`Production Studio projection: source artifact ${artifact.id} is not raw media`);
      }
      if (artifact.producerTaskId !== null || artifact.producerAgentId !== null) {
        throw new Error(`Production Studio projection: source artifact ${artifact.id} claims a task producer`);
      }
      return {
        artifactId: artifact.id,
        kind: artifact.kind,
        mediaClass: artifact.mediaClass,
        publication: artifact.publication,
        contentId: artifact.content.contentId,
        bytes: artifact.content.bytes,
        durationMs: artifact.durationMs,
        trackCount: artifact.tracks.length,
      };
    })
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));

  const outputArtifacts = Object.values(state.artifacts)
    .filter((artifact) =>
      artifact.origin.kind === "media_operation" ||
      artifact.origin.kind === "media_observation" ||
      artifact.origin.kind === "worker_output")
    .map((artifact): ProductionStudioOutputArtifactView => {
      if (
        artifact.origin.kind === "ingest" ||
        artifact.origin.kind === "preflight_evidence" ||
        artifact.origin.kind === "evidence_assessment"
      ) {
        throw new Error(`Production Studio projection: output artifact ${artifact.id} has an ingest origin`);
      }
      if (artifact.producerTaskId === null || artifact.producerAgentId === null) {
        throw new Error(`Production Studio projection: output artifact ${artifact.id} has no task and worker producer`);
      }
      if (artifact.mediaClass === "raw") {
        throw new Error(`Production Studio projection: output artifact ${artifact.id} is incorrectly marked raw`);
      }
      const reportIds = reports
        .filter((report) => report.outputArtifactIds.includes(artifact.id))
        .map((report) => report.reportId);
      return {
        artifactId: artifact.id,
        kind: artifact.kind,
        mediaClass: artifact.mediaClass,
        publication: artifact.publication,
        contentId: artifact.content.contentId,
        bytes: artifact.content.bytes,
        durationMs: artifact.durationMs,
        producerTaskId: artifact.producerTaskId,
        producerAgentId: artifact.producerAgentId,
        sourceArtifactIds: [...artifact.sourceArtifactIds],
        origin: structuredClone(artifact.origin),
        reportIds,
      };
    })
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));

  const evidenceArtifacts = Object.values(state.artifacts)
    .filter((artifact) => artifact.origin.kind === "preflight_evidence")
    .map((artifact): ProductionStudioEvidenceArtifactView => {
      if (artifact.origin.kind !== "preflight_evidence") {
        throw new Error(`Production Studio projection: evidence artifact ${artifact.id} changed origin`);
      }
      if (artifact.producerTaskId !== null || artifact.producerAgentId !== null || artifact.mediaClass !== "non_media") {
        throw new Error(`Production Studio projection: evidence artifact ${artifact.id} claims a runtime producer`);
      }
      return {
        artifactId: artifact.id,
        kind: artifact.kind,
        evidenceKind: artifact.origin.evidenceKind,
        receiptSchema: artifact.origin.receiptSchema,
        producerId: artifact.origin.producerId,
        contentId: artifact.content.contentId,
        bytes: artifact.content.bytes,
        sourceArtifactIds: [...artifact.sourceArtifactIds],
        preflightId: artifact.origin.preflightId,
        preflightContentId: artifact.origin.preflightContentId,
      };
    })
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));

  const assessmentArtifacts = Object.values(state.artifacts)
    .filter((artifact) => {
      if (artifact.origin.kind !== "evidence_assessment") return false;
      const assessment = state.evidenceAssessments[artifact.origin.operationId];
      return assessment?.status === "completed" && assessment.artifactId === artifact.id;
    })
    .map((artifact): ProductionStudioEvidenceAssessmentArtifactView => {
      if (artifact.origin.kind !== "evidence_assessment") {
        throw new Error(`Production Studio projection: assessment artifact ${artifact.id} changed origin`);
      }
      if (
        artifact.kind !== "evidence-assessment-receipt" ||
        artifact.producerTaskId === null ||
        artifact.producerAgentId === null ||
        artifact.mediaClass !== "non_media"
      ) throw new Error(`Production Studio projection: assessment artifact ${artifact.id} is invalid`);
      return {
        artifactId: artifact.id,
        kind: artifact.kind,
        contentId: artifact.content.contentId,
        bytes: artifact.content.bytes,
        producerTaskId: artifact.producerTaskId,
        producerAgentId: artifact.producerAgentId,
        operationId: artifact.origin.operationId,
        receiptId: artifact.origin.receiptId,
        receiptContentId: artifact.origin.receiptContentId,
        readReceiptIds: [...artifact.origin.readReceiptIds],
        readReceiptContentIds: [...artifact.origin.readReceiptContentIds],
      };
    })
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));

  const workers = Object.values(state.agents)
    .map((agent): ProductionStudioWorkerView => {
      const task = state.tasks[agent.taskId];
      if (!task) throw new Error(`Production Studio projection: agent ${agent.id} has no task`);
      const execution = Object.values(state.executions)
        .filter((candidate) => candidate.agentId === agent.id && candidate.taskId === task.id)
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
        .at(-1);
      const usage = execution?.modelUsageReceiptId
        ? state.modelUsage[execution.modelUsageReceiptId]
        : null;
      const report = Object.values(state.reports)
        .filter((candidate) => candidate.agentId === agent.id && candidate.taskId === task.id)
        .at(-1);
      return {
        agentId: agent.id,
        taskId: task.id,
        label: agent.label,
        kind: agent.kind,
        status: agent.status,
        taskStatus: task.status,
        objective: task.objective,
        parentAgentId: agent.parentAgentId,
        parentTaskId: agent.parentTaskId,
        depth: task.depth,
        capabilities: task.grants.map((grant) => grant.capability).sort(),
        mediaScope: structuredClone(task.mediaScope),
        execution: execution
          ? {
              id: execution.id,
              status: execution.status,
              activeDurationMs: execution.receipt?.monotonicDurationMs ?? null,
              usage: usage
                ? {
                    model: usage.model,
                    inputTokens: usage.measured.inputTokens,
                    cachedInputTokens: usage.measured.cachedInputTokens,
                    outputTokens: usage.measured.outputTokens,
                    reasoningOutputTokens: usage.measured.reasoningOutputTokens,
                    billedAmount: null,
                  }
                : null,
            }
          : null,
        report: report ? { id: report.id, status: report.status, summary: report.summary } : null,
      };
    })
    .sort((left, right) => left.depth - right.depth || left.agentId.localeCompare(right.agentId));

  return {
    schema: "studio.production-projection.v1",
    source: { kind: "production_runtime_journal", recordedDemo: false },
    runId: state.runId,
    lastSeq: state.lastSeq,
    tasks,
    workers,
    grants,
    reports,
    spawnRequests,
    operations,
    evidenceReads,
    evidenceAssessments,
    sourceArtifacts,
    evidenceArtifacts,
    assessmentArtifacts,
    outputArtifacts,
    counts: {
      tasks: tasks.length,
      workers: workers.length,
      grants: grants.length,
      executions: Object.keys(state.executions).length,
      reports: reports.length,
      spawnRequests: spawnRequests.length,
      operations: operations.length,
      evidenceReads: evidenceReads.length,
      evidenceAssessments: evidenceAssessments.length,
      sourceArtifacts: sourceArtifacts.length,
      evidenceArtifacts: evidenceArtifacts.length,
      assessmentArtifacts: assessmentArtifacts.length,
      outputArtifacts: outputArtifacts.length,
    },
  };
}

/**
 * Separate production adapter. It consumes only `studio.runtime.event.v1` and never creates
 * legacy traces, RunBundles, or recorded-run identities.
 */
export class ProductionStudioAdapter {
  private state: RuntimeProjection;

  constructor(runId: string) {
    this.state = initialRuntimeProjection(runId);
  }

  append(candidate: unknown): ProductionStudioProjection {
    return this.appendBatch([candidate]);
  }

  /** A rejected event leaves the adapter at the last completely accepted poll batch. */
  appendBatch(candidates: readonly unknown[]): ProductionStudioProjection {
    let next = this.state;
    for (const candidate of candidates) next = applyRuntimeEvent(next, candidate);
    const view = adaptProductionRuntime(next);
    this.state = next;
    return view;
  }

  view(): ProductionStudioProjection {
    return adaptProductionRuntime(this.state);
  }
}

export function projectProductionRuntimeJournal(events: readonly unknown[]): ProductionStudioProjection {
  if (events.length === 0) throw new Error("Production Studio journal is empty");
  assertRuntimeEvent(events[0], "Production Studio journal event 1");
  const first = events[0] as RuntimeEvent;
  const adapter = new ProductionStudioAdapter(first.runId);
  events.forEach((event, index) => assertRuntimeEvent(event, `Production Studio journal event ${index + 1}`));
  return adapter.appendBatch(events);
}
