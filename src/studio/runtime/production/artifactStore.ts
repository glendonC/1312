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
import type {
  ContentIdentity,
  EvidenceAssessmentReceipt,
  ExecutorSpanReceipt,
  MediaOperationReceipt,
  MediaTrackDescriptor,
  RuntimeArtifact,
  SourceArtifactDescriptor,
  WorkerOutputEnvelope,
} from "./model.ts";
import type { RuntimeLedger } from "./journal.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";

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
        kind: "media-seek-observation",
        contentId: input.storedReceipt.content.contentId,
      })}`,
      runId: input.runId,
      kind: "media-seek-observation",
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
