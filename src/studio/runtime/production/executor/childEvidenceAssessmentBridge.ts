import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { canonicalJsonContentId, canonicalSha256 } from "../artifactStore.ts";
import type {
  EvidenceAssessmentClaim,
  EvidenceAssessmentReceipt,
  EvidenceAssessmentScope,
  EvidenceReadReceiptIdentity,
  TaskRecord,
} from "../model.ts";
import type {
  BoundedEvidenceAssessmentHost,
  EvidenceAssessmentHostResult,
} from "../evidenceAssessmentHost.ts";
import {
  assertEvidenceAssessmentRequest,
  validateEvidenceAssessmentReceipt,
} from "../validation/assessment.ts";
import {
  MAX_EVIDENCE_ASSESSMENTS,
  MAX_EVIDENCE_ASSESS_CITATIONS,
  MAX_EVIDENCE_ASSESS_CLAIMS,
  MAX_EVIDENCE_ASSESS_READ_RECEIPTS,
  MAX_EVIDENCE_ASSESS_TOKENS,
} from "../validation/scheduling.ts";

export const CHILD_EVIDENCE_ASSESSMENT_TOOL_NAME = "evidence_assess" as const;

export interface ChildEvidenceAssessmentToolManifest {
  schema: "studio.child-evidence-assessment-tools.v1";
  taskId: string;
  agentId: string;
  tool: {
    name: typeof CHILD_EVIDENCE_ASSESSMENT_TOOL_NAME;
    capability: "analysis.evidence.assess";
    assessmentScope: EvidenceAssessmentScope;
  };
}

export interface ChildEvidenceAssessmentToolResult {
  schema: "studio.child-evidence-assessment-tool-result.v1";
  capability: "analysis.evidence.assess";
  operationId: string;
  outputArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  receipt: EvidenceAssessmentReceipt;
}

type ErrorCode = "invalid_request" | "capability_not_granted" | "operation_rejected" | "bridge_unavailable";

export class ChildEvidenceAssessmentBridgeError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ChildEvidenceAssessmentBridgeError";
    this.code = code;
  }
}

export interface ChildEvidenceAssessmentHost {
  assess(request: unknown): Promise<EvidenceAssessmentHostResult>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(item: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(item).length === keys.length && keys.every((key) => key in item);
}

function assessmentArguments(value: unknown): {
  readReceipts: EvidenceReadReceiptIdentity[];
  claims: EvidenceAssessmentClaim[];
} {
  const item = record(value);
  if (!item || !exact(item, ["readReceipts", "claims"])) {
    throw new ChildEvidenceAssessmentBridgeError(
      "invalid_request",
      "The child assessment tool accepts only completed read-receipt identities and closed range-bound claims; paths and open controls are unavailable.",
    );
  }
  return {
    readReceipts: item.readReceipts as EvidenceReadReceiptIdentity[],
    claims: item.claims as EvidenceAssessmentClaim[],
  };
}

function receiptIdentitiesMatch(receipt: EvidenceAssessmentReceipt, receiptContentId: string): boolean {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return (
    receipt.receiptId === `evidence-assessment:${canonicalSha256(body)}` &&
    receiptContentId === canonicalJsonContentId(receipt)
  );
}

/** Injects task, agent, and operation identity before delegating to the authoritative assessment host. */
export class BoundedChildEvidenceAssessmentBridge {
  private readonly task: TaskRecord;
  private readonly host: ChildEvidenceAssessmentHost;
  private readonly nextOperationId: () => string;

  constructor(
    task: TaskRecord,
    host: ChildEvidenceAssessmentHost | BoundedEvidenceAssessmentHost,
    options: { nextOperationId?: () => string } = {},
  ) {
    this.task = structuredClone(task);
    this.host = host;
    this.nextOperationId = options.nextOperationId ?? (() => `operation:child:evidence-assess:${randomUUID()}`);
  }

  manifest(): ChildEvidenceAssessmentToolManifest {
    const grant = this.task.grants.find((candidate) => candidate.capability === "analysis.evidence.assess");
    if (!grant?.assessmentScope) {
      throw new ChildEvidenceAssessmentBridgeError(
        "capability_not_granted",
        "The child task has no analysis.evidence.assess grant.",
      );
    }
    return {
      schema: "studio.child-evidence-assessment-tools.v1",
      taskId: this.task.id,
      agentId: this.task.assignedAgentId,
      tool: {
        name: CHILD_EVIDENCE_ASSESSMENT_TOOL_NAME,
        capability: "analysis.evidence.assess",
        assessmentScope: structuredClone(grant.assessmentScope),
      },
    };
  }

  async call(value: unknown): Promise<ChildEvidenceAssessmentToolResult> {
    const args = assessmentArguments(value);
    this.manifest();
    const operationId = this.nextOperationId();
    const request = {
      operationId,
      taskId: this.task.id,
      agentId: this.task.assignedAgentId,
      readReceipts: args.readReceipts,
      claims: args.claims,
    };
    try {
      assertEvidenceAssessmentRequest(request, "Child evidence assessment bridge request");
      const result = await this.host.assess(request);
      validateEvidenceAssessmentReceipt(result.receipt, "Child evidence assessment bridge receipt", "receipt");
      if (
        result.receipt.operationId !== operationId ||
        result.receipt.authorization.taskId !== this.task.id ||
        result.receipt.authorization.agentId !== this.task.assignedAgentId ||
        !receiptIdentitiesMatch(result.receipt, result.receiptContentId)
      ) {
        throw new ChildEvidenceAssessmentBridgeError(
          "operation_rejected",
          "The assessment host returned a receipt outside the child bridge request.",
        );
      }
      return {
        schema: "studio.child-evidence-assessment-tool-result.v1",
        capability: "analysis.evidence.assess",
        operationId,
        outputArtifactId: result.outputArtifactId,
        receiptId: result.receipt.receiptId,
        receiptContentId: result.receiptContentId,
        receipt: result.receipt,
      };
    } catch (error) {
      if (error instanceof ChildEvidenceAssessmentBridgeError) throw error;
      throw new ChildEvidenceAssessmentBridgeError(
        "operation_rejected",
        "The assessment host rejected or failed the bounded child request.",
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

async function requestBody(request: IncomingMessage, maximumBytes = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    bytes += chunk.length;
    if (bytes > maximumBytes) {
      throw new ChildEvidenceAssessmentBridgeError("invalid_request", "The child assessment bridge request is too large.");
    }
    chunks.push(chunk);
  }
  if (bytes === 0) throw new ChildEvidenceAssessmentBridgeError("invalid_request", "The child assessment bridge request is empty.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ChildEvidenceAssessmentBridgeError("invalid_request", "The child assessment bridge request is not valid JSON.");
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

export interface OpenChildEvidenceAssessmentBridge {
  endpoint: string;
  token: string;
  manifest: ChildEvidenceAssessmentToolManifest;
  close(): Promise<void>;
}

export async function openChildEvidenceAssessmentBridge(
  bridge: BoundedChildEvidenceAssessmentBridge,
): Promise<OpenChildEvidenceAssessmentBridge> {
  const token = randomBytes(32).toString("hex");
  const manifest = bridge.manifest();
  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers.authorization !== `Bearer ${token}`) {
        json(response, 401, { ok: false, error: { code: "bridge_unavailable", message: "The child assessment bridge credential is invalid." } });
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/v1/manifest" && url.search === "") {
        json(response, 200, { ok: true, manifest });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/call" && url.search === "") {
        const body = record(await requestBody(request));
        if (!body || !exact(body, ["name", "arguments"]) || body.name !== CHILD_EVIDENCE_ASSESSMENT_TOOL_NAME) {
          throw new ChildEvidenceAssessmentBridgeError("invalid_request", "The child assessment bridge call shape is invalid.");
        }
        json(response, 200, { ok: true, result: await bridge.call(body.arguments) });
        return;
      }
      json(response, 404, { ok: false, error: { code: "bridge_unavailable", message: "The child assessment bridge endpoint is unavailable." } });
    })().catch((error: unknown) => {
      const safe = error instanceof ChildEvidenceAssessmentBridgeError
        ? error
        : new ChildEvidenceAssessmentBridgeError("bridge_unavailable", "The child assessment bridge failed closed.");
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
    throw new Error("The child assessment bridge did not bind a loopback port");
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
    throw new ChildEvidenceAssessmentBridgeError("bridge_unavailable", "The child assessment bridge endpoint is not exact loopback HTTP.");
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
    throw new ChildEvidenceAssessmentBridgeError("bridge_unavailable", "The child assessment bridge could not be reached.");
  }
  const value = await response.json().catch(() => null);
  const item = record(value);
  if (!item || typeof item.ok !== "boolean") {
    throw new ChildEvidenceAssessmentBridgeError("bridge_unavailable", "The child assessment bridge returned an open response.");
  }
  if (!response.ok || item.ok !== true) {
    const failure = record(item.error);
    const code = failure?.code;
    throw new ChildEvidenceAssessmentBridgeError(
      code === "invalid_request" || code === "capability_not_granted" || code === "operation_rejected"
        ? code
        : "bridge_unavailable",
      typeof failure?.message === "string" ? failure.message : "The child assessment bridge rejected the request.",
    );
  }
  return item;
}

function validateManifest(value: unknown): ChildEvidenceAssessmentToolManifest {
  const manifest = record(value);
  const tool = record(manifest?.tool);
  const scope = record(tool?.assessmentScope);
  if (
    !manifest || !exact(manifest, ["schema", "taskId", "agentId", "tool"]) ||
    manifest.schema !== "studio.child-evidence-assessment-tools.v1" ||
    typeof manifest.taskId !== "string" || typeof manifest.agentId !== "string" ||
    !tool || !exact(tool, ["name", "capability", "assessmentScope"]) ||
    tool.name !== CHILD_EVIDENCE_ASSESSMENT_TOOL_NAME || tool.capability !== "analysis.evidence.assess" ||
    !scope || !exact(scope, ["evidenceArtifactIds", "maxAssessments", "maxReadReceipts", "maxClaims", "maxCitations", "maxTokens"]) ||
    !Array.isArray(scope.evidenceArtifactIds) || scope.evidenceArtifactIds.length === 0 ||
    scope.evidenceArtifactIds.some((id) => typeof id !== "string" || !id) ||
    new Set(scope.evidenceArtifactIds).size !== scope.evidenceArtifactIds.length ||
    !Number.isSafeInteger(scope.maxAssessments) || (scope.maxAssessments as number) < 1 || (scope.maxAssessments as number) > MAX_EVIDENCE_ASSESSMENTS ||
    !Number.isSafeInteger(scope.maxReadReceipts) || (scope.maxReadReceipts as number) < 1 || (scope.maxReadReceipts as number) > MAX_EVIDENCE_ASSESS_READ_RECEIPTS ||
    !Number.isSafeInteger(scope.maxClaims) || (scope.maxClaims as number) < 1 || (scope.maxClaims as number) > MAX_EVIDENCE_ASSESS_CLAIMS ||
    !Number.isSafeInteger(scope.maxCitations) || (scope.maxCitations as number) < 1 || (scope.maxCitations as number) > MAX_EVIDENCE_ASSESS_CITATIONS ||
    !Number.isSafeInteger(scope.maxTokens) || (scope.maxTokens as number) < 1 || (scope.maxTokens as number) > MAX_EVIDENCE_ASSESS_TOKENS
  ) throw new ChildEvidenceAssessmentBridgeError("bridge_unavailable", "The child assessment bridge manifest failed validation.");
  return manifest as unknown as ChildEvidenceAssessmentToolManifest;
}

export async function fetchChildEvidenceAssessmentManifest(
  endpoint: string,
  token: string,
): Promise<ChildEvidenceAssessmentToolManifest> {
  const item = await remoteJson(endpoint, token, "/v1/manifest");
  return validateManifest(item.manifest);
}

export async function callChildEvidenceAssessmentBridge(
  endpoint: string,
  token: string,
  args: { readReceipts: EvidenceReadReceiptIdentity[]; claims: EvidenceAssessmentClaim[] },
): Promise<ChildEvidenceAssessmentToolResult> {
  const item = await remoteJson(endpoint, token, "/v1/call", {
    method: "POST",
    body: JSON.stringify({ name: CHILD_EVIDENCE_ASSESSMENT_TOOL_NAME, arguments: args }),
  });
  const result = record(item.result);
  if (
    !result || !exact(result, ["schema", "capability", "operationId", "outputArtifactId", "receiptId", "receiptContentId", "receipt"]) ||
    result.schema !== "studio.child-evidence-assessment-tool-result.v1" ||
    result.capability !== "analysis.evidence.assess" ||
    typeof result.operationId !== "string" || typeof result.outputArtifactId !== "string" ||
    typeof result.receiptId !== "string" || typeof result.receiptContentId !== "string"
  ) throw new ChildEvidenceAssessmentBridgeError("bridge_unavailable", "The child assessment bridge result failed validation.");
  try {
    validateEvidenceAssessmentReceipt(result.receipt, "Child assessment bridge result", "result.receipt");
  } catch {
    throw new ChildEvidenceAssessmentBridgeError("bridge_unavailable", "The child assessment bridge receipt failed validation.");
  }
  const receipt = result.receipt as EvidenceAssessmentReceipt;
  if (
    receipt.operationId !== result.operationId ||
    receipt.receiptId !== result.receiptId ||
    !receiptIdentitiesMatch(receipt, result.receiptContentId as string)
  ) throw new ChildEvidenceAssessmentBridgeError("bridge_unavailable", "The child assessment bridge result identities do not agree.");
  return result as unknown as ChildEvidenceAssessmentToolResult;
}
