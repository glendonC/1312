import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { canonicalJsonContentId } from "../artifactStore/contentIdentity.ts";
import type { VerifiedOcr } from "../ocrHost.ts";
import {
  OCR_LIMITS,
  type OcrObservations,
  type OcrReceipt,
  type TaskRecord,
} from "../model.ts";
import { validateOcrObservations, validateOcrReceipt } from "../validation/ocr.ts";

export const CHILD_OCR_TOOL_NAME = "media_frames_ocr" as const;
const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_RESPONSE_BYTES = 640 * 1024;

export interface ChildOcrToolArguments {
  frameSamplingOperationId: string;
}

export interface ChildOcrToolManifest {
  schema: "studio.child-ocr-tools.v1";
  taskId: string;
  agentId: string;
  tool: {
    name: typeof CHILD_OCR_TOOL_NAME;
    capability: "media.frames.ocr";
    limits: {
      maxFrames: number;
      maxBoxesPerFrame: number;
      maxTotalBoxes: number;
      maxWallMs: number;
      minConfidence: number;
    };
  };
}

export interface ChildOcrToolResult {
  schema: "studio.child-ocr-tool-result.v1";
  capability: "media.frames.ocr";
  operationId: string;
  observationsArtifactId: string;
  observationsContentId: string;
  receiptArtifactId: string;
  receiptContentId: string;
  observations: OcrObservations;
  receipt: OcrReceipt;
}

export type ChildOcrBridgeErrorCode =
  | "invalid_request"
  | "capability_not_granted"
  | "operation_rejected"
  | "bridge_unavailable";

export class ChildOcrBridgeError extends Error {
  readonly code: ChildOcrBridgeErrorCode;

  constructor(code: ChildOcrBridgeErrorCode, message: string) {
    super(message);
    this.name = "ChildOcrBridgeError";
    this.code = code;
  }
}

export interface ChildOcrHost {
  recognize(request: unknown): Promise<VerifiedOcr>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(item: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(item).length === keys.length && keys.every((key) => key in item);
}

function toolArguments(value: unknown): ChildOcrToolArguments {
  const item = record(value);
  if (!item || !exact(item, ["frameSamplingOperationId"]) ||
      typeof item.frameSamplingOperationId !== "string" || item.frameSamplingOperationId.length === 0 ||
      item.frameSamplingOperationId.length > 256) {
    throw new ChildOcrBridgeError("invalid_request", "The OCR tool accepts one bounded completed frameSamplingOperationId.");
  }
  return { frameSamplingOperationId: item.frameSamplingOperationId };
}

function resultFromVerified(verified: VerifiedOcr, operationId: string, task: TaskRecord): ChildOcrToolResult {
  const observations = validateOcrObservations(verified.observations, "Child OCR bridge observations");
  const receipt = validateOcrReceipt(verified.receipt, "Child OCR bridge receipt");
  if (verified.observationsArtifact.origin.kind !== "ocr_observations" || verified.receiptArtifact.origin.kind !== "ocr_receipt") {
    throw new ChildOcrBridgeError("operation_rejected", "The OCR host returned non-OCR artifact origins.");
  }
  if (
    observations.operationId !== operationId || receipt.operationId !== operationId ||
    receipt.authorization.taskId !== task.id || receipt.authorization.agentId !== task.assignedAgentId ||
    receipt.output.artifactId !== verified.observationsArtifact.id ||
    receipt.output.contentId !== verified.observationsArtifact.content.contentId ||
    receipt.receiptId !== verified.receiptArtifact.origin.receiptId ||
    verified.receiptArtifact.origin.observationsArtifactId !== verified.observationsArtifact.id ||
    observations.nonClaims.dialogueAuthority !== "not_granted"
  ) {
    throw new ChildOcrBridgeError("operation_rejected", "The OCR host returned content outside the injected child grant.");
  }
  return {
    schema: "studio.child-ocr-tool-result.v1",
    capability: "media.frames.ocr",
    operationId,
    observationsArtifactId: verified.observationsArtifact.id,
    observationsContentId: verified.observationsArtifact.content.contentId,
    receiptArtifactId: verified.receiptArtifact.id,
    receiptContentId: verified.receiptArtifact.content.contentId,
    observations,
    receipt,
  };
}

export class BoundedChildOcrBridge {
  private readonly task: TaskRecord;
  private readonly host: ChildOcrHost;
  private readonly nextOperationId: () => string;

  constructor(task: TaskRecord, host: ChildOcrHost, options: { nextOperationId?: () => string } = {}) {
    this.task = structuredClone(task);
    this.host = host;
    this.nextOperationId = options.nextOperationId ?? (() => `operation:child:media-frames-ocr:${randomUUID()}`);
  }

  private grant() {
    const grants = this.task.grants.filter((grant) => grant.capability === "media.frames.ocr");
    if (grants.length !== 1 || !grants[0].ocrScope || grants[0].mediaScope.length !== 1) {
      throw new ChildOcrBridgeError("capability_not_granted", "The child task has no exact OCR grant.");
    }
    return grants[0] as typeof grants[number] & { ocrScope: NonNullable<typeof grants[number]["ocrScope"]> };
  }

  manifest(): ChildOcrToolManifest {
    const limits = this.grant().ocrScope.limits;
    return {
      schema: "studio.child-ocr-tools.v1",
      taskId: this.task.id,
      agentId: this.task.assignedAgentId,
      tool: {
        name: CHILD_OCR_TOOL_NAME,
        capability: "media.frames.ocr",
        limits: {
          maxFrames: limits.maxFrames,
          maxBoxesPerFrame: limits.maxBoxesPerFrame,
          maxTotalBoxes: limits.maxTotalBoxes,
          maxWallMs: limits.maxWallMs,
          minConfidence: limits.minConfidence,
        },
      },
    };
  }

  async call(value: unknown): Promise<ChildOcrToolResult> {
    const input = toolArguments(value);
    const grant = this.grant();
    const operationId = this.nextOperationId();
    try {
      return resultFromVerified(await this.host.recognize({
        operationId,
        taskId: this.task.id,
        agentId: this.task.assignedAgentId,
        grantId: grant.id,
        frameSamplingOperationId: input.frameSamplingOperationId,
      }), operationId, this.task);
    } catch (error) {
      if (error instanceof ChildOcrBridgeError) throw error;
      throw new ChildOcrBridgeError("operation_rejected", "The OCR capability host rejected or failed the bounded request.");
    }
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = `${JSON.stringify(body)}\n`;
  if (Buffer.byteLength(payload) > MAX_RESPONSE_BYTES) {
    const fallback = `${JSON.stringify({ error: { code: "bridge_unavailable", message: "The OCR bridge response exceeded its byte limit." } })}\n`;
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(fallback), "Cache-Control": "no-store" });
    response.end(fallback);
    return;
  }
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload), "Cache-Control": "no-store" });
  response.end(payload);
}

function authorized(request: IncomingMessage, token: string): boolean {
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = Buffer.from(token);
  const candidate = Buffer.from(supplied);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

async function requestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BYTES) throw new ChildOcrBridgeError("invalid_request", "The child OCR bridge request is too large.");
    chunks.push(buffer);
  }
  if (bytes === 0) throw new ChildOcrBridgeError("invalid_request", "The child OCR bridge request is empty.");
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ChildOcrBridgeError("invalid_request", "The child OCR bridge request is not valid JSON."); }
}

export interface OpenChildOcrBridge {
  endpoint: string;
  token: string;
  manifest: ChildOcrToolManifest;
  close(): Promise<void>;
}

export async function openChildOcrBridge(bridge: BoundedChildOcrBridge): Promise<OpenChildOcrBridge> {
  const token = randomBytes(32).toString("hex");
  const manifest = bridge.manifest();
  const server: Server = createServer(async (request, response) => {
    try {
      if (!authorized(request, token)) {
        json(response, 401, { error: { code: "bridge_unavailable", message: "The child OCR bridge bearer is invalid." } });
        return;
      }
      if (request.method === "GET" && request.url === "/manifest") {
        json(response, 200, manifest);
        return;
      }
      if (request.method !== "POST" || request.url !== "/call") {
        json(response, 404, { error: { code: "invalid_request", message: "The child OCR bridge route is unknown." } });
        return;
      }
      const body = record(await requestJson(request));
      if (!body || !exact(body, ["name", "arguments"]) || body.name !== CHILD_OCR_TOOL_NAME) {
        throw new ChildOcrBridgeError("invalid_request", "The child OCR bridge call shape is invalid.");
      }
      json(response, 200, await bridge.call(body.arguments));
    } catch (error) {
      const safe = error instanceof ChildOcrBridgeError ? error : new ChildOcrBridgeError("bridge_unavailable", "The child OCR bridge failed closed.");
      json(response, safe.code === "invalid_request" ? 400 : 409, { error: { code: safe.code, message: safe.message } });
    }
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The child OCR bridge did not bind exact loopback TCP");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    token,
    manifest,
    close: () => new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose())),
  };
}

async function bridgeFetch(endpoint: string, token: string, path: string, init?: RequestInit): Promise<unknown> {
  const url = new URL(path, endpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.origin !== new URL(endpoint).origin) {
    throw new ChildOcrBridgeError("bridge_unavailable", "The child OCR bridge endpoint is not exact loopback HTTP.");
  }
  let response: Response;
  try { response = await fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } }); }
  catch { throw new ChildOcrBridgeError("bridge_unavailable", "The child OCR bridge could not be reached."); }
  const declared = Number(response.headers.get("content-length"));
  if (!Number.isSafeInteger(declared) || declared <= 0 || declared > MAX_RESPONSE_BYTES) {
    throw new ChildOcrBridgeError("bridge_unavailable", "The child OCR bridge returned an invalid byte envelope.");
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length !== declared || body.length > MAX_RESPONSE_BYTES) throw new ChildOcrBridgeError("bridge_unavailable", "The child OCR bridge response changed its byte envelope.");
  let value: unknown;
  try { value = JSON.parse(body.toString("utf8")); }
  catch { throw new ChildOcrBridgeError("bridge_unavailable", "The child OCR bridge returned invalid JSON."); }
  if (!response.ok) {
    const error = record(record(value)?.error);
    throw new ChildOcrBridgeError("operation_rejected", typeof error?.message === "string" ? error.message : "OCR bridge rejected the call.");
  }
  return value;
}

export async function fetchChildOcrManifest(endpoint: string, token: string): Promise<ChildOcrToolManifest> {
  const value = await bridgeFetch(endpoint, token, "/manifest");
  const item = record(value);
  const tool = record(item?.tool);
  const limits = record(tool?.limits);
  if (!item || !exact(item, ["schema", "taskId", "agentId", "tool"]) || item.schema !== "studio.child-ocr-tools.v1" ||
      typeof item.taskId !== "string" || typeof item.agentId !== "string" ||
      !tool || !exact(tool, ["name", "capability", "limits"]) || tool.name !== CHILD_OCR_TOOL_NAME || tool.capability !== "media.frames.ocr" ||
      !limits || !exact(limits, ["maxFrames", "maxBoxesPerFrame", "maxTotalBoxes", "maxWallMs", "minConfidence"]) ||
      limits.maxFrames !== OCR_LIMITS.maxFrames || limits.maxBoxesPerFrame !== OCR_LIMITS.maxBoxesPerFrame ||
      limits.maxTotalBoxes !== OCR_LIMITS.maxTotalBoxes || limits.maxWallMs !== OCR_LIMITS.maxWallMs ||
      limits.minConfidence !== OCR_LIMITS.minConfidence) {
    throw new ChildOcrBridgeError("bridge_unavailable", "The child OCR bridge manifest failed validation.");
  }
  return value as ChildOcrToolManifest;
}

export async function callChildOcrBridge(endpoint: string, token: string, args: ChildOcrToolArguments): Promise<ChildOcrToolResult> {
  toolArguments(args);
  const value = await bridgeFetch(endpoint, token, "/call", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ name: CHILD_OCR_TOOL_NAME, arguments: args }),
  });
  const result = record(value);
  if (!result || !exact(result, ["schema", "capability", "operationId", "observationsArtifactId", "observationsContentId", "receiptArtifactId", "receiptContentId", "observations", "receipt"]) ||
      result.schema !== "studio.child-ocr-tool-result.v1" || result.capability !== "media.frames.ocr" ||
      typeof result.operationId !== "string" || typeof result.observationsArtifactId !== "string" ||
      typeof result.observationsContentId !== "string" || typeof result.receiptArtifactId !== "string" ||
      typeof result.receiptContentId !== "string") {
    throw new ChildOcrBridgeError("bridge_unavailable", "The child OCR bridge result failed validation.");
  }
  const observations = validateOcrObservations(result.observations, "Child OCR client observations");
  const receipt = validateOcrReceipt(result.receipt, "Child OCR client receipt");
  if (observations.operationId !== result.operationId || receipt.operationId !== result.operationId ||
      receipt.output.artifactId !== result.observationsArtifactId || receipt.output.contentId !== result.observationsContentId ||
      canonicalJsonContentId(observations) !== result.observationsContentId ||
      canonicalJsonContentId(receipt) !== result.receiptContentId || observations.nonClaims.dialogueAuthority !== "not_granted") {
    throw new ChildOcrBridgeError("bridge_unavailable", "The child OCR bridge result identities do not agree.");
  }
  return value as ChildOcrToolResult;
}
