import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { FfmpegCapabilityHost } from "../mediaHost.ts";
import type {
  Capability,
  MediaOperationReceipt,
  MediaScope,
  RuntimeArtifact,
  TaskRecord,
} from "../model.ts";
import { assertRuntimeArtifact } from "../validation/artifacts.ts";
import { validateMediaOperationReceipt } from "../validation/media.ts";

export const CHILD_MEDIA_TOOL_NAMES = ["media_extract", "media_seek"] as const;
export type ChildMediaToolName = (typeof CHILD_MEDIA_TOOL_NAMES)[number];

type ChildMediaCapability = Extract<Capability, "media.extract" | "media.seek">;

export interface ChildMediaToolArguments {
  artifactId: string;
  trackId: string;
  startMs: number;
  endMs: number;
}

export interface ChildMediaToolManifestEntry {
  name: ChildMediaToolName;
  capability: ChildMediaCapability;
  mediaScope: MediaScope[];
}

export interface ChildMediaToolManifest {
  schema: "studio.child-media-tools.v1";
  taskId: string;
  agentId: string;
  tools: ChildMediaToolManifestEntry[];
}

export interface ChildMediaToolResult {
  schema: "studio.child-media-tool-result.v1";
  capability: ChildMediaCapability;
  operationId: string;
  outputArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  receipt: MediaOperationReceipt;
}

export type ChildMediaBridgeErrorCode =
  | "invalid_request"
  | "capability_not_granted"
  | "operation_rejected"
  | "bridge_unavailable";

export class ChildMediaBridgeError extends Error {
  readonly code: ChildMediaBridgeErrorCode;

  constructor(code: ChildMediaBridgeErrorCode, message: string) {
    super(message);
    this.name = "ChildMediaBridgeError";
    this.code = code;
  }
}

export interface ChildMediaCapabilityHost {
  extract(request: unknown): Promise<{ artifact: RuntimeArtifact; receipt: MediaOperationReceipt }>;
  seek(request: unknown): Promise<{ artifact: RuntimeArtifact; receipt: MediaOperationReceipt }>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(item: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(item).length === keys.length && keys.every((key) => key in item);
}

function mediaCapability(name: ChildMediaToolName): ChildMediaCapability {
  return name === "media_extract" ? "media.extract" : "media.seek";
}

function mediaToolName(capability: ChildMediaCapability): ChildMediaToolName {
  return capability === "media.extract" ? "media_extract" : "media_seek";
}

function toolArguments(value: unknown): ChildMediaToolArguments {
  const item = record(value);
  if (
    !item ||
    !exact(item, ["artifactId", "trackId", "startMs", "endMs"]) ||
    typeof item.artifactId !== "string" ||
    item.artifactId.length === 0 ||
    typeof item.trackId !== "string" ||
    item.trackId.length === 0 ||
    !Number.isSafeInteger(item.startMs) ||
    !Number.isSafeInteger(item.endMs) ||
    (item.startMs as number) < 0 ||
    (item.endMs as number) <= (item.startMs as number)
  ) {
    throw new ChildMediaBridgeError(
      "invalid_request",
      "The child media tool requires only artifactId, trackId, and a non-empty integer-millisecond range.",
    );
  }
  return {
    artifactId: item.artifactId,
    trackId: item.trackId,
    startMs: item.startMs as number,
    endMs: item.endMs as number,
  };
}

function receiptContentId(
  artifact: RuntimeArtifact,
  receipt: MediaOperationReceipt,
  capability: ChildMediaCapability,
): string {
  if (
    capability === "media.extract" &&
    artifact.origin.kind === "media_operation" &&
    artifact.origin.operationId === receipt.operationId &&
    artifact.origin.receiptId === receipt.receiptId
  ) {
    return artifact.origin.receiptContentId;
  }
  if (
    capability === "media.seek" &&
    artifact.origin.kind === "media_observation" &&
    artifact.origin.operationId === receipt.operationId &&
    artifact.origin.receiptId === receipt.receiptId
  ) {
    return artifact.origin.receiptContentId;
  }
  throw new ChildMediaBridgeError(
    "operation_rejected",
    "The media host returned an artifact with an incompatible receipted origin.",
  );
}

/**
 * Task-bound child adapter. It derives operation identity and injects task/agent identity; the
 * media host remains authoritative for live task status, grant scope, tool budget, source bytes,
 * journal events, artifacts, and receipts.
 */
export class BoundedChildMediaBridge {
  private readonly task: TaskRecord;
  private readonly host: ChildMediaCapabilityHost;
  private readonly nextOperationId: (capability: ChildMediaCapability) => string;

  constructor(
    task: TaskRecord,
    host: ChildMediaCapabilityHost | FfmpegCapabilityHost,
    options: { nextOperationId?: (capability: ChildMediaCapability) => string } = {},
  ) {
    this.task = structuredClone(task);
    this.host = host;
    this.nextOperationId = options.nextOperationId ?? ((capability) =>
      `operation:child:${capability.replace(".", "-")}:${randomUUID()}`);
  }

  manifest(): ChildMediaToolManifest {
    const capabilities = new Set(
      this.task.grants
        .map((grant) => grant.capability)
        .filter((capability): capability is ChildMediaCapability =>
          capability === "media.extract" || capability === "media.seek"),
    );
    return {
      schema: "studio.child-media-tools.v1",
      taskId: this.task.id,
      agentId: this.task.assignedAgentId,
      tools: [...capabilities].sort().map((capability) => ({
        name: mediaToolName(capability),
        capability,
        mediaScope: this.task.grants
          .filter((grant) => grant.capability === capability)
          .flatMap((grant) => structuredClone(grant.mediaScope)),
      })),
    };
  }

  async call(name: ChildMediaToolName, value: unknown): Promise<ChildMediaToolResult> {
    if (!CHILD_MEDIA_TOOL_NAMES.includes(name)) {
      throw new ChildMediaBridgeError("invalid_request", "The requested child media tool is unknown.");
    }
    const capability = mediaCapability(name);
    if (!this.task.grants.some((grant) => grant.capability === capability)) {
      throw new ChildMediaBridgeError(
        "capability_not_granted",
        `The child task has no ${capability} grant.`,
      );
    }
    const input = toolArguments(value);
    const request = {
      operationId: this.nextOperationId(capability),
      taskId: this.task.id,
      agentId: this.task.assignedAgentId,
      ...input,
    };
    try {
      const result = capability === "media.extract"
        ? await this.host.extract(request)
        : await this.host.seek(request);
      assertRuntimeArtifact(result.artifact, "Child media bridge artifact");
      validateMediaOperationReceipt(result.receipt, "Child media bridge receipt", "receipt");
      if (
        result.receipt.capability !== capability ||
        result.receipt.operationId !== request.operationId ||
        result.receipt.authorization.taskId !== this.task.id ||
        result.receipt.authorization.agentId !== this.task.assignedAgentId ||
        result.receipt.request.artifactId !== input.artifactId ||
        result.receipt.request.trackId !== input.trackId ||
        result.receipt.request.startMs !== input.startMs ||
        result.receipt.request.endMs !== input.endMs ||
        !result.receipt.sourceArtifactIds.includes(input.artifactId) ||
        result.artifact.runId !== this.task.runId ||
        result.artifact.producerTaskId !== this.task.id ||
        result.artifact.producerAgentId !== this.task.assignedAgentId ||
        !result.artifact.sourceArtifactIds.includes(input.artifactId) ||
        (result.receipt.capability === "media.extract" && (
          result.artifact.id !== result.receipt.output.artifactId ||
          result.artifact.content.contentId !== result.receipt.output.contentId
        ))
      ) {
        throw new ChildMediaBridgeError(
          "operation_rejected",
          "The media host returned a receipt outside the child bridge request.",
        );
      }
      return {
        schema: "studio.child-media-tool-result.v1",
        capability,
        operationId: request.operationId,
        outputArtifactId: result.artifact.id,
        receiptId: result.receipt.receiptId,
        receiptContentId: receiptContentId(result.artifact, result.receipt, capability),
        receipt: result.receipt,
      };
    } catch (error) {
      if (error instanceof ChildMediaBridgeError) throw error;
      throw new ChildMediaBridgeError(
        "operation_rejected",
        "The existing media capability host rejected or failed the bounded child request.",
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
    if (bytes > maximumBytes) {
      throw new ChildMediaBridgeError("invalid_request", "The child media bridge request is too large.");
    }
    chunks.push(chunk);
  }
  if (bytes === 0) throw new ChildMediaBridgeError("invalid_request", "The child media bridge request is empty.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ChildMediaBridgeError("invalid_request", "The child media bridge request is not valid JSON.");
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

export interface OpenChildMediaBridge {
  endpoint: string;
  token: string;
  manifest: ChildMediaToolManifest;
  close(): Promise<void>;
}

/** Open a task-private, loopback-only RPC seam consumed by the stdio MCP adapter. */
export async function openChildMediaBridge(
  bridge: BoundedChildMediaBridge,
): Promise<OpenChildMediaBridge> {
  const token = randomBytes(32).toString("hex");
  const manifest = bridge.manifest();
  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers.authorization !== `Bearer ${token}`) {
        json(response, 401, {
          ok: false,
          error: { code: "bridge_unavailable", message: "The child media bridge credential is invalid." },
        });
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/v1/manifest" && url.search === "") {
        json(response, 200, { ok: true, manifest });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/call" && url.search === "") {
        const value = await requestBody(request);
        const item = record(value);
        if (!item || !exact(item, ["name", "arguments"]) || !CHILD_MEDIA_TOOL_NAMES.includes(item.name as ChildMediaToolName)) {
          throw new ChildMediaBridgeError("invalid_request", "The child media bridge call shape is invalid.");
        }
        const result = await bridge.call(item.name as ChildMediaToolName, item.arguments);
        json(response, 200, { ok: true, result });
        return;
      }
      json(response, 404, {
        ok: false,
        error: { code: "bridge_unavailable", message: "The child media bridge endpoint is unavailable." },
      });
    })().catch((error: unknown) => {
      const safe = error instanceof ChildMediaBridgeError
        ? error
        : new ChildMediaBridgeError("bridge_unavailable", "The child media bridge failed closed.");
      json(response, safe.code === "invalid_request" ? 400 : 403, {
        ok: false,
        error: { code: safe.code, message: safe.message },
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("The child media bridge did not bind a loopback port");
  }
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    token,
    manifest,
    close: () => closeServer(server),
  };
}

function bridgeEndpoint(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new ChildMediaBridgeError("bridge_unavailable", "The child media bridge endpoint is not exact loopback HTTP.");
  }
  return url.origin;
}

async function remoteJson(endpoint: string, token: string, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${bridgeEndpoint(endpoint)}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ChildMediaBridgeError("bridge_unavailable", "The child media bridge could not be reached.");
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ChildMediaBridgeError("bridge_unavailable", "The child media bridge returned an invalid response.");
  }
  const item = record(value);
  if (!item || typeof item.ok !== "boolean") {
    throw new ChildMediaBridgeError("bridge_unavailable", "The child media bridge returned an open response.");
  }
  if (!response.ok || item.ok !== true) {
    const failure = record(item.error);
    const code = failure?.code;
    throw new ChildMediaBridgeError(
      code === "invalid_request" || code === "capability_not_granted" || code === "operation_rejected"
        ? code
        : "bridge_unavailable",
      typeof failure?.message === "string" ? failure.message : "The child media bridge rejected the request.",
    );
  }
  return item;
}

export async function fetchChildMediaManifest(endpoint: string, token: string): Promise<ChildMediaToolManifest> {
  const item = await remoteJson(endpoint, token, "/v1/manifest");
  const manifest = record(item.manifest);
  if (
    !manifest ||
    !exact(manifest, ["schema", "taskId", "agentId", "tools"]) ||
    manifest.schema !== "studio.child-media-tools.v1" ||
    typeof manifest.taskId !== "string" ||
    typeof manifest.agentId !== "string" ||
    !Array.isArray(manifest.tools)
  ) {
    throw new ChildMediaBridgeError("bridge_unavailable", "The child media bridge manifest failed validation.");
  }
  const names = new Set<string>();
  for (const value of manifest.tools) {
    const tool = record(value);
    if (
      !tool ||
      !exact(tool, ["name", "capability", "mediaScope"]) ||
      !CHILD_MEDIA_TOOL_NAMES.includes(tool.name as ChildMediaToolName) ||
      (tool.capability !== "media.extract" && tool.capability !== "media.seek") ||
      mediaCapability(tool.name as ChildMediaToolName) !== tool.capability ||
      !Array.isArray(tool.mediaScope) ||
      names.has(tool.name as string)
    ) {
      throw new ChildMediaBridgeError("bridge_unavailable", "The child media bridge tool manifest failed validation.");
    }
    names.add(tool.name as string);
    for (const value of tool.mediaScope) {
      const scope = record(value);
      if (
        !scope ||
        !exact(scope, ["artifactId", "trackId", "startMs", "endMs"]) ||
        typeof scope.artifactId !== "string" ||
        scope.artifactId.length === 0 ||
        typeof scope.trackId !== "string" ||
        scope.trackId.length === 0 ||
        !Number.isSafeInteger(scope.startMs) ||
        !Number.isSafeInteger(scope.endMs) ||
        (scope.startMs as number) < 0 ||
        (scope.endMs as number) <= (scope.startMs as number)
      ) {
        throw new ChildMediaBridgeError("bridge_unavailable", "The child media bridge scope failed validation.");
      }
    }
  }
  return manifest as unknown as ChildMediaToolManifest;
}

export async function callChildMediaBridge(
  endpoint: string,
  token: string,
  name: ChildMediaToolName,
  args: ChildMediaToolArguments,
): Promise<ChildMediaToolResult> {
  const item = await remoteJson(endpoint, token, "/v1/call", {
    method: "POST",
    body: JSON.stringify({ name, arguments: args }),
  });
  const result = record(item.result);
  const receipt = result ? record(result.receipt) : null;
  if (
    !result ||
    !exact(result, [
      "schema",
      "capability",
      "operationId",
      "outputArtifactId",
      "receiptId",
      "receiptContentId",
      "receipt",
    ]) ||
    result.schema !== "studio.child-media-tool-result.v1" ||
    (result.capability !== "media.extract" && result.capability !== "media.seek") ||
    typeof result.operationId !== "string" ||
    typeof result.outputArtifactId !== "string" ||
    typeof result.receiptId !== "string" ||
    typeof result.receiptContentId !== "string" ||
    !receipt
  ) {
    throw new ChildMediaBridgeError("bridge_unavailable", "The child media bridge result failed validation.");
  }
  try {
    validateMediaOperationReceipt(receipt, "Child media bridge result", "result.receipt");
  } catch {
    throw new ChildMediaBridgeError("bridge_unavailable", "The child media bridge receipt failed validation.");
  }
  if (
    mediaCapability(name) !== result.capability ||
    receipt.capability !== result.capability ||
    receipt.operationId !== result.operationId ||
    receipt.receiptId !== result.receiptId
  ) {
    throw new ChildMediaBridgeError("bridge_unavailable", "The child media bridge result identities do not agree.");
  }
  return result as unknown as ChildMediaToolResult;
}
