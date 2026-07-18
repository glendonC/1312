import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { canonicalJsonContentId } from "../artifactStore/contentIdentity.ts";
import type { TaskRecord } from "../model.ts";
import {
  VISUAL_TRANSITION_LIMITS,
  type VisualTransitionObservations,
  type VisualTransitionReceipt,
} from "../model/visualTransitions.ts";
import type { VerifiedVisualTransition } from "../visualTransitions/visualTransitionHost.ts";
import {
  validateVisualTransitionObservations,
  validateVisualTransitionReceipt,
} from "../validation/visualTransitions.ts";

export const CHILD_VISUAL_TRANSITION_TOOL_NAME = "media_visual_transitions_analyze" as const;
const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_RESPONSE_BYTES = 640 * 1024;

export interface ChildVisualTransitionToolArguments {
  frameSamplingOperationId: string;
  ocrOperationId: string;
}

export interface ChildVisualTransitionToolManifest {
  schema: "studio.child-visual-transition-tools.v1";
  taskId: string;
  agentId: string;
  tool: {
    name: typeof CHILD_VISUAL_TRANSITION_TOOL_NAME;
    capability: "media.visual-transitions.analyze";
    limits: {
      minFrames: number;
      maxFrames: number;
      gridWidth: number;
      gridHeight: number;
      candidateThresholdPpm: number;
      maxWallMs: number;
    };
  };
}

export interface ChildVisualTransitionToolResult {
  schema: "studio.child-visual-transition-tool-result.v1";
  capability: "media.visual-transitions.analyze";
  operationId: string;
  observationsArtifactId: string;
  observationsContentId: string;
  receiptArtifactId: string;
  receiptContentId: string;
  observations: VisualTransitionObservations;
  receipt: VisualTransitionReceipt;
}

export type ChildVisualTransitionBridgeErrorCode =
  | "invalid_request"
  | "capability_not_granted"
  | "operation_rejected"
  | "bridge_unavailable";

export class ChildVisualTransitionBridgeError extends Error {
  readonly code: ChildVisualTransitionBridgeErrorCode;

  constructor(code: ChildVisualTransitionBridgeErrorCode, message: string) {
    super(message);
    this.name = "ChildVisualTransitionBridgeError";
    this.code = code;
  }
}

export interface ChildVisualTransitionHost {
  analyze(request: unknown): Promise<VerifiedVisualTransition>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(item: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(item).length === keys.length && keys.every((key) => key in item);
}

function toolArguments(value: unknown): ChildVisualTransitionToolArguments {
  const item = record(value);
  if (!item || !exact(item, ["frameSamplingOperationId", "ocrOperationId"]) ||
      typeof item.frameSamplingOperationId !== "string" || item.frameSamplingOperationId.length === 0 || item.frameSamplingOperationId.length > 256 ||
      typeof item.ocrOperationId !== "string" || item.ocrOperationId.length === 0 || item.ocrOperationId.length > 256) {
    throw new ChildVisualTransitionBridgeError("invalid_request", "The visual-transition tool accepts only exact completed frameSamplingOperationId and ocrOperationId inputs.");
  }
  return { frameSamplingOperationId: item.frameSamplingOperationId, ocrOperationId: item.ocrOperationId };
}

function resultFromVerified(verified: VerifiedVisualTransition, operationId: string, task: TaskRecord): ChildVisualTransitionToolResult {
  const observations = validateVisualTransitionObservations(verified.observations, "Child visual-transition bridge observations");
  const receipt = validateVisualTransitionReceipt(verified.receipt, "Child visual-transition bridge receipt");
  if (verified.observationsArtifact.origin.kind !== "visual_transition_observations" ||
      verified.receiptArtifact.origin.kind !== "visual_transition_receipt") {
    throw new ChildVisualTransitionBridgeError("operation_rejected", "The visual-transition host returned non-visual-transition artifact origins.");
  }
  if (
    observations.operationId !== operationId || receipt.operationId !== operationId ||
    receipt.authorization.taskId !== task.id || receipt.authorization.agentId !== task.assignedAgentId ||
    receipt.output.artifactId !== verified.observationsArtifact.id ||
    receipt.output.content.contentId !== verified.observationsArtifact.content.contentId ||
    receipt.receiptId !== verified.receiptArtifact.origin.receiptId ||
    verified.receiptArtifact.origin.observationsArtifactId !== verified.observationsArtifact.id ||
    observations.nonClaims.sceneBoundary !== "not_assessed" || observations.nonClaims.captionAuthority !== "not_granted"
  ) throw new ChildVisualTransitionBridgeError("operation_rejected", "The visual-transition host returned content outside the injected child grant.");
  return {
    schema: "studio.child-visual-transition-tool-result.v1",
    capability: "media.visual-transitions.analyze",
    operationId,
    observationsArtifactId: verified.observationsArtifact.id,
    observationsContentId: verified.observationsArtifact.content.contentId,
    receiptArtifactId: verified.receiptArtifact.id,
    receiptContentId: verified.receiptArtifact.content.contentId,
    observations,
    receipt,
  };
}

export class BoundedChildVisualTransitionBridge {
  private readonly task: TaskRecord;
  private readonly host: ChildVisualTransitionHost;
  private readonly nextOperationId: () => string;

  constructor(task: TaskRecord, host: ChildVisualTransitionHost, options: { nextOperationId?: () => string } = {}) {
    this.task = structuredClone(task);
    this.host = host;
    this.nextOperationId = options.nextOperationId ?? (() => `operation:child:media-visual-transitions:${randomUUID()}`);
  }

  private grant() {
    const grants = this.task.grants.filter((grant) => grant.capability === "media.visual-transitions.analyze");
    if (grants.length !== 1 || !grants[0].visualTransitionScope || grants[0].mediaScope.length !== 1) {
      throw new ChildVisualTransitionBridgeError("capability_not_granted", "The child task has no exact visual-transition grant.");
    }
    return grants[0] as typeof grants[number] & { visualTransitionScope: NonNullable<typeof grants[number]["visualTransitionScope"]> };
  }

  manifest(): ChildVisualTransitionToolManifest {
    const limits = this.grant().visualTransitionScope.limits;
    return {
      schema: "studio.child-visual-transition-tools.v1",
      taskId: this.task.id,
      agentId: this.task.assignedAgentId,
      tool: {
        name: CHILD_VISUAL_TRANSITION_TOOL_NAME,
        capability: "media.visual-transitions.analyze",
        limits: {
          minFrames: limits.minFrames,
          maxFrames: limits.maxFrames,
          gridWidth: limits.gridWidth,
          gridHeight: limits.gridHeight,
          candidateThresholdPpm: limits.candidateThresholdPpm,
          maxWallMs: limits.maxWallMs,
        },
      },
    };
  }

  async call(value: unknown): Promise<ChildVisualTransitionToolResult> {
    const input = toolArguments(value);
    const grant = this.grant();
    const operationId = this.nextOperationId();
    try {
      return resultFromVerified(await this.host.analyze({
        operationId,
        taskId: this.task.id,
        agentId: this.task.assignedAgentId,
        grantId: grant.id,
        frameSamplingOperationId: input.frameSamplingOperationId,
        ocrOperationId: input.ocrOperationId,
      }), operationId, this.task);
    } catch (error) {
      if (error instanceof ChildVisualTransitionBridgeError) throw error;
      throw new ChildVisualTransitionBridgeError("operation_rejected", "The visual-transition capability host rejected or failed the bounded request.");
    }
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = `${JSON.stringify(body)}\n`;
  if (Buffer.byteLength(payload) > MAX_RESPONSE_BYTES) {
    const fallback = `${JSON.stringify({ error: { code: "bridge_unavailable", message: "The visual-transition bridge response exceeded its byte limit." } })}\n`;
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
    if (bytes > MAX_REQUEST_BYTES) throw new ChildVisualTransitionBridgeError("invalid_request", "The child visual-transition bridge request is too large.");
    chunks.push(buffer);
  }
  if (bytes === 0) throw new ChildVisualTransitionBridgeError("invalid_request", "The child visual-transition bridge request is empty.");
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ChildVisualTransitionBridgeError("invalid_request", "The child visual-transition bridge request is not valid JSON."); }
}

export interface OpenChildVisualTransitionBridge {
  endpoint: string;
  token: string;
  manifest: ChildVisualTransitionToolManifest;
  close(): Promise<void>;
}

export async function openChildVisualTransitionBridge(bridge: BoundedChildVisualTransitionBridge): Promise<OpenChildVisualTransitionBridge> {
  const token = randomBytes(32).toString("hex");
  const manifest = bridge.manifest();
  const server: Server = createServer(async (request, response) => {
    try {
      if (!authorized(request, token)) {
        json(response, 401, { error: { code: "bridge_unavailable", message: "The child visual-transition bridge bearer is invalid." } });
        return;
      }
      if (request.method === "GET" && request.url === "/manifest") {
        json(response, 200, manifest);
        return;
      }
      if (request.method !== "POST" || request.url !== "/call") {
        json(response, 404, { error: { code: "invalid_request", message: "The child visual-transition bridge route is unknown." } });
        return;
      }
      const body = record(await requestJson(request));
      if (!body || !exact(body, ["name", "arguments"]) || body.name !== CHILD_VISUAL_TRANSITION_TOOL_NAME) {
        throw new ChildVisualTransitionBridgeError("invalid_request", "The child visual-transition bridge call shape is invalid.");
      }
      json(response, 200, await bridge.call(body.arguments));
    } catch (error) {
      const safe = error instanceof ChildVisualTransitionBridgeError
        ? error
        : new ChildVisualTransitionBridgeError("bridge_unavailable", "The child visual-transition bridge failed closed.");
      json(response, safe.code === "invalid_request" ? 400 : 409, { error: { code: safe.code, message: safe.message } });
    }
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The child visual-transition bridge did not bind exact loopback TCP");
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
    throw new ChildVisualTransitionBridgeError("bridge_unavailable", "The child visual-transition bridge endpoint is not exact loopback HTTP.");
  }
  let response: Response;
  try { response = await fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } }); }
  catch { throw new ChildVisualTransitionBridgeError("bridge_unavailable", "The child visual-transition bridge could not be reached."); }
  const declared = Number(response.headers.get("content-length"));
  if (!Number.isSafeInteger(declared) || declared <= 0 || declared > MAX_RESPONSE_BYTES) {
    throw new ChildVisualTransitionBridgeError("bridge_unavailable", "The child visual-transition bridge returned an invalid byte envelope.");
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length !== declared || body.length > MAX_RESPONSE_BYTES) {
    throw new ChildVisualTransitionBridgeError("bridge_unavailable", "The child visual-transition bridge response changed its byte envelope.");
  }
  let value: unknown;
  try { value = JSON.parse(body.toString("utf8")); }
  catch { throw new ChildVisualTransitionBridgeError("bridge_unavailable", "The child visual-transition bridge returned invalid JSON."); }
  if (!response.ok) {
    const error = record(record(value)?.error);
    throw new ChildVisualTransitionBridgeError("operation_rejected", typeof error?.message === "string" ? error.message : "Visual-transition bridge rejected the call.");
  }
  return value;
}

export async function fetchChildVisualTransitionManifest(endpoint: string, token: string): Promise<ChildVisualTransitionToolManifest> {
  const value = await bridgeFetch(endpoint, token, "/manifest");
  const item = record(value);
  const tool = record(item?.tool);
  const limits = record(tool?.limits);
  if (!item || !exact(item, ["schema", "taskId", "agentId", "tool"]) || item.schema !== "studio.child-visual-transition-tools.v1" ||
      typeof item.taskId !== "string" || typeof item.agentId !== "string" ||
      !tool || !exact(tool, ["name", "capability", "limits"]) || tool.name !== CHILD_VISUAL_TRANSITION_TOOL_NAME || tool.capability !== "media.visual-transitions.analyze" ||
      !limits || !exact(limits, ["minFrames", "maxFrames", "gridWidth", "gridHeight", "candidateThresholdPpm", "maxWallMs"]) ||
      limits.minFrames !== VISUAL_TRANSITION_LIMITS.minFrames || limits.maxFrames !== VISUAL_TRANSITION_LIMITS.maxFrames ||
      limits.gridWidth !== VISUAL_TRANSITION_LIMITS.gridWidth || limits.gridHeight !== VISUAL_TRANSITION_LIMITS.gridHeight ||
      limits.candidateThresholdPpm !== VISUAL_TRANSITION_LIMITS.candidateThresholdPpm || limits.maxWallMs !== VISUAL_TRANSITION_LIMITS.maxWallMs) {
    throw new ChildVisualTransitionBridgeError("bridge_unavailable", "The child visual-transition bridge manifest failed validation.");
  }
  return value as ChildVisualTransitionToolManifest;
}

export async function callChildVisualTransitionBridge(
  endpoint: string,
  token: string,
  args: ChildVisualTransitionToolArguments,
): Promise<ChildVisualTransitionToolResult> {
  toolArguments(args);
  const value = await bridgeFetch(endpoint, token, "/call", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ name: CHILD_VISUAL_TRANSITION_TOOL_NAME, arguments: args }),
  });
  const result = record(value);
  if (!result || !exact(result, ["schema", "capability", "operationId", "observationsArtifactId", "observationsContentId", "receiptArtifactId", "receiptContentId", "observations", "receipt"]) ||
      result.schema !== "studio.child-visual-transition-tool-result.v1" || result.capability !== "media.visual-transitions.analyze" ||
      typeof result.operationId !== "string" || typeof result.observationsArtifactId !== "string" ||
      typeof result.observationsContentId !== "string" || typeof result.receiptArtifactId !== "string" ||
      typeof result.receiptContentId !== "string") {
    throw new ChildVisualTransitionBridgeError("bridge_unavailable", "The child visual-transition bridge result failed validation.");
  }
  const observations = validateVisualTransitionObservations(result.observations, "Child visual-transition client observations");
  const receipt = validateVisualTransitionReceipt(result.receipt, "Child visual-transition client receipt");
  if (
    observations.operationId !== result.operationId || receipt.operationId !== result.operationId ||
    receipt.output.artifactId !== result.observationsArtifactId || receipt.output.content.contentId !== result.observationsContentId ||
    canonicalJsonContentId(observations) !== result.observationsContentId || canonicalJsonContentId(receipt) !== result.receiptContentId ||
    observations.nonClaims.sceneBoundary !== "not_assessed" || observations.nonClaims.captionAuthority !== "not_granted"
  ) throw new ChildVisualTransitionBridgeError("bridge_unavailable", "The child visual-transition bridge result identities do not agree.");
  return value as ChildVisualTransitionToolResult;
}
