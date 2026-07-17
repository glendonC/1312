import { copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  MediaOperationReceipt,
  MediaTrackDescriptor,
  RuntimeArtifact,
  SemanticMediaEvidenceArtifact,
  StudyReportArtifact,
  OwnedMediaStudyArtifact,
  WorkerOutputEnvelope,
} from "./model.ts";
import type { RuntimeLedger } from "./journal.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import { OWNED_MEDIA_STUDY_LIMITS, STUDY_REPORT_LIMITS } from "./model.ts";
import { validateStudyReportArtifact } from "./validation/studyReports.ts";
import { validateOwnedMediaStudyArtifact } from "./validation/studies.ts";
import {
  buildStudyPlanningDecisionArtifact as buildStudyPlanningDecisionArtifactBuilder,
  buildOwnedMediaStudyArtifact as buildOwnedMediaStudyArtifactBuilder,
  buildStudyReadinessArtifact as buildStudyReadinessArtifactBuilder,
  buildStudyReportArtifact as buildStudyReportArtifactBuilder,
} from "./artifactStore/studyArtifacts.ts";
import {
  buildSemanticEvidenceArtifact as buildSemanticEvidenceArtifactBuilder,
  buildWorkerOutputArtifact as buildWorkerOutputArtifactBuilder,
  buildParentAdmissionArtifact as buildParentAdmissionArtifactBuilder,
  buildParentArtifactDispositionArtifact as buildParentArtifactDispositionArtifactBuilder,
  buildRootOutputDispositionArtifact as buildRootOutputDispositionArtifactBuilder,
  buildDerivedArtifact as buildDerivedArtifactBuilder,
  buildObservationArtifact as buildObservationArtifactBuilder,
  buildEvidenceAssessmentArtifact as buildEvidenceAssessmentArtifactBuilder,
  buildEvidenceDecisionArtifact as buildEvidenceDecisionArtifactBuilder,
} from "./artifactStore/orchestrationArtifacts.ts";
import {
  buildPublishReviewIntakeArtifact as buildPublishReviewIntakeArtifactBuilder,
  buildPublishReviewDecisionArtifact as buildPublishReviewDecisionArtifactBuilder,
  buildPublishReviewRevocationArtifact as buildPublishReviewRevocationArtifactBuilder,
} from "./artifactStore/reviewArtifacts.ts";
import {
  buildCaptionProductionArtifacts as buildCaptionProductionArtifactsBuilder,
  buildCaptionQualityControlArtifact as buildCaptionQualityControlArtifactBuilder,
} from "./artifactStore/captionArtifacts.ts";
import {
  canonicalJson,
  canonicalJsonContentId,
  canonicalSha256,
  createSourceArtifactId,
  identifyFile,
} from "./artifactStore/contentIdentity.ts";

export {
  canonicalJsonContentId,
  canonicalSha256,
  createCaptionArtifactId,
  createSourceArtifactId,
  identifyFile,
} from "./artifactStore/contentIdentity.ts";

interface StoredFile {
  content: ContentIdentity;
  storageKey: string;
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
    const producerReceipt = descriptor.schema === "studio.preflight-evidence-artifact.v2"
      ? await this.storeFile(descriptor.producerReceiptPath!)
      : null;
    if (producerReceipt && (
      producerReceipt.content.contentId !== descriptor.producerReceiptContent?.contentId ||
      producerReceipt.content.bytes !== descriptor.producerReceiptContent?.bytes
    )) throw new Error("Validated acoustic producer receipt no longer matches its content identity");
    const artifact: RuntimeArtifact = {
      schema: "studio.runtime.artifact.v1",
      id: `artifact:${canonicalSha256({
        runId,
        evidenceKind: descriptor.evidenceKind,
        contentId: stored.content.contentId,
        preflightContentId: descriptor.preflightContentId,
        ...(producerReceipt ? { producerReceiptContentId: producerReceipt.content.contentId } : {}),
      })}`,
      runId,
      kind: descriptor.evidenceKind === "acoustic_ranges"
        ? "acoustic-ranges-evidence"
        : `${descriptor.evidenceKind.replaceAll("_", "-")}-receipt`,
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
        ...(producerReceipt ? { producerReceiptContentId: producerReceipt.content.contentId } : {}),
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
      await writeFile(path, `${canonicalJson(value)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
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

  buildStudyPlanningDecisionArtifact(
    input: Parameters<typeof buildStudyPlanningDecisionArtifactBuilder>[0],
  ): ReturnType<typeof buildStudyPlanningDecisionArtifactBuilder> {
    return buildStudyPlanningDecisionArtifactBuilder(input);
  }

  buildOwnedMediaStudyArtifact(
    input: Parameters<typeof buildOwnedMediaStudyArtifactBuilder>[0],
  ): ReturnType<typeof buildOwnedMediaStudyArtifactBuilder> {
    return buildOwnedMediaStudyArtifactBuilder(input);
  }

  buildStudyReadinessArtifact(
    input: Parameters<typeof buildStudyReadinessArtifactBuilder>[0],
  ): ReturnType<typeof buildStudyReadinessArtifactBuilder> {
    return buildStudyReadinessArtifactBuilder(input);
  }

  buildStudyReportArtifact(
    input: Parameters<typeof buildStudyReportArtifactBuilder>[0],
  ): ReturnType<typeof buildStudyReportArtifactBuilder> {
    return buildStudyReportArtifactBuilder(input);
  }

  buildSemanticEvidenceArtifact(
    input: Parameters<typeof buildSemanticEvidenceArtifactBuilder>[0],
  ): ReturnType<typeof buildSemanticEvidenceArtifactBuilder> {
    return buildSemanticEvidenceArtifactBuilder(input);
  }

  buildWorkerOutputArtifact(
    input: Parameters<typeof buildWorkerOutputArtifactBuilder>[0],
  ): ReturnType<typeof buildWorkerOutputArtifactBuilder> {
    return buildWorkerOutputArtifactBuilder(input);
  }

  buildParentAdmissionArtifact(
    input: Parameters<typeof buildParentAdmissionArtifactBuilder>[0],
  ): ReturnType<typeof buildParentAdmissionArtifactBuilder> {
    return buildParentAdmissionArtifactBuilder(input);
  }

  buildParentArtifactDispositionArtifact(
    input: Parameters<typeof buildParentArtifactDispositionArtifactBuilder>[0],
  ): ReturnType<typeof buildParentArtifactDispositionArtifactBuilder> {
    return buildParentArtifactDispositionArtifactBuilder(input);
  }

  buildRootOutputDispositionArtifact(
    input: Parameters<typeof buildRootOutputDispositionArtifactBuilder>[0],
  ): ReturnType<typeof buildRootOutputDispositionArtifactBuilder> {
    return buildRootOutputDispositionArtifactBuilder(input);
  }

  buildDerivedArtifact(
    input: Parameters<typeof buildDerivedArtifactBuilder>[0],
  ): ReturnType<typeof buildDerivedArtifactBuilder> {
    return buildDerivedArtifactBuilder(input);
  }

  buildObservationArtifact(
    input: Parameters<typeof buildObservationArtifactBuilder>[0],
  ): ReturnType<typeof buildObservationArtifactBuilder> {
    return buildObservationArtifactBuilder(input);
  }

  buildEvidenceAssessmentArtifact(
    input: Parameters<typeof buildEvidenceAssessmentArtifactBuilder>[0],
  ): ReturnType<typeof buildEvidenceAssessmentArtifactBuilder> {
    return buildEvidenceAssessmentArtifactBuilder(input);
  }

  buildEvidenceDecisionArtifact(
    input: Parameters<typeof buildEvidenceDecisionArtifactBuilder>[0],
  ): ReturnType<typeof buildEvidenceDecisionArtifactBuilder> {
    return buildEvidenceDecisionArtifactBuilder(input);
  }

  buildPublishReviewIntakeArtifact(
    input: Parameters<typeof buildPublishReviewIntakeArtifactBuilder>[0],
  ): ReturnType<typeof buildPublishReviewIntakeArtifactBuilder> {
    return buildPublishReviewIntakeArtifactBuilder(input);
  }

  buildPublishReviewDecisionArtifact(
    input: Parameters<typeof buildPublishReviewDecisionArtifactBuilder>[0],
  ): ReturnType<typeof buildPublishReviewDecisionArtifactBuilder> {
    return buildPublishReviewDecisionArtifactBuilder(input);
  }

  buildPublishReviewRevocationArtifact(
    input: Parameters<typeof buildPublishReviewRevocationArtifactBuilder>[0],
  ): ReturnType<typeof buildPublishReviewRevocationArtifactBuilder> {
    return buildPublishReviewRevocationArtifactBuilder(input);
  }

  buildCaptionProductionArtifacts(
    input: Parameters<typeof buildCaptionProductionArtifactsBuilder>[0],
  ): ReturnType<typeof buildCaptionProductionArtifactsBuilder> {
    return buildCaptionProductionArtifactsBuilder(input);
  }

  buildCaptionQualityControlArtifact(
    input: Parameters<typeof buildCaptionQualityControlArtifactBuilder>[0],
  ): ReturnType<typeof buildCaptionQualityControlArtifactBuilder> {
    return buildCaptionQualityControlArtifactBuilder(input);
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
