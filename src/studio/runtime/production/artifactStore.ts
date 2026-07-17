import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import {
  assertRuntimeArtifact,
  assertPreflightEvidenceArtifactDescriptor,
  assertSourceArtifactDescriptor,
  assertWorkerOutputEnvelope,
} from "./assertions.ts";
import { validateSemanticMediaEvidenceArtifact } from "./validation/semanticEvidence.ts";
import type {
  ContentIdentity,
  CaptionProductionArtifact,
  CaptionProductionReceipt,
  CaptionQualityControlReceipt,
  EvidenceAssessmentReceipt,
  EvidenceDecisionReceipt,
  ExecutorSpanReceipt,
  MediaOperationReceipt,
  MediaTrackDescriptor,
  PublishReviewDecisionReceipt,
  PublishReviewIntakeReceipt,
  PublishReviewRevocationReceipt,
  ParentArtifactAdmissionReceipt,
  ParentArtifactDispositionReceipt,
  RootOutputDispositionReceipt,
  RuntimeArtifact,
  SemanticMediaEvidenceArtifact,
  SourceArtifactDescriptor,
  StudyReportArtifact,
  StudyPlanningDecisionReceipt,
  OwnedMediaStudyArtifact,
  OwnedMediaStudyExecutorReceipt,
  StudyReadinessReceipt,
  WorkerOutputEnvelope,
} from "./model.ts";
import type { RuntimeLedger } from "./journal.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import { OWNED_MEDIA_STUDY_LIMITS, STUDY_REPORT_LIMITS } from "./model.ts";
import { validateStudyReportArtifact } from "./validation/studyReports.ts";
import { validateOwnedMediaStudyArtifact } from "./validation/studies.ts";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const item = value as Record<string, unknown>;
  return `{${Object.keys(item)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`)
    .join(",")}}`;
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

/** Content identity produced by storeJson's canonical JSON plus its terminal newline. */
export function canonicalJsonContentId(value: unknown): string {
  const digest = createHash("sha256").update(`${canonical(value)}\n`).digest("hex");
  return `sha256:${digest}`;
}

export async function identifyFile(path: string): Promise<ContentIdentity> {
  const [digest, details] = await Promise.all([
    new Promise<string>((resolveDigest, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(path);
      stream.on("error", reject);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolveDigest(hash.digest("hex")));
    }),
    stat(path),
  ]);
  if (!details.isFile() || details.size <= 0) throw new Error(`Artifact source ${path} must be a non-empty regular file`);
  return { algorithm: "sha256", digest, contentId: `sha256:${digest}`, bytes: details.size };
}

interface StoredFile {
  content: ContentIdentity;
  storageKey: string;
}

/**
 * The runtime source-artifact identity is derivable before bytes are copied into the run store.
 * This lets the host produce the exact pre-start forecast without creating a runtime directory.
 */
export function createSourceArtifactId(runId: string, descriptor: SourceArtifactDescriptor): string {
  assertSourceArtifactDescriptor(descriptor);
  return `artifact:${canonicalSha256({
    runId,
    contentId: descriptor.content.contentId,
    adapterId: descriptor.adapterId,
    sourceReceiptRef: descriptor.sourceReceiptRef,
  })}`;
}

export function createCaptionArtifactId(
  runId: string,
  jobId: string,
  contentId: string,
): string {
  return `artifact:${canonicalSha256({
    runId,
    jobId,
    kind: "caption-production-output",
    contentId,
  })}`;
}

export class ContentAddressedArtifactStore {
  private readonly absoluteRoot: string;

  constructor(root: string) {
    this.absoluteRoot = resolve(root);
  }

  private objectKey(content: ContentIdentity): string {
    return `objects/sha256/${content.digest.slice(0, 2)}/${content.digest}`;
  }

  private containedPath(storageKey: string): string {
    if (!storageKey || storageKey.startsWith("/") || storageKey.split("/").includes("..")) {
      throw new Error(`Artifact storage key ${storageKey} is not contained`);
    }
    const path = resolve(this.absoluteRoot, storageKey);
    const inside = relative(this.absoluteRoot, path);
    if (!inside || inside.startsWith("..") || resolve(this.absoluteRoot, inside) !== path) {
      throw new Error(`Artifact storage key ${storageKey} escapes the store`);
    }
    return path;
  }

  private async storeFile(path: string): Promise<StoredFile> {
    const content = await identifyFile(path);
    const storageKey = this.objectKey(content);
    const destination = this.containedPath(storageKey);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const temporaryDirectory = await mkdtemp(join(this.absoluteRoot, ".store-"));
    const temporary = join(temporaryDirectory, "object");
    try {
      await copyFile(path, temporary);
      const copied = await identifyFile(temporary);
      if (copied.contentId !== content.contentId || copied.bytes !== content.bytes) {
        throw new Error(`Artifact source ${path} changed while it was copied`);
      }
      try {
        await link(temporary, destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const stored = await identifyFile(destination);
      if (stored.contentId !== content.contentId || stored.bytes !== content.bytes) {
        throw new Error(`Artifact object ${storageKey} does not match its content address`);
      }
      return { content, storageKey };
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async registerSource(runId: string, descriptor: unknown): Promise<RuntimeArtifact> {
    assertSourceArtifactDescriptor(descriptor);
    const measured = await identifyFile(descriptor.path);
    if (measured.contentId !== descriptor.content.contentId || measured.bytes !== descriptor.content.bytes) {
      throw new Error("Normalized source descriptor does not match the source bytes");
    }
    const stored = await this.storeFile(descriptor.path);
    const id = createSourceArtifactId(runId, descriptor);
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id,
      runId,
      kind: "source-media",
      mediaClass: "raw",
      publication: descriptor.publication,
      content: stored.content,
      storageKey: stored.storageKey,
      durationMs: descriptor.durationMs,
      tracks: descriptor.tracks,
      sourceArtifactIds: [],
      producerTaskId: null,
      producerAgentId: null,
      origin: {
        kind: "ingest",
        adapterId: descriptor.adapterId,
        sourceReceiptRef: descriptor.sourceReceiptRef,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

  async registerPreflightEvidence(
    runId: string,
    sourceArtifactId: string,
    descriptorValue: unknown,
  ): Promise<RuntimeArtifact> {
    assertPreflightEvidenceArtifactDescriptor(descriptorValue);
    const descriptor = descriptorValue;
    const measured = await identifyFile(descriptor.path);
    if (measured.contentId !== descriptor.content.contentId || measured.bytes !== descriptor.content.bytes) {
      throw new Error("Validated preflight evidence no longer matches its content identity");
    }
    const stored = await this.storeFile(descriptor.path);
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId,
        evidenceKind: descriptor.evidenceKind,
        contentId: stored.content.contentId,
        preflightContentId: descriptor.preflightContentId,
      })}`,
      runId,
      kind: `${descriptor.evidenceKind.replaceAll("_", "-")}-receipt`,
      mediaClass: "non_media",
      publication: "private",
      content: stored.content,
      storageKey: stored.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [sourceArtifactId],
      producerTaskId: null,
      producerAgentId: null,
      origin: {
        kind: "preflight_evidence",
        evidenceKind: descriptor.evidenceKind,
        receiptSchema: descriptor.receiptSchema,
        producerId: descriptor.producerId,
        preflightId: descriptor.preflightId,
        preflightContentId: descriptor.preflightContentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

  async prepareDerived(
    path: string,
    input: {
      runId: string;
      kind: string;
      operationId: string;
      publication: "private" | "public";
      durationMs: number;
      tracks: MediaTrackDescriptor[];
    },
  ): Promise<{ artifactId: string; content: ContentIdentity; storageKey: string }> {
    const stored = await this.storeFile(path);
    return {
      artifactId: `artifact:${canonicalSha256({
        runId: input.runId,
        operationId: input.operationId,
        kind: input.kind,
        contentId: stored.content.contentId,
      })}`,
      ...stored,
    };
  }

  async storeReceipt(receipt: MediaOperationReceipt): Promise<{ content: ContentIdentity; storageKey: string }> {
    return this.storeJson(receipt);
  }

  async storeJson(value: unknown): Promise<{ content: ContentIdentity; storageKey: string }> {
    await mkdir(this.absoluteRoot, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(this.absoluteRoot, ".receipt-"));
    const path = join(directory, "receipt.json");
    try {
      await writeFile(path, `${canonical(value)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      const stored = await this.storeFile(path);
      if (stored.content.contentId !== canonicalJsonContentId(value)) {
        throw new Error("Canonical JSON storage content identity changed unexpectedly");
      }
      return stored;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async prepareWorkerOutput(runId: string, envelopeValue: unknown): Promise<{
    artifactId: string;
    envelope: WorkerOutputEnvelope;
    content: ContentIdentity;
    storageKey: string;
  }> {
    assertWorkerOutputEnvelope(envelopeValue);
    const envelope = structuredClone(envelopeValue);
    const stored = await this.storeJson(envelope);
    return {
      artifactId: `artifact:${canonicalSha256({
        runId,
        executionId: envelope.executionId,
        outputName: envelope.output.name,
        outputKind: envelope.output.kind,
        contentId: stored.content.contentId,
      })}`,
      envelope,
      ...stored,
    };
  }

  async prepareSemanticEvidence(runId: string, value: unknown): Promise<{
    artifactId: string;
    envelope: SemanticMediaEvidenceArtifact;
    content: ContentIdentity;
    storageKey: string;
  }> {
    const envelope = validateSemanticMediaEvidenceArtifact(value);
    if (envelope.runId !== runId) throw new Error("Semantic evidence envelope belongs to another run");
    const stored = await this.storeJson(envelope);
    if (stored.content.bytes > envelope.limits.maxArtifactBytes) {
      throw new Error("Semantic evidence artifact exceeds its byte ceiling");
    }
    return {
      artifactId: `artifact:${canonicalSha256({
        runId,
        operationId: envelope.operationId,
        kind: "studio.semantic-media-evidence.v1",
        contentId: stored.content.contentId,
      })}`,
      envelope,
      ...stored,
    };
  }

  async prepareStudyReport(runId: string, value: unknown): Promise<{
    artifactId: string;
    envelope: StudyReportArtifact;
    content: ContentIdentity;
    storageKey: string;
  }> {
    const envelope = validateStudyReportArtifact(value);
    if (envelope.runId !== runId) throw new Error("Study report belongs to another run");
    const stored = await this.storeJson(envelope);
    if (stored.content.bytes > STUDY_REPORT_LIMITS.maxArtifactBytes) {
      throw new Error("Study report exceeds its stored-byte ceiling");
    }
    return {
      artifactId: `artifact:${canonicalSha256({
        runId,
        taskId: envelope.task.taskId,
        outputSlot: envelope.outputSlot,
        kind: "studio.study-report.v1",
        contentId: stored.content.contentId,
      })}`,
      envelope,
      ...stored,
    };
  }

  async prepareOwnedMediaStudy(runId: string, value: unknown): Promise<{
    artifactId: string;
    studyId: string;
    envelope: OwnedMediaStudyArtifact;
    content: ContentIdentity;
    storageKey: string;
  }> {
    const envelope = validateOwnedMediaStudyArtifact(value);
    if (envelope.runId !== runId) throw new Error("Owned-media study belongs to another run");
    const stored = await this.storeJson(envelope);
    if (stored.content.bytes > OWNED_MEDIA_STUDY_LIMITS.maxArtifactBytes) {
      throw new Error("Owned-media study exceeds its stored-byte ceiling");
    }
    const studyId = `owned-media-study:${canonicalSha256({
      runId,
      planningDecisionId: envelope.planning.decisionId,
      executionId: envelope.root.executionId,
      contentId: stored.content.contentId,
    })}`;
    return {
      artifactId: `artifact:${canonicalSha256({ runId, studyId, kind: "studio.owned-media-study.v1", contentId: stored.content.contentId })}`,
      studyId,
      envelope,
      ...stored,
    };
  }

  buildStudyPlanningDecisionArtifact(input: {
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

  buildOwnedMediaStudyArtifact(input: {
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

  buildStudyReadinessArtifact(input: {
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

  buildSemanticEvidenceArtifact(input: {
    runId: string;
    receiptId: string;
    receiptContentId: string;
    prepared: {
      artifactId: string;
      envelope: SemanticMediaEvidenceArtifact;
      content: ContentIdentity;
      storageKey: string;
    };
  }): RuntimeArtifact {
    const envelope = input.prepared.envelope;
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: input.prepared.artifactId,
      runId: input.runId,
      kind: "studio.semantic-media-evidence.v1",
      mediaClass: "non_media",
      publication: "private",
      content: input.prepared.content,
      storageKey: input.prepared.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [envelope.source.artifactId],
      producerTaskId: envelope.authorization.taskId,
      producerAgentId: envelope.authorization.agentId,
      origin: {
        kind: "semantic_media_evidence",
        operationId: envelope.operationId,
        receiptId: input.receiptId,
        receiptContentId: input.receiptContentId,
        availabilityId: envelope.availability.id,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

  buildWorkerOutputArtifact(input: {
    runId: string;
    receipt: ExecutorSpanReceipt;
    receiptContentId: string;
    prepared: {
      artifactId: string;
      envelope: WorkerOutputEnvelope;
      content: ContentIdentity;
      storageKey: string;
    };
  }): RuntimeArtifact {
    const { envelope } = input.prepared;
    if (
      envelope.executionId !== input.receipt.executionId ||
      envelope.taskId !== input.receipt.taskId ||
      envelope.agentId !== input.receipt.agentId ||
      !input.receipt.outputArtifactIds.includes(input.prepared.artifactId)
    ) {
      throw new Error("Worker output envelope does not match its executor receipt");
    }
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: input.prepared.artifactId,
      runId: input.runId,
      kind: envelope.output.kind,
      mediaClass: "non_media",
      publication: "private",
      content: input.prepared.content,
      storageKey: input.prepared.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [],
      producerTaskId: envelope.taskId,
      producerAgentId: envelope.agentId,
      origin: {
        kind: "worker_output",
        executionId: envelope.executionId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.receiptContentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

  buildStudyReportArtifact(input: {
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

  buildParentAdmissionArtifact(input: {
    runId: string;
    receipt: ParentArtifactAdmissionReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const admitted = input.receipt.admitted[0];
    if (!admitted || input.receipt.admitted.length !== 1) throw new Error("Parent admission requires one exact study artifact");
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({ runId: input.runId, admissionId: input.receipt.admissionId, kind: "parent-admission-receipt", contentId: input.storedReceipt.content.contentId })}`,
      runId: input.runId,
      kind: "parent-admission-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [admitted.artifactId],
      producerTaskId: input.receipt.parent.taskId,
      producerAgentId: input.receipt.parent.agentId,
      origin: {
        kind: "parent_admission",
        admissionId: input.receipt.admissionId,
        dispositionId: input.receipt.dispositionId,
        reportId: input.receipt.reportId,
        inputArtifactId: admitted.artifactId,
        grantId: input.receipt.grant.id,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

  buildParentArtifactDispositionArtifact(input: {
    runId: string;
    receipt: ParentArtifactDispositionReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({ runId: input.runId, dispositionId: input.receipt.dispositionId, kind: "parent-artifact-disposition-receipt", contentId: input.storedReceipt.content.contentId })}`,
      runId: input.runId,
      kind: input.receipt.decision.outcome === "accepted" ? "parent-accepted-artifact-receipt" : "parent-rejected-artifact-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [input.receipt.output.artifactId],
      producerTaskId: input.receipt.parent.taskId,
      producerAgentId: input.receipt.parent.agentId,
      origin: {
        kind: "parent_artifact_disposition",
        dispositionId: input.receipt.dispositionId,
        reportId: input.receipt.report.reportId,
        inputArtifactId: input.receipt.output.artifactId,
        outcome: input.receipt.decision.outcome,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

  buildRootOutputDispositionArtifact(input: {
    runId: string;
    receipt: RootOutputDispositionReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId: input.runId,
        dispositionId: input.receipt.dispositionId,
        kind: "root-output-disposition-receipt",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: input.receipt.decision.outcome === "promoted_to_root"
        ? "root-promoted-output-receipt"
        : "root-rejected-output-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [input.receipt.input.artifactId],
      producerTaskId: input.receipt.authority.rootTaskId,
      producerAgentId: input.receipt.authority.rootAgentId,
      origin: {
        kind: "root_output_disposition",
        dispositionId: input.receipt.dispositionId,
        reportId: input.receipt.report.reportId,
        inputArtifactId: input.receipt.input.artifactId,
        outcome: input.receipt.decision.outcome,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

  buildDerivedArtifact(input: {
    runId: string;
    kind: string;
    operationId: string;
    receiptId: string;
    receiptContentId: string;
    publication: "private" | "public";
    durationMs: number;
    tracks: MediaTrackDescriptor[];
    sourceArtifactIds: string[];
    producerTaskId: string;
    producerAgentId: string;
    prepared: { artifactId: string; content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: input.prepared.artifactId,
      runId: input.runId,
      kind: input.kind,
      mediaClass: "derived",
      publication: input.publication,
      content: input.prepared.content,
      storageKey: input.prepared.storageKey,
      durationMs: input.durationMs,
      tracks: input.tracks,
      sourceArtifactIds: input.sourceArtifactIds,
      producerTaskId: input.producerTaskId,
      producerAgentId: input.producerAgentId,
      origin: {
        kind: "media_operation",
        operationId: input.operationId,
        receiptId: input.receiptId,
        receiptContentId: input.receiptContentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

  buildObservationArtifact(input: {
    runId: string;
    operationId: string;
    receiptId: string;
    sourceArtifactIds: string[];
    producerTaskId: string;
    producerAgentId: string;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId: input.runId,
        operationId: input.operationId,
        kind: "media-audio-activity-observation",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: "media-audio-activity-observation",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: input.sourceArtifactIds,
      producerTaskId: input.producerTaskId,
      producerAgentId: input.producerAgentId,
      origin: {
        kind: "media_observation",
        operationId: input.operationId,
        receiptId: input.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

  buildEvidenceAssessmentArtifact(input: {
    runId: string;
    receipt: EvidenceAssessmentReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId: input.runId,
        operationId: input.receipt.operationId,
        kind: "evidence-assessment-receipt",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: "evidence-assessment-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [],
      producerTaskId: input.receipt.authorization.taskId,
      producerAgentId: input.receipt.authorization.agentId,
      origin: {
        kind: "evidence_assessment",
        operationId: input.receipt.operationId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
        readReceiptIds: input.receipt.inputs.map((receipt) => receipt.receiptId),
        readReceiptContentIds: input.receipt.inputs.map((receipt) => receipt.receiptContentId),
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

  buildEvidenceDecisionArtifact(input: {
    runId: string;
    receipt: EvidenceDecisionReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId: input.runId,
        operationId: input.receipt.operationId,
        kind: "evidence-decision-receipt",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: "evidence-decision-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: input.receipt.inputs.map((assessment) => assessment.artifactId),
      producerTaskId: input.receipt.authorization.taskId,
      producerAgentId: input.receipt.authorization.agentId,
      origin: {
        kind: "evidence_decision",
        operationId: input.receipt.operationId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
        assessmentOperationIds: input.receipt.inputs.map((assessment) => assessment.operationId),
        assessmentArtifactIds: input.receipt.inputs.map((assessment) => assessment.artifactId),
        assessmentReceiptIds: input.receipt.inputs.map((assessment) => assessment.receiptId),
        assessmentReceiptContentIds: input.receipt.inputs.map((assessment) => assessment.receiptContentId),
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

  buildPublishReviewIntakeArtifact(input: {
    runId: string;
    receipt: PublishReviewIntakeReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const readiness = input.receipt.input.readiness;
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId: input.runId,
        intakeId: input.receipt.intakeId,
        kind: "publish-review-intake-receipt",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: "publish-review-intake-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [readiness.artifactId],
      producerTaskId: null,
      producerAgentId: null,
      origin: {
        kind: "publish_review_intake",
        intakeId: input.receipt.intakeId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
        readinessId: readiness.readinessId,
        readinessArtifactId: readiness.artifactId,
        readinessReceiptId: readiness.receiptId,
        readinessReceiptContentId: readiness.receiptContentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

  buildPublishReviewDecisionArtifact(input: {
    runId: string;
    receipt: PublishReviewDecisionReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const intake = input.receipt.input.intake;
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId: input.runId,
        reviewId: input.receipt.reviewId,
        kind: "publish-review-decision-receipt",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: "publish-review-decision-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [intake.artifactId],
      producerTaskId: null,
      producerAgentId: null,
      origin: {
        kind: "publish_review_decision",
        reviewId: input.receipt.reviewId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
        intakeId: intake.intakeId,
        intakeArtifactId: intake.artifactId,
        intakeReceiptId: intake.receiptId,
        intakeReceiptContentId: intake.receiptContentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

  buildPublishReviewRevocationArtifact(input: {
    runId: string;
    receipt: PublishReviewRevocationReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const approval = input.receipt.input.approval;
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId: input.runId,
        revocationId: input.receipt.revocationId,
        kind: "publish-review-revocation-receipt",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: "publish-review-revocation-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [approval.artifactId],
      producerTaskId: null,
      producerAgentId: null,
      origin: {
        kind: "publish_review_revocation",
        revocationId: input.receipt.revocationId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
        reviewId: approval.reviewId,
        approvalArtifactId: approval.artifactId,
        approvalReceiptId: approval.receiptId,
        approvalReceiptContentId: approval.receiptContentId,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

  buildCaptionProductionArtifacts(input: {
    runId: string;
    caption: CaptionProductionArtifact;
    receipt: CaptionProductionReceipt;
    storedCaption: { content: ContentIdentity; storageKey: string };
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): { captionArtifact: RuntimeArtifact; receiptArtifact: RuntimeArtifact } {
    const approval = input.receipt.authority.approval;
    const captionArtifactId = createCaptionArtifactId(
      input.runId,
      input.caption.jobId,
      input.storedCaption.content.contentId,
    );
    if (
      input.caption.jobId !== input.receipt.jobId ||
      input.receipt.result.captionArtifactId !== captionArtifactId ||
      input.receipt.result.captionContentId !== input.storedCaption.content.contentId ||
      input.receipt.result.captionBytes !== input.storedCaption.content.bytes
    ) throw new Error("Caption receipt does not bind the exact stored caption artifact");
    const captionArtifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: captionArtifactId,
      runId: input.runId,
      kind: "caption-production-output",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedCaption.content,
      storageKey: input.storedCaption.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [
        input.caption.input.sourceArtifactId,
        input.caption.input.study.artifactId,
        input.caption.input.readiness.artifactId,
        approval.artifactId,
      ],
      producerTaskId: null,
      producerAgentId: null,
      origin: {
        kind: "caption_production_output",
        jobId: input.caption.jobId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
        approvalReviewId: approval.reviewId,
        approvalArtifactId: approval.artifactId,
        sourceArtifactId: input.caption.input.sourceArtifactId,
        studyId: input.caption.input.study.studyId,
        studyArtifactId: input.caption.input.study.artifactId,
        readinessId: input.caption.input.readiness.readinessId,
        readinessArtifactId: input.caption.input.readiness.artifactId,
      },
    };
    const receiptArtifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId: input.runId,
        jobId: input.receipt.jobId,
        kind: "caption-production-receipt",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: "caption-production-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [
        captionArtifact.id,
        input.caption.input.study.artifactId,
        input.caption.input.readiness.artifactId,
        approval.artifactId,
      ],
      producerTaskId: null,
      producerAgentId: null,
      origin: {
        kind: "caption_production_receipt",
        jobId: input.receipt.jobId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
        approvalReviewId: approval.reviewId,
        approvalArtifactId: approval.artifactId,
        captionArtifactId: captionArtifact.id,
        captionContentId: captionArtifact.content.contentId,
        studyId: input.caption.input.study.studyId,
        studyArtifactId: input.caption.input.study.artifactId,
        readinessId: input.caption.input.readiness.readinessId,
        readinessArtifactId: input.caption.input.readiness.artifactId,
      },
    };
    assertRuntimeArtifact(captionArtifact);
    assertRuntimeArtifact(receiptArtifact);
    return { captionArtifact, receiptArtifact };
  }

  buildCaptionQualityControlArtifact(input: {
    runId: string;
    receipt: CaptionQualityControlReceipt;
    storedReceipt: { content: ContentIdentity; storageKey: string };
  }): RuntimeArtifact {
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId: input.runId,
        qcId: input.receipt.qcId,
        kind: "caption-quality-control-receipt",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: input.receipt.decision.outcome === "accepted"
        ? "caption-quality-control-accepted-receipt"
        : "caption-quality-control-withheld-receipt",
      mediaClass: "non_media",
      publication: "private",
      content: input.storedReceipt.content,
      storageKey: input.storedReceipt.storageKey,
      durationMs: null,
      tracks: [],
      sourceArtifactIds: [
        input.receipt.input.captionArtifactId,
        input.receipt.lineage.study.artifactId,
        input.receipt.lineage.readiness.artifactId,
        input.receipt.lineage.approval.artifactId,
      ],
      producerTaskId: null,
      producerAgentId: null,
      origin: {
        kind: "caption_quality_control",
        qcId: input.receipt.qcId,
        jobId: input.receipt.input.jobId,
        captionArtifactId: input.receipt.input.captionArtifactId,
        captionContentId: input.receipt.input.captionContentId,
        studyId: input.receipt.lineage.study.studyId,
        readinessId: input.receipt.lineage.readiness.readinessId,
        approvalReviewId: input.receipt.lineage.approval.reviewId,
        receiptId: input.receipt.receiptId,
        receiptContentId: input.storedReceipt.content.contentId,
        outcome: input.receipt.decision.outcome,
      },
    };
    assertRuntimeArtifact(artifact);
    return artifact;
  }

  async record(ledger: RuntimeLedger, artifact: RuntimeArtifact, causationId: string | null = null): Promise<void> {
    assertRuntimeArtifact(artifact);
    await this.resolveVerified(artifact);
    await ledger.transact(
      {
        producer: { kind: "artifact_store", id: "content-addressed-artifact-store" },
        causationId,
      },
      () => ({
        pending: [{ type: "artifact.recorded", data: { artifact } }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
  }

  async resolveVerified(artifact: RuntimeArtifact): Promise<string> {
    assertRuntimeArtifact(artifact);
    const path = this.containedPath(artifact.storageKey);
    const measured = await identifyFile(path);
    if (measured.contentId !== artifact.content.contentId || measured.bytes !== artifact.content.bytes) {
      throw new Error(`Artifact ${artifact.id} no longer matches its registered content identity`);
    }
    return path;
  }

  async receiptBytes(contentId: string): Promise<Buffer> {
    const digest = contentId.replace(/^sha256:/, "");
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Receipt content id is invalid");
    return readFile(this.containedPath(`objects/sha256/${digest.slice(0, 2)}/${digest}`));
  }
}
