import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { canonicalJsonContentId, canonicalSha256 } from "../artifactStore.ts";
import type { BoundedEvidenceReadHost, EvidenceReadHostResult } from "../evidenceHost.ts";
import type {
  EvidenceReadReceipt,
  EvidenceReadScope,
  TaskRecord,
} from "../model.ts";
import { validateEvidenceReadReceipt } from "../validation/evidence.ts";
import {
  MAX_EVIDENCE_READ_BYTES,
  MAX_EVIDENCE_READ_ITEMS,
} from "../validation/scheduling.ts";

export const CHILD_EVIDENCE_TOOL_NAME = "evidence_read" as const;

export interface ChildEvidenceToolManifest {
  schema: "studio.child-evidence-tools.v1";
  taskId: string;
  agentId: string;
  tool: {
    name: typeof CHILD_EVIDENCE_TOOL_NAME;
    capability: "evidence.read";
    evidenceScope: EvidenceReadScope[];
  };
}

export interface ChildEvidenceToolResult {
  schema: "studio.child-evidence-tool-result.v1";
  capability: "evidence.read";
  operationId: string;
  inputArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  receipt: EvidenceReadReceipt;
}

type ErrorCode = "invalid_request" | "capability_not_granted" | "operation_rejected" | "bridge_unavailable";

export class ChildEvidenceBridgeError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ChildEvidenceBridgeError";
    this.code = code;
  }
}

export interface ChildEvidenceReadHost {
  read(request: unknown): Promise<EvidenceReadHostResult>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(item: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(item).length === keys.length && keys.every((key) => key in item);
}

function artifactArgument(value: unknown): string {
  const item = record(value);
  if (!item || !exact(item, ["artifactId"]) || typeof item.artifactId !== "string" || !item.artifactId) {
    throw new ChildEvidenceBridgeError(
      "invalid_request",
      "The child evidence tool accepts only one granted artifactId; paths and excerpt controls are unavailable.",
    );
  }
  return item.artifactId;
}

function receiptIdentitiesMatch(receipt: EvidenceReadReceipt, receiptContentId: string): boolean {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return (
    receipt.receiptId === `evidence-read:${canonicalSha256(body)}` &&
    receiptContentId === canonicalJsonContentId(receipt)
  );
}

/** Injects task, agent, and operation identity before delegating to the authoritative read host. */
export class BoundedChildEvidenceBridge {
  private readonly task: TaskRecord;
  private readonly host: ChildEvidenceReadHost;
  private readonly nextOperationId: () => string;

  constructor(
    task: TaskRecord,
    host: ChildEvidenceReadHost | BoundedEvidenceReadHost,
    options: { nextOperationId?: () => string } = {},
  ) {
    this.task = structuredClone(task);
    this.host = host;
    this.nextOperationId = options.nextOperationId ?? (() => `operation:child:evidence-read:${randomUUID()}`);
  }

  manifest(): ChildEvidenceToolManifest {
    const grant = this.task.grants.find((candidate) => candidate.capability === "evidence.read");
    if (!grant || grant.evidenceScope.length === 0) {
      throw new ChildEvidenceBridgeError("capability_not_granted", "The child task has no evidence.read grant.");
    }
    return {
      schema: "studio.child-evidence-tools.v1",
      taskId: this.task.id,
      agentId: this.task.assignedAgentId,
      tool: {
        name: CHILD_EVIDENCE_TOOL_NAME,
        capability: "evidence.read",
        evidenceScope: structuredClone(grant.evidenceScope),
      },
    };
  }

  async call(value: unknown): Promise<ChildEvidenceToolResult> {
    const artifactId = artifactArgument(value);
    const manifest = this.manifest();
    if (!manifest.tool.evidenceScope.some((scope) => scope.artifactId === artifactId)) {
      throw new ChildEvidenceBridgeError("capability_not_granted", "The artifact is outside the child evidence grant.");
    }
    const operationId = this.nextOperationId();
    try {
      const result = await this.host.read({
        operationId,
        taskId: this.task.id,
        agentId: this.task.assignedAgentId,
        artifactId,
      });
      validateEvidenceReadReceipt(result.receipt, "Child evidence bridge receipt", "receipt");
      if (
        result.receipt.operationId !== operationId ||
        result.receipt.authorization.taskId !== this.task.id ||
        result.receipt.authorization.agentId !== this.task.assignedAgentId ||
        result.receipt.input.artifactId !== artifactId ||
        !receiptIdentitiesMatch(result.receipt, result.receiptContentId)
      ) {
        throw new ChildEvidenceBridgeError(
          "operation_rejected",
          "The evidence host returned a receipt outside the child bridge request.",
        );
      }
      return {
        schema: "studio.child-evidence-tool-result.v1",
        capability: "evidence.read",
        operationId,
        inputArtifactId: artifactId,
        receiptId: result.receipt.receiptId,
        receiptContentId: result.receiptContentId,
        receipt: result.receipt,
      };
    } catch (error) {
      if (error instanceof ChildEvidenceBridgeError) throw error;
      throw new ChildEvidenceBridgeError(
        "operation_rejected",
        "The evidence host rejected or failed the bounded child request.",
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

async function requestBody(request: IncomingMessage, maximumBytes = 4 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    bytes += chunk.length;
    if (bytes > maximumBytes) {
      throw new ChildEvidenceBridgeError("invalid_request", "The child evidence bridge request is too large.");
    }
    chunks.push(chunk);
  }
  if (bytes === 0) throw new ChildEvidenceBridgeError("invalid_request", "The child evidence bridge request is empty.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ChildEvidenceBridgeError("invalid_request", "The child evidence bridge request is not valid JSON.");
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

export interface OpenChildEvidenceBridge {
  endpoint: string;
  token: string;
  manifest: ChildEvidenceToolManifest;
  close(): Promise<void>;
}

export async function openChildEvidenceBridge(
  bridge: BoundedChildEvidenceBridge,
): Promise<OpenChildEvidenceBridge> {
  const token = randomBytes(32).toString("hex");
  const manifest = bridge.manifest();
  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers.authorization !== `Bearer ${token}`) {
        json(response, 401, { ok: false, error: { code: "bridge_unavailable", message: "The child evidence bridge credential is invalid." } });
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/v1/manifest" && url.search === "") {
        json(response, 200, { ok: true, manifest });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/call" && url.search === "") {
        const body = record(await requestBody(request));
        if (!body || !exact(body, ["name", "arguments"]) || body.name !== CHILD_EVIDENCE_TOOL_NAME) {
          throw new ChildEvidenceBridgeError("invalid_request", "The child evidence bridge call shape is invalid.");
        }
        json(response, 200, { ok: true, result: await bridge.call(body.arguments) });
        return;
      }
      json(response, 404, { ok: false, error: { code: "bridge_unavailable", message: "The child evidence bridge endpoint is unavailable." } });
    })().catch((error: unknown) => {
      const safe = error instanceof ChildEvidenceBridgeError
        ? error
        : new ChildEvidenceBridgeError("bridge_unavailable", "The child evidence bridge failed closed.");
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
    throw new Error("The child evidence bridge did not bind a loopback port");
  }
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    token,
    manifest,
    close: () => closeServer(server),
  };
}

function endpointOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password ||
    (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash
  ) {
    throw new ChildEvidenceBridgeError("bridge_unavailable", "The child evidence bridge endpoint is not exact loopback HTTP.");
  }
  return url.origin;
}

async function remoteJson(endpoint: string, token: string, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${endpointOrigin(endpoint)}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ChildEvidenceBridgeError("bridge_unavailable", "The child evidence bridge could not be reached.");
  }
  const value = await response.json().catch(() => null);
  const item = record(value);
  if (!item || typeof item.ok !== "boolean") {
    throw new ChildEvidenceBridgeError("bridge_unavailable", "The child evidence bridge returned an open response.");
  }
  if (!response.ok || item.ok !== true) {
    const failure = record(item.error);
    const code = failure?.code;
    throw new ChildEvidenceBridgeError(
      code === "invalid_request" || code === "capability_not_granted" || code === "operation_rejected"
        ? code
        : "bridge_unavailable",
      typeof failure?.message === "string" ? failure.message : "The child evidence bridge rejected the request.",
    );
  }
  return item;
}

function validateManifest(value: unknown): ChildEvidenceToolManifest {
  const manifest = record(value);
  const tool = record(manifest?.tool);
  if (
    !manifest || !exact(manifest, ["schema", "taskId", "agentId", "tool"]) ||
    manifest.schema !== "studio.child-evidence-tools.v1" ||
    typeof manifest.taskId !== "string" || typeof manifest.agentId !== "string" ||
    !tool || !exact(tool, ["name", "capability", "evidenceScope"]) ||
    tool.name !== CHILD_EVIDENCE_TOOL_NAME || tool.capability !== "evidence.read" ||
    !Array.isArray(tool.evidenceScope) || tool.evidenceScope.length === 0
  ) {
    throw new ChildEvidenceBridgeError("bridge_unavailable", "The child evidence bridge manifest failed validation.");
  }
  for (const candidate of tool.evidenceScope) {
    const scope = record(candidate);
    if (
      !scope || !exact(scope, ["artifactId", "evidenceKind", "maxBytes", "maxItems"]) ||
      typeof scope.artifactId !== "string" || !scope.artifactId ||
      (scope.evidenceKind !== "speech_activity" && scope.evidenceKind !== "language_ranges") ||
      !Number.isSafeInteger(scope.maxBytes) || (scope.maxBytes as number) <= 0 ||
      (scope.maxBytes as number) > MAX_EVIDENCE_READ_BYTES ||
      !Number.isSafeInteger(scope.maxItems) || (scope.maxItems as number) <= 0 ||
      (scope.maxItems as number) > MAX_EVIDENCE_READ_ITEMS
    ) {
      throw new ChildEvidenceBridgeError("bridge_unavailable", "The child evidence scope failed validation.");
    }
  }
  return manifest as unknown as ChildEvidenceToolManifest;
}

export async function fetchChildEvidenceManifest(endpoint: string, token: string): Promise<ChildEvidenceToolManifest> {
  const item = await remoteJson(endpoint, token, "/v1/manifest");
  return validateManifest(item.manifest);
}

export async function callChildEvidenceBridge(
  endpoint: string,
  token: string,
  artifactId: string,
): Promise<ChildEvidenceToolResult> {
  const item = await remoteJson(endpoint, token, "/v1/call", {
    method: "POST",
    body: JSON.stringify({ name: CHILD_EVIDENCE_TOOL_NAME, arguments: { artifactId } }),
  });
  const result = record(item.result);
  if (
    !result || !exact(result, ["schema", "capability", "operationId", "inputArtifactId", "receiptId", "receiptContentId", "receipt"]) ||
    result.schema !== "studio.child-evidence-tool-result.v1" || result.capability !== "evidence.read" ||
    typeof result.operationId !== "string" || result.inputArtifactId !== artifactId ||
    typeof result.receiptId !== "string" || typeof result.receiptContentId !== "string"
  ) {
    throw new ChildEvidenceBridgeError("bridge_unavailable", "The child evidence bridge result failed validation.");
  }
  try {
    validateEvidenceReadReceipt(result.receipt, "Child evidence bridge result", "result.receipt");
  } catch {
    throw new ChildEvidenceBridgeError("bridge_unavailable", "The child evidence bridge receipt failed validation.");
  }
  const receipt = result.receipt as EvidenceReadReceipt;
  if (
    receipt.operationId !== result.operationId ||
    receipt.receiptId !== result.receiptId ||
    !receiptIdentitiesMatch(receipt, result.receiptContentId as string)
  ) {
    throw new ChildEvidenceBridgeError("bridge_unavailable", "The child evidence bridge result identities do not agree.");
  }
  return result as unknown as ChildEvidenceToolResult;
}
