import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { canonicalJsonContentId } from "../artifactStore/contentIdentity.ts";
import type { VerifiedSpeakerOverlap } from "../speakerHost.ts";
import {
  SPEAKER_OVERLAP_LIMITS,
  type SpeakerOverlapObservations,
  type SpeakerOverlapReceipt,
  type TaskRecord,
} from "../model.ts";
import { validateSpeakerOverlapObservations, validateSpeakerOverlapReceipt } from "../validation/speakers.ts";

export const CHILD_SPEAKER_TOOL_NAME = "media_speakers_analyze" as const;
const MAX_REQUEST_BYTES = 1024;
const MAX_RESPONSE_BYTES = SPEAKER_OVERLAP_LIMITS.maxObservationBytes + SPEAKER_OVERLAP_LIMITS.maxReceiptBytes + 16 * 1024;

export type ChildSpeakerToolArguments = Record<string, never>;

export interface ChildSpeakerToolManifest {
  schema: "studio.child-speaker-tools.v1";
  taskId: string;
  agentId: string;
  tool: {
    name: typeof CHILD_SPEAKER_TOOL_NAME;
    capability: "media.speakers.analyze";
    limits: {
      maxRangeMs: number;
      maxTurns: number;
      maxAccountingCells: number;
      maxLocalSpeakerClusters: number;
      maxWallMs: number;
      maxCalls: number;
    };
  };
}

export interface ChildSpeakerToolResult {
  schema: "studio.child-speaker-tool-result.v1";
  capability: "media.speakers.analyze";
  operationId: string;
  observationsArtifactId: string;
  observationsContentId: string;
  receiptArtifactId: string;
  receiptContentId: string;
  observations: SpeakerOverlapObservations;
  receipt: SpeakerOverlapReceipt;
}

export class ChildSpeakerBridgeError extends Error {
  readonly code: "invalid_request" | "capability_not_granted" | "operation_rejected" | "bridge_unavailable";

  constructor(code: ChildSpeakerBridgeError["code"], message: string) {
    super(message);
    this.name = "ChildSpeakerBridgeError";
    this.code = code;
  }
}

export interface ChildSpeakerHost {
  analyze(request: unknown): Promise<VerifiedSpeakerOverlap>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function exact(item: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(item).length === keys.length && keys.every((key) => key in item);
}

function toolArguments(value: unknown): ChildSpeakerToolArguments {
  const item = record(value);
  if (!item || !exact(item, [])) {
    throw new ChildSpeakerBridgeError("invalid_request", "The speaker/overlap tool accepts only the closed empty object; the host injects source, track, and range.");
  }
  return {};
}

function resultFromVerified(verified: VerifiedSpeakerOverlap, operationId: string, task: TaskRecord): ChildSpeakerToolResult {
  const observations = validateSpeakerOverlapObservations(verified.observations, "Child speaker bridge observations");
  const receipt = validateSpeakerOverlapReceipt(verified.receipt, "Child speaker bridge receipt");
  if (verified.observationsArtifact.origin.kind !== "speaker_overlap_observations" || verified.receiptArtifact.origin.kind !== "speaker_overlap_receipt") {
    throw new ChildSpeakerBridgeError("operation_rejected", "The speaker host returned non-speaker artifact origins.");
  }
  if (
    observations.operationId !== operationId || receipt.operationId !== operationId ||
    receipt.authorization.taskId !== task.id || receipt.authorization.agentId !== task.assignedAgentId ||
    receipt.output.artifactId !== verified.observationsArtifact.id ||
    receipt.output.contentId !== verified.observationsArtifact.content.contentId ||
    receipt.receiptId !== verified.receiptArtifact.origin.receiptId ||
    verified.receiptArtifact.origin.observationsArtifactId !== verified.observationsArtifact.id ||
    observations.nonClaims.dialogueAuthority !== "not_granted" ||
    observations.nonClaims.personIdentity !== "not_assessed" || observations.nonClaims.crossRunIdentity !== "not_available"
  ) throw new ChildSpeakerBridgeError("operation_rejected", "The speaker host returned content outside the injected child grant.");
  return {
    schema: "studio.child-speaker-tool-result.v1",
    capability: "media.speakers.analyze",
    operationId,
    observationsArtifactId: verified.observationsArtifact.id,
    observationsContentId: verified.observationsArtifact.content.contentId,
    receiptArtifactId: verified.receiptArtifact.id,
    receiptContentId: verified.receiptArtifact.content.contentId,
    observations,
    receipt,
  };
}

export class BoundedChildSpeakerBridge {
  private readonly task: TaskRecord;
  private readonly host: ChildSpeakerHost;
  private readonly nextOperationId: () => string;

  constructor(task: TaskRecord, host: ChildSpeakerHost, options: { nextOperationId?: () => string } = {}) {
    this.task = structuredClone(task);
    this.host = host;
    this.nextOperationId = options.nextOperationId ?? (() => `operation:child:media-speakers-analyze:${randomUUID()}`);
  }

  private grant() {
    const grants = this.task.grants.filter((grant) => grant.capability === "media.speakers.analyze");
    if (grants.length !== 1 || !grants[0].speakerScope || grants[0].mediaScope.length !== 1) {
      throw new ChildSpeakerBridgeError("capability_not_granted", "The child task has no exact speaker/overlap grant.");
    }
    return grants[0] as typeof grants[number] & { speakerScope: NonNullable<typeof grants[number]["speakerScope"]> };
  }

  manifest(): ChildSpeakerToolManifest {
    const limits = this.grant().speakerScope.limits;
    return {
      schema: "studio.child-speaker-tools.v1",
      taskId: this.task.id,
      agentId: this.task.assignedAgentId,
      tool: {
        name: CHILD_SPEAKER_TOOL_NAME,
        capability: "media.speakers.analyze",
        limits: {
          maxRangeMs: limits.maxRangeMs,
          maxTurns: limits.maxTurns,
          maxAccountingCells: limits.maxAccountingCells,
          maxLocalSpeakerClusters: limits.maxLocalSpeakerClusters,
          maxWallMs: limits.maxWallMs,
          maxCalls: limits.maxCalls,
        },
      },
    };
  }

  async call(value: unknown): Promise<ChildSpeakerToolResult> {
    toolArguments(value);
    const grant = this.grant();
    const operationId = this.nextOperationId();
    try {
      return resultFromVerified(await this.host.analyze({
        operationId,
        taskId: this.task.id,
        agentId: this.task.assignedAgentId,
        grantId: grant.id,
      }), operationId, this.task);
    } catch (error) {
      if (error instanceof ChildSpeakerBridgeError) throw error;
      throw new ChildSpeakerBridgeError("operation_rejected", "The speaker/overlap host rejected or failed the bounded request.");
    }
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = `${JSON.stringify(body)}\n`;
  if (Buffer.byteLength(payload) > MAX_RESPONSE_BYTES) {
    const fallback = `${JSON.stringify({ error: { code: "bridge_unavailable", message: "The speaker bridge response exceeded its byte limit." } })}\n`;
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(fallback), "Cache-Control": "no-store" });
    response.end(fallback);
    return;
  }
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload), "Cache-Control": "no-store" });
  response.end(payload);
}

function authorized(request: IncomingMessage, token: string): boolean {
  const expected = Buffer.from(token);
  const candidate = Buffer.from(request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

async function requestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BYTES) throw new ChildSpeakerBridgeError("invalid_request", "The child speaker bridge request is too large.");
    chunks.push(buffer);
  }
  if (bytes === 0) throw new ChildSpeakerBridgeError("invalid_request", "The child speaker bridge request is empty.");
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ChildSpeakerBridgeError("invalid_request", "The child speaker bridge request is not valid JSON."); }
}

export interface OpenChildSpeakerBridge {
  endpoint: string;
  token: string;
  manifest: ChildSpeakerToolManifest;
  close(): Promise<void>;
}

export async function openChildSpeakerBridge(bridge: BoundedChildSpeakerBridge): Promise<OpenChildSpeakerBridge> {
  const token = randomBytes(32).toString("hex");
  const manifest = bridge.manifest();
  const server: Server = createServer(async (request, response) => {
    try {
      if (!authorized(request, token)) return json(response, 401, { error: { code: "bridge_unavailable", message: "The child speaker bridge bearer is invalid." } });
      if (request.method === "GET" && request.url === "/manifest") return json(response, 200, manifest);
      if (request.method !== "POST" || request.url !== "/call") return json(response, 404, { error: { code: "invalid_request", message: "The child speaker bridge route is unknown." } });
      const body = record(await requestJson(request));
      if (!body || !exact(body, ["name", "arguments"]) || body.name !== CHILD_SPEAKER_TOOL_NAME) {
        throw new ChildSpeakerBridgeError("invalid_request", "The child speaker bridge call shape is invalid.");
      }
      json(response, 200, await bridge.call(body.arguments));
    } catch (error) {
      const safe = error instanceof ChildSpeakerBridgeError ? error : new ChildSpeakerBridgeError("bridge_unavailable", "The child speaker bridge failed closed.");
      json(response, safe.code === "invalid_request" ? 400 : 409, { error: { code: safe.code, message: safe.message } });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The child speaker bridge did not bind exact loopback TCP");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    token,
    manifest,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function bridgeFetch(endpoint: string, token: string, path: string, init?: RequestInit): Promise<unknown> {
  const url = new URL(path, endpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.origin !== new URL(endpoint).origin) {
    throw new ChildSpeakerBridgeError("bridge_unavailable", "The child speaker bridge endpoint is not exact loopback HTTP.");
  }
  let response: Response;
  try { response = await fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } }); }
  catch { throw new ChildSpeakerBridgeError("bridge_unavailable", "The child speaker bridge could not be reached."); }
  const declared = Number(response.headers.get("content-length"));
  if (!Number.isSafeInteger(declared) || declared <= 0 || declared > MAX_RESPONSE_BYTES) throw new ChildSpeakerBridgeError("bridge_unavailable", "The child speaker bridge returned an invalid byte envelope.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== declared) throw new ChildSpeakerBridgeError("bridge_unavailable", "The child speaker bridge changed its byte envelope.");
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new ChildSpeakerBridgeError("bridge_unavailable", "The child speaker bridge returned invalid JSON."); }
  if (!response.ok) {
    const error = record(record(value)?.error);
    throw new ChildSpeakerBridgeError("operation_rejected", typeof error?.message === "string" ? error.message : "Speaker bridge rejected the call.");
  }
  return value;
}

export async function fetchChildSpeakerManifest(endpoint: string, token: string): Promise<ChildSpeakerToolManifest> {
  const value = await bridgeFetch(endpoint, token, "/manifest");
  const item = record(value);
  const tool = record(item?.tool);
  const limits = record(tool?.limits);
  if (!item || !exact(item, ["schema", "taskId", "agentId", "tool"]) || item.schema !== "studio.child-speaker-tools.v1" ||
      typeof item.taskId !== "string" || typeof item.agentId !== "string" || !tool ||
      !exact(tool, ["name", "capability", "limits"]) || tool.name !== CHILD_SPEAKER_TOOL_NAME || tool.capability !== "media.speakers.analyze" ||
      !limits || !exact(limits, ["maxRangeMs", "maxTurns", "maxAccountingCells", "maxLocalSpeakerClusters", "maxWallMs", "maxCalls"]) ||
      limits.maxRangeMs !== SPEAKER_OVERLAP_LIMITS.maxRangeMs || limits.maxTurns !== SPEAKER_OVERLAP_LIMITS.maxTurns ||
      limits.maxAccountingCells !== SPEAKER_OVERLAP_LIMITS.maxAccountingCells ||
      limits.maxLocalSpeakerClusters !== SPEAKER_OVERLAP_LIMITS.maxLocalSpeakerClusters ||
      limits.maxWallMs !== SPEAKER_OVERLAP_LIMITS.maxWallMs || limits.maxCalls !== SPEAKER_OVERLAP_LIMITS.maxCalls) {
    throw new ChildSpeakerBridgeError("bridge_unavailable", "The child speaker bridge manifest failed validation.");
  }
  return value as ChildSpeakerToolManifest;
}

export async function callChildSpeakerBridge(endpoint: string, token: string, args: ChildSpeakerToolArguments): Promise<ChildSpeakerToolResult> {
  toolArguments(args);
  const value = await bridgeFetch(endpoint, token, "/call", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ name: CHILD_SPEAKER_TOOL_NAME, arguments: args }),
  });
  const result = record(value);
  if (!result || !exact(result, ["schema", "capability", "operationId", "observationsArtifactId", "observationsContentId", "receiptArtifactId", "receiptContentId", "observations", "receipt"]) ||
      result.schema !== "studio.child-speaker-tool-result.v1" || result.capability !== "media.speakers.analyze" ||
      typeof result.operationId !== "string" || typeof result.observationsArtifactId !== "string" || typeof result.observationsContentId !== "string" ||
      typeof result.receiptArtifactId !== "string" || typeof result.receiptContentId !== "string") {
    throw new ChildSpeakerBridgeError("bridge_unavailable", "The child speaker bridge result failed validation.");
  }
  const observations = validateSpeakerOverlapObservations(result.observations, "Child speaker client observations");
  const receipt = validateSpeakerOverlapReceipt(result.receipt, "Child speaker client receipt");
  if (observations.operationId !== result.operationId || receipt.operationId !== result.operationId ||
      receipt.output.artifactId !== result.observationsArtifactId || receipt.output.contentId !== result.observationsContentId ||
      canonicalJsonContentId(observations) !== result.observationsContentId || canonicalJsonContentId(receipt) !== result.receiptContentId ||
      observations.nonClaims.dialogueAuthority !== "not_granted") {
    throw new ChildSpeakerBridgeError("bridge_unavailable", "The child speaker bridge result identities do not agree.");
  }
  return value as ChildSpeakerToolResult;
}
