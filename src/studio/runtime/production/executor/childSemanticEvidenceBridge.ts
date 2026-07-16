import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { SemanticEvidenceHostResult } from "../semanticEvidenceHost.ts";
import type { MediaScope, SemanticMediaObservation, TaskRecord } from "../model.ts";

export const CHILD_SEMANTIC_EVIDENCE_TOOL = "speech_transcribe" as const;

export interface ChildSpeechTranscribeArguments {
  artifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
}

export interface ChildSemanticEvidenceToolManifest {
  schema: "studio.child-semantic-evidence-tools.v1";
  taskId: string;
  agentId: string;
  tool: {
    name: typeof CHILD_SEMANTIC_EVIDENCE_TOOL;
    capability: "speech.transcribe";
    mediaScope: MediaScope[];
  };
}

export interface ChildSemanticEvidenceToolResult {
  schema: "studio.child-semantic-evidence-tool-result.v1";
  capability: "speech.transcribe";
  operationId: string;
  artifact: { artifactId: string; contentId: string; bytes: number };
  receipt: { receiptId: string; contentId: string };
  availability: SemanticEvidenceHostResult["envelope"]["availability"];
  observations: SemanticMediaObservation[];
}

export interface ChildSemanticEvidenceHost {
  transcribe(request: unknown): Promise<SemanticEvidenceHostResult>;
}

export type ChildSemanticEvidenceBridgeErrorCode =
  | "invalid_request"
  | "capability_not_granted"
  | "operation_rejected"
  | "bridge_unavailable";

export class ChildSemanticEvidenceBridgeError extends Error {
  readonly code: ChildSemanticEvidenceBridgeErrorCode;
  constructor(code: ChildSemanticEvidenceBridgeErrorCode, message: string) {
    super(message);
    this.name = "ChildSemanticEvidenceBridgeError";
    this.code = code;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(item: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(item).length === keys.length && keys.every((key) => key in item);
}

function toolArguments(value: unknown): ChildSpeechTranscribeArguments {
  const item = record(value);
  if (
    !item || !exact(item, ["artifactId", "trackId", "startMs", "endMs"]) ||
    typeof item.artifactId !== "string" || !item.artifactId ||
    typeof item.trackId !== "string" || !item.trackId ||
    !Number.isSafeInteger(item.startMs) || !Number.isSafeInteger(item.endMs) ||
    (item.startMs as number) < 0 || (item.endMs as number) <= (item.startMs as number)
  ) throw new ChildSemanticEvidenceBridgeError(
    "invalid_request",
    "speech_transcribe accepts only an artifact, track, and non-empty half-open integer-millisecond range.",
  );
  return item as unknown as ChildSpeechTranscribeArguments;
}

/** Task-private adapter; callers cannot supply task, agent, operation, grant, executor, or path identities. */
export class BoundedChildSemanticEvidenceBridge {
  private readonly task: TaskRecord;
  private readonly host: ChildSemanticEvidenceHost;
  private readonly nextOperationId: () => string;

  constructor(
    task: TaskRecord,
    host: ChildSemanticEvidenceHost,
    options: { nextOperationId?: () => string } = {},
  ) {
    this.task = structuredClone(task);
    this.host = host;
    this.nextOperationId = options.nextOperationId ?? (() => `operation:child:speech-transcribe:${randomUUID()}`);
  }

  manifest(): ChildSemanticEvidenceToolManifest {
    const grants = this.task.grants.filter((grant) => grant.capability === "speech.transcribe");
    if (grants.length !== 1) {
      throw new ChildSemanticEvidenceBridgeError("capability_not_granted", "The child task has no exact speech.transcribe grant.");
    }
    return {
      schema: "studio.child-semantic-evidence-tools.v1",
      taskId: this.task.id,
      agentId: this.task.assignedAgentId,
      tool: {
        name: CHILD_SEMANTIC_EVIDENCE_TOOL,
        capability: "speech.transcribe",
        mediaScope: structuredClone(grants[0].mediaScope),
      },
    };
  }

  async call(value: unknown): Promise<ChildSemanticEvidenceToolResult> {
    if (!this.task.grants.some((grant) => grant.capability === "speech.transcribe")) {
      throw new ChildSemanticEvidenceBridgeError("capability_not_granted", "The child task has no speech.transcribe grant.");
    }
    const input = toolArguments(value);
    const request = {
      operationId: this.nextOperationId(),
      taskId: this.task.id,
      agentId: this.task.assignedAgentId,
      ...input,
    };
    try {
      const result = await this.host.transcribe(request);
      if (
        result.envelope.operationId !== request.operationId ||
        result.envelope.runId !== this.task.runId ||
        result.envelope.authorization.taskId !== this.task.id ||
        result.envelope.authorization.agentId !== this.task.assignedAgentId ||
        result.envelope.source.artifactId !== input.artifactId ||
        result.envelope.source.trackId !== input.trackId ||
        result.envelope.requestedRange.startMs !== input.startMs ||
        result.envelope.requestedRange.endMs !== input.endMs ||
        result.receipt.operationId !== request.operationId ||
        result.receipt.output.artifactId !== result.artifact.id ||
        result.receipt.output.contentId !== result.artifact.content.contentId ||
        result.receipt.output.bytes !== result.artifact.content.bytes
      ) throw new Error("Semantic host result changed the child request");
      if (
        result.artifact.origin.kind !== "semantic_media_evidence" ||
        result.artifact.origin.receiptId !== result.receipt.receiptId ||
        result.artifact.origin.receiptContentId !== result.receiptContentId
      ) throw new Error("Semantic host result lost its stored receipt identity");
      return {
        schema: "studio.child-semantic-evidence-tool-result.v1",
        capability: "speech.transcribe",
        operationId: request.operationId,
        artifact: {
          artifactId: result.artifact.id,
          contentId: result.artifact.content.contentId,
          bytes: result.artifact.content.bytes,
        },
        receipt: { receiptId: result.receipt.receiptId, contentId: result.receiptContentId },
        availability: structuredClone(result.envelope.availability),
        observations: structuredClone(result.envelope.observations),
      };
    } catch (error) {
      if (error instanceof ChildSemanticEvidenceBridgeError) throw error;
      throw new ChildSemanticEvidenceBridgeError(
        "operation_rejected",
        "The semantic evidence capability host rejected or failed the bounded current-run request.",
      );
    }
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  response.end(payload);
}

async function requestBody(request: IncomingMessage, maximumBytes = 16 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    bytes += chunk.length;
    if (bytes > maximumBytes) throw new ChildSemanticEvidenceBridgeError("invalid_request", "The semantic bridge request is too large.");
    chunks.push(chunk);
  }
  if (bytes === 0) throw new ChildSemanticEvidenceBridgeError("invalid_request", "The semantic bridge request is empty.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ChildSemanticEvidenceBridgeError("invalid_request", "The semantic bridge request is not valid JSON.");
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

export interface OpenChildSemanticEvidenceBridge {
  endpoint: string;
  token: string;
  manifest: ChildSemanticEvidenceToolManifest;
  close(): Promise<void>;
}

export async function openChildSemanticEvidenceBridge(
  bridge: BoundedChildSemanticEvidenceBridge,
): Promise<OpenChildSemanticEvidenceBridge> {
  const token = randomBytes(32).toString("hex");
  const manifest = bridge.manifest();
  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers.authorization !== `Bearer ${token}`) {
        json(response, 401, { ok: false, error: { code: "bridge_unavailable", message: "The semantic bridge credential is invalid." } });
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/v1/manifest" && url.search === "") {
        json(response, 200, { ok: true, manifest });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/call" && url.search === "") {
        const item = record(await requestBody(request));
        if (!item || !exact(item, ["name", "arguments"]) || item.name !== CHILD_SEMANTIC_EVIDENCE_TOOL) {
          throw new ChildSemanticEvidenceBridgeError("invalid_request", "The semantic bridge call shape is invalid.");
        }
        json(response, 200, { ok: true, result: await bridge.call(item.arguments) });
        return;
      }
      json(response, 404, { ok: false, error: { code: "bridge_unavailable", message: "The semantic bridge endpoint is unavailable." } });
    })().catch((error: unknown) => {
      const safe = error instanceof ChildSemanticEvidenceBridgeError
        ? error
        : new ChildSemanticEvidenceBridgeError("bridge_unavailable", "The semantic bridge failed closed.");
      json(response, safe.code === "invalid_request" ? 400 : 403, { ok: false, error: { code: safe.code, message: safe.message } });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("The semantic bridge did not bind loopback");
  }
  return { endpoint: `http://127.0.0.1:${address.port}`, token, manifest, close: () => closeServer(server) };
}

function bridgeEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password ||
    (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new ChildSemanticEvidenceBridgeError("bridge_unavailable", "The semantic bridge endpoint is not exact loopback HTTP.");
  }
  return url.origin;
}

async function remoteJson(endpoint: string, token: string, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${bridgeEndpoint(endpoint)}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ChildSemanticEvidenceBridgeError("bridge_unavailable", "The semantic bridge could not be reached.");
  }
  const value = await response.json().catch(() => null);
  const item = record(value);
  if (!item || typeof item.ok !== "boolean") throw new ChildSemanticEvidenceBridgeError("bridge_unavailable", "The semantic bridge returned an open response.");
  if (!response.ok || item.ok !== true) {
    const failure = record(item.error);
    const code = failure?.code;
    throw new ChildSemanticEvidenceBridgeError(
      code === "invalid_request" || code === "capability_not_granted" || code === "operation_rejected" ? code : "bridge_unavailable",
      typeof failure?.message === "string" ? failure.message : "The semantic bridge rejected the request.",
    );
  }
  return item;
}

export async function fetchChildSemanticEvidenceManifest(endpoint: string, token: string): Promise<ChildSemanticEvidenceToolManifest> {
  const item = await remoteJson(endpoint, token, "/v1/manifest");
  const manifest = record(item.manifest);
  const tool = manifest ? record(manifest.tool) : null;
  if (!manifest || !exact(manifest, ["schema", "taskId", "agentId", "tool"]) ||
    manifest.schema !== "studio.child-semantic-evidence-tools.v1" ||
    typeof manifest.taskId !== "string" || typeof manifest.agentId !== "string" ||
    !tool || !exact(tool, ["name", "capability", "mediaScope"]) ||
    tool.name !== CHILD_SEMANTIC_EVIDENCE_TOOL || tool.capability !== "speech.transcribe" || !Array.isArray(tool.mediaScope)) {
    throw new ChildSemanticEvidenceBridgeError("bridge_unavailable", "The semantic bridge manifest failed validation.");
  }
  tool.mediaScope.forEach((value) => toolArguments(value));
  return manifest as unknown as ChildSemanticEvidenceToolManifest;
}

export async function callChildSemanticEvidenceBridge(
  endpoint: string,
  token: string,
  args: ChildSpeechTranscribeArguments,
): Promise<ChildSemanticEvidenceToolResult> {
  const item = await remoteJson(endpoint, token, "/v1/call", {
    method: "POST",
    body: JSON.stringify({ name: CHILD_SEMANTIC_EVIDENCE_TOOL, arguments: args }),
  });
  const result = record(item.result);
  const artifact = result ? record(result.artifact) : null;
  const receipt = result ? record(result.receipt) : null;
  const availability = result ? record(result.availability) : null;
  if (!result || !exact(result, ["schema", "capability", "operationId", "artifact", "receipt", "availability", "observations"]) ||
    result.schema !== "studio.child-semantic-evidence-tool-result.v1" || result.capability !== "speech.transcribe" ||
    typeof result.operationId !== "string" || result.operationId.includes("/") || result.operationId.includes("\\") ||
    !artifact || !exact(artifact, ["artifactId", "contentId", "bytes"]) ||
    !/^artifact:[a-f0-9]{64}$/.test(String(artifact.artifactId)) || !/^sha256:[a-f0-9]{64}$/.test(String(artifact.contentId)) ||
    !Number.isSafeInteger(artifact.bytes) || (artifact.bytes as number) <= 0 ||
    !receipt || !exact(receipt, ["receiptId", "contentId"]) || !/^receipt:[a-f0-9]{64}$/.test(String(receipt.receiptId)) ||
    !/^sha256:[a-f0-9]{64}$/.test(String(receipt.contentId)) ||
    !availability || !exact(availability, ["id", "state", "reason", "truncated"]) ||
    !/^availability:[a-f0-9]{64}$/.test(String(availability.id)) || !["available", "empty", "unavailable", "unknown"].includes(String(availability.state)) ||
    !["current_run_hypotheses_returned", "recognizer_returned_no_segments", "recognizer_unavailable", "recognizer_output_unknown", "segment_or_byte_ceiling"].includes(String(availability.reason)) ||
    typeof availability.truncated !== "boolean" ||
    !Array.isArray(result.observations) || result.observations.length > 64) {
    throw new ChildSemanticEvidenceBridgeError("bridge_unavailable", "The semantic bridge result failed validation.");
  }
  const observationIds = new Set<string>();
  for (const [index, value] of result.observations.entries()) {
    const observation = record(value);
    const range = observation ? record(observation.range) : null;
    const observationId = String(observation?.observationId ?? "");
    if (!observation || !exact(observation, ["kind", "observationId", "range", "state", "text"]) ||
      observation.kind !== "timed_transcript_hypothesis" || !/^observation:[a-f0-9]{64}$/.test(String(observation.observationId)) ||
      observationIds.has(observationId) || !range || !exact(range, ["startMs", "endMs"]) ||
      !Number.isSafeInteger(range.startMs) || !Number.isSafeInteger(range.endMs) ||
      (range.startMs as number) < args.startMs || (range.endMs as number) > args.endMs ||
      (range.endMs as number) <= (range.startMs as number) ||
      !["available", "unavailable", "unknown"].includes(String(observation.state)) ||
      ((observation.state === "available") !== (typeof observation.text === "string" && observation.text.length > 0)) ||
      (observation.state !== "available" && observation.text !== null)) {
      throw new ChildSemanticEvidenceBridgeError("bridge_unavailable", `The semantic bridge observation ${index} failed validation.`);
    }
    observationIds.add(observationId);
  }
  if ((availability.state === "available") !== (result.observations.length > 0)) {
    throw new ChildSemanticEvidenceBridgeError("bridge_unavailable", "The semantic bridge availability and observations disagree.");
  }
  if ((availability.truncated as boolean) !== (availability.reason === "segment_or_byte_ceiling")) {
    throw new ChildSemanticEvidenceBridgeError("bridge_unavailable", "The semantic bridge truncation state is inconsistent.");
  }
  return result as unknown as ChildSemanticEvidenceToolResult;
}
