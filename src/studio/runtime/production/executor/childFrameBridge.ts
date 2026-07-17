import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { VerifiedFrameSampling } from "../frameAudit.ts";
import type { BoundedFrameSamplingHost } from "../frameHost.ts";
import { inspectRgbPng } from "../frames/png.ts";
import {
  FRAME_SAMPLING_LIMITS,
  type FrameSampleManifest,
  type FrameSamplingReceipt,
  type TaskRecord,
} from "../model.ts";
import { validateFrameSampleManifest, validateFrameSamplingReceipt } from "../validation/frames.ts";

export const CHILD_FRAME_TOOL_NAME = "media_frames_sample" as const;
const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;

export interface ChildFrameToolArguments {
  timestampsMs: number[];
}

export interface ChildFrameToolManifest {
  schema: "studio.child-frame-tools.v1";
  taskId: string;
  agentId: string;
  tool: {
    name: typeof CHILD_FRAME_TOOL_NAME;
    capability: "media.frames.sample";
    grantedRange: { startMs: number; endMs: number };
    limits: { maxFrames: number; maxTotalFrameBytes: number };
  };
}

export interface ChildFrameBytes {
  frameId: string;
  artifactId: string;
  contentId: string;
  bytes: number;
  mimeType: "image/png";
  dataBase64: string;
}

export interface ChildFrameToolResult {
  schema: "studio.child-frame-tool-result.v1";
  capability: "media.frames.sample";
  operationId: string;
  manifestArtifactId: string;
  receiptArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  manifest: FrameSampleManifest;
  receipt: FrameSamplingReceipt;
  frames: ChildFrameBytes[];
}

export type ChildFrameBridgeErrorCode =
  | "invalid_request"
  | "capability_not_granted"
  | "operation_rejected"
  | "bridge_unavailable";

export class ChildFrameBridgeError extends Error {
  readonly code: ChildFrameBridgeErrorCode;

  constructor(code: ChildFrameBridgeErrorCode, message: string) {
    super(message);
    this.name = "ChildFrameBridgeError";
    this.code = code;
  }
}

export interface ChildFrameSamplingHost {
  sample(request: unknown): Promise<VerifiedFrameSampling>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(item: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(item).length === keys.length && keys.every((key) => key in item);
}

function toolArguments(value: unknown): ChildFrameToolArguments {
  const item = record(value);
  const timestamps = item?.timestampsMs;
  if (
    !item || !exact(item, ["timestampsMs"]) || !Array.isArray(timestamps) ||
    timestamps.length < 1 || timestamps.length > FRAME_SAMPLING_LIMITS.maxFrames ||
    timestamps.some((timestamp) => !Number.isSafeInteger(timestamp) || timestamp < 0) ||
    timestamps.some((timestamp, index) => index > 0 && timestamp <= timestamps[index - 1])
  ) {
    throw new ChildFrameBridgeError(
      "invalid_request",
      `The frame tool accepts only 1-${FRAME_SAMPLING_LIMITS.maxFrames} unique, increasing integer timestampsMs.`,
    );
  }
  return { timestampsMs: [...timestamps] as number[] };
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function resultFromVerified(
  verified: VerifiedFrameSampling,
  operationId: string,
  task: TaskRecord,
  timestampsMs: number[],
): ChildFrameToolResult {
  const { manifest, receipt } = verified;
  validateFrameSampleManifest(manifest, "Child frame bridge manifest");
  validateFrameSamplingReceipt(receipt, "Child frame bridge receipt");
  if (
    receipt.operationId !== operationId || manifest.operationId !== operationId ||
    receipt.authorization.taskId !== task.id || receipt.authorization.agentId !== task.assignedAgentId ||
    JSON.stringify(receipt.request.requestedTimestampsMs) !== JSON.stringify(timestampsMs) ||
    JSON.stringify(manifest.requestedTimestampsMs) !== JSON.stringify(timestampsMs) ||
    verified.frames.length !== timestampsMs.length ||
    receipt.output.manifestArtifactId !== verified.manifestArtifact.id ||
    receipt.output.manifestContentId !== verified.manifestArtifact.content.contentId ||
    verified.receiptArtifact.origin.kind !== "frame_sampling_receipt" ||
    verified.receiptArtifact.origin.receiptId !== receipt.receiptId ||
    verified.receiptArtifact.origin.manifestArtifactId !== verified.manifestArtifact.id ||
    verified.manifestArtifact.origin.kind !== "frame_sample_manifest" ||
    verified.manifestArtifact.origin.receiptContentId !== verified.receiptArtifact.content.contentId
  ) {
    throw new ChildFrameBridgeError("operation_rejected", "The frame host returned content outside the injected child grant.");
  }
  const frames = verified.frames.map(({ identity, artifact, bytes }, index): ChildFrameBytes => {
    const dimensions = inspectRgbPng(bytes);
    if (
      identity.index !== index || identity.requestedTimestampMs !== timestampsMs[index] ||
      identity.artifactId !== artifact.id || identity.content.contentId !== artifact.content.contentId ||
      identity.content.bytes !== bytes.length || sha256(bytes) !== identity.content.contentId ||
      dimensions.width !== identity.width || dimensions.height !== identity.height
    ) {
      throw new ChildFrameBridgeError("operation_rejected", `The frame host returned unverifiable image content at index ${index}.`);
    }
    return {
      frameId: identity.frameId,
      artifactId: artifact.id,
      contentId: identity.content.contentId,
      bytes: bytes.length,
      mimeType: "image/png",
      dataBase64: bytes.toString("base64"),
    };
  });
  return {
    schema: "studio.child-frame-tool-result.v1",
    capability: "media.frames.sample",
    operationId,
    manifestArtifactId: verified.manifestArtifact.id,
    receiptArtifactId: verified.receiptArtifact.id,
    receiptId: receipt.receiptId,
    receiptContentId: verified.receiptArtifact.content.contentId,
    manifest,
    receipt,
    frames,
  };
}

export class BoundedChildFrameBridge {
  private readonly task: TaskRecord;
  private readonly host: ChildFrameSamplingHost;
  private readonly nextOperationId: () => string;

  constructor(
    task: TaskRecord,
    host: ChildFrameSamplingHost | BoundedFrameSamplingHost,
    options: { nextOperationId?: () => string } = {},
  ) {
    this.task = structuredClone(task);
    this.host = host;
    this.nextOperationId = options.nextOperationId ?? (() => `operation:child:media-frames-sample:${randomUUID()}`);
  }

  private grant() {
    const grants = this.task.grants.filter((grant) => grant.capability === "media.frames.sample");
    if (grants.length !== 1 || !grants[0].frameScope || grants[0].mediaScope.length !== 1) {
      throw new ChildFrameBridgeError("capability_not_granted", "The child task has no exact frame-sampling grant.");
    }
    return grants[0] as typeof grants[number] & { frameScope: NonNullable<typeof grants[number]["frameScope"]> };
  }

  manifest(): ChildFrameToolManifest {
    const grant = this.grant();
    const scope = grant.mediaScope[0];
    return {
      schema: "studio.child-frame-tools.v1",
      taskId: this.task.id,
      agentId: this.task.assignedAgentId,
      tool: {
        name: CHILD_FRAME_TOOL_NAME,
        capability: "media.frames.sample",
        grantedRange: { startMs: scope.startMs, endMs: scope.endMs },
        limits: {
          maxFrames: grant.frameScope.limits.maxFrames,
          maxTotalFrameBytes: grant.frameScope.limits.maxTotalFrameBytes,
        },
      },
    };
  }

  async call(value: unknown): Promise<ChildFrameToolResult> {
    const input = toolArguments(value);
    const grant = this.grant();
    const scope = grant.mediaScope[0];
    if (input.timestampsMs.some((timestamp) => timestamp < scope.startMs || timestamp >= scope.endMs)) {
      throw new ChildFrameBridgeError("invalid_request", "Frame timestamps escape the task-private granted range.");
    }
    const operationId = this.nextOperationId();
    try {
      const verified = await this.host.sample({
        operationId,
        taskId: this.task.id,
        agentId: this.task.assignedAgentId,
        grantId: grant.id,
        requestedTimestampsMs: input.timestampsMs,
      });
      return resultFromVerified(verified, operationId, this.task, input.timestampsMs);
    } catch (error) {
      if (error instanceof ChildFrameBridgeError) throw error;
      throw new ChildFrameBridgeError("operation_rejected", "The frame capability host rejected or failed the bounded request.");
    }
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = `${JSON.stringify(body)}\n`;
  if (Buffer.byteLength(payload) > MAX_RESPONSE_BYTES) {
    const fallback = `${JSON.stringify({ error: { code: "bridge_unavailable", message: "The frame bridge response exceeded its byte limit." } })}\n`;
    response.writeHead(500, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(fallback),
      "Cache-Control": "no-store",
    });
    response.end(fallback);
    return;
  }
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
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
    if (bytes > MAX_REQUEST_BYTES) {
      throw new ChildFrameBridgeError("invalid_request", "The child frame bridge request is too large.");
    }
    chunks.push(buffer);
  }
  if (bytes === 0) throw new ChildFrameBridgeError("invalid_request", "The child frame bridge request is empty.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ChildFrameBridgeError("invalid_request", "The child frame bridge request is not valid JSON.");
  }
}

export interface OpenChildFrameBridge {
  endpoint: string;
  token: string;
  manifest: ChildFrameToolManifest;
  close(): Promise<void>;
}

export async function openChildFrameBridge(bridge: BoundedChildFrameBridge): Promise<OpenChildFrameBridge> {
  const token = randomBytes(32).toString("hex");
  const manifest = bridge.manifest();
  const server: Server = createServer(async (request, response) => {
    try {
      if (!authorized(request, token)) {
        json(response, 401, { error: { code: "bridge_unavailable", message: "The child frame bridge bearer is invalid." } });
        return;
      }
      if (request.method === "GET" && request.url === "/manifest") {
        json(response, 200, manifest);
        return;
      }
      if (request.method !== "POST" || request.url !== "/call") {
        json(response, 404, { error: { code: "invalid_request", message: "The child frame bridge route is unknown." } });
        return;
      }
      const body = record(await requestJson(request));
      if (!body || !exact(body, ["name", "arguments"]) || body.name !== CHILD_FRAME_TOOL_NAME) {
        throw new ChildFrameBridgeError("invalid_request", "The child frame bridge call shape is invalid.");
      }
      json(response, 200, await bridge.call(body.arguments));
    } catch (error) {
      const safe = error instanceof ChildFrameBridgeError
        ? error
        : new ChildFrameBridgeError("bridge_unavailable", "The child frame bridge failed closed.");
      json(response, safe.code === "invalid_request" ? 400 : 409, { error: { code: safe.code, message: safe.message } });
    }
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The child frame bridge did not bind exact loopback TCP");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    token,
    manifest,
    close: () => new Promise<void>((resolveClose, rejectClose) =>
      server.close((error) => error ? rejectClose(error) : resolveClose())),
  };
}

async function bridgeFetch(endpoint: string, token: string, path: string, init?: RequestInit): Promise<unknown> {
  const url = new URL(path, endpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.origin !== new URL(endpoint).origin) {
    throw new ChildFrameBridgeError("bridge_unavailable", "The child frame bridge endpoint is not exact loopback HTTP.");
  }
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ChildFrameBridgeError("bridge_unavailable", "The child frame bridge could not be reached.");
  }
  const declared = Number(response.headers.get("content-length"));
  if (!Number.isSafeInteger(declared) || declared <= 0 || declared > MAX_RESPONSE_BYTES) {
    throw new ChildFrameBridgeError("bridge_unavailable", "The child frame bridge returned an invalid byte envelope.");
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length !== declared || body.length > MAX_RESPONSE_BYTES) {
    throw new ChildFrameBridgeError("bridge_unavailable", "The child frame bridge response changed its byte envelope.");
  }
  let value: unknown;
  try {
    value = JSON.parse(body.toString("utf8"));
  } catch {
    throw new ChildFrameBridgeError("bridge_unavailable", "The child frame bridge returned invalid JSON.");
  }
  if (!response.ok) {
    const error = record(record(value)?.error);
    throw new ChildFrameBridgeError("operation_rejected", typeof error?.message === "string" ? error.message : "Frame bridge rejected the call.");
  }
  return value;
}

export async function fetchChildFrameManifest(endpoint: string, token: string): Promise<ChildFrameToolManifest> {
  const value = await bridgeFetch(endpoint, token, "/manifest");
  const item = record(value);
  const tool = record(item?.tool);
  const range = record(tool?.grantedRange);
  const limits = record(tool?.limits);
  if (
    !item || !exact(item, ["schema", "taskId", "agentId", "tool"]) || item.schema !== "studio.child-frame-tools.v1" ||
    typeof item.taskId !== "string" || typeof item.agentId !== "string" ||
    !tool || !exact(tool, ["name", "capability", "grantedRange", "limits"]) ||
    tool.name !== CHILD_FRAME_TOOL_NAME || tool.capability !== "media.frames.sample" ||
    !range || !exact(range, ["startMs", "endMs"]) || !Number.isSafeInteger(range.startMs) || !Number.isSafeInteger(range.endMs) ||
    !limits || !exact(limits, ["maxFrames", "maxTotalFrameBytes"]) ||
    limits.maxFrames !== FRAME_SAMPLING_LIMITS.maxFrames || limits.maxTotalFrameBytes !== FRAME_SAMPLING_LIMITS.maxTotalFrameBytes
  ) {
    throw new ChildFrameBridgeError("bridge_unavailable", "The child frame bridge manifest failed validation.");
  }
  return value as ChildFrameToolManifest;
}

export async function callChildFrameBridge(
  endpoint: string,
  token: string,
  args: ChildFrameToolArguments,
): Promise<ChildFrameToolResult> {
  toolArguments(args);
  const value = await bridgeFetch(endpoint, token, "/call", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ name: CHILD_FRAME_TOOL_NAME, arguments: args }),
  });
  const result = record(value);
  if (
    !result || !exact(result, [
      "schema", "capability", "operationId", "manifestArtifactId", "receiptArtifactId",
      "receiptId", "receiptContentId", "manifest", "receipt", "frames",
    ]) ||
    result.schema !== "studio.child-frame-tool-result.v1" || result.capability !== "media.frames.sample" ||
    typeof result.operationId !== "string" || typeof result.manifestArtifactId !== "string" ||
    typeof result.receiptArtifactId !== "string" || typeof result.receiptId !== "string" ||
    typeof result.receiptContentId !== "string" || !Array.isArray(result.frames)
  ) {
    throw new ChildFrameBridgeError("bridge_unavailable", "The child frame bridge result failed validation.");
  }
  const manifest = validateFrameSampleManifest(result.manifest, "Child frame client manifest");
  const receipt = validateFrameSamplingReceipt(result.receipt, "Child frame client receipt");
  if (
    manifest.operationId !== result.operationId || receipt.operationId !== result.operationId ||
    receipt.receiptId !== result.receiptId || receipt.output.manifestArtifactId !== result.manifestArtifactId ||
    JSON.stringify(manifest.frames) !== JSON.stringify(receipt.output.frames) ||
    result.frames.length !== manifest.frames.length
  ) {
    throw new ChildFrameBridgeError("bridge_unavailable", "The child frame bridge result identities do not agree.");
  }
  for (const [index, candidate] of result.frames.entries()) {
    const frame = record(candidate);
    const identity = manifest.frames[index];
    if (
      !frame || !exact(frame, ["frameId", "artifactId", "contentId", "bytes", "mimeType", "dataBase64"]) ||
      frame.frameId !== identity.frameId || frame.artifactId !== identity.artifactId ||
      frame.contentId !== identity.content.contentId || frame.bytes !== identity.content.bytes ||
      frame.mimeType !== "image/png" || typeof frame.dataBase64 !== "string"
    ) {
      throw new ChildFrameBridgeError("bridge_unavailable", `The child frame bridge image ${index} changed identity.`);
    }
    const bytes = Buffer.from(frame.dataBase64, "base64");
    const dimensions = inspectRgbPng(bytes);
    if (
      bytes.toString("base64") !== frame.dataBase64 || bytes.length !== identity.content.bytes ||
      sha256(bytes) !== identity.content.contentId ||
      dimensions.width !== identity.width || dimensions.height !== identity.height
    ) {
      throw new ChildFrameBridgeError("bridge_unavailable", `The child frame bridge image ${index} failed byte verification.`);
    }
  }
  return value as ChildFrameToolResult;
}
