import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { canonicalJsonContentId, canonicalSha256 } from "../artifactStore.ts";
import type {
  AuditedEvidenceAssessmentIdentity,
  EvidenceDecisionReceipt,
  EvidenceDecisionScope,
  TaskRecord,
} from "../model.ts";
import type {
  BoundedEvidenceDecisionHost,
  EvidenceDecisionHostResult,
} from "../evidenceDecisionHost.ts";
import {
  assertEvidenceDecisionRequest,
  validateEvidenceDecisionReceipt,
} from "../validation/decision.ts";
import {
  MAX_EVIDENCE_DECISIONS,
  MAX_EVIDENCE_DECISION_AUDITED_ASSESSMENTS,
} from "../validation/scheduling.ts";

export const CHILD_EVIDENCE_DECISION_TOOL_NAME = "evidence_decide" as const;

export interface ChildEvidenceDecisionToolManifest {
  schema: "studio.child-evidence-decision-tools.v1";
  taskId: string;
  agentId: string;
  tool: {
    name: typeof CHILD_EVIDENCE_DECISION_TOOL_NAME;
    capability: "analysis.evidence.decide";
    decisionScope: EvidenceDecisionScope;
  };
}

export interface ChildEvidenceDecisionToolResult {
  schema: "studio.child-evidence-decision-tool-result.v1";
  capability: "analysis.evidence.decide";
  operationId: string;
  outputArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  receipt: EvidenceDecisionReceipt;
}

type ErrorCode = "invalid_request" | "capability_not_granted" | "operation_rejected" | "bridge_unavailable";

export class ChildEvidenceDecisionBridgeError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ChildEvidenceDecisionBridgeError";
    this.code = code;
  }
}

export interface ChildEvidenceDecisionHost {
  decide(request: unknown): Promise<EvidenceDecisionHostResult>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(item: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(item).length === keys.length && keys.every((key) => key in item);
}

function decisionArguments(value: unknown): { auditedAssessments: AuditedEvidenceAssessmentIdentity[] } {
  const item = record(value);
  if (!item || !exact(item, ["auditedAssessments"])) {
    throw new ChildEvidenceDecisionBridgeError(
      "invalid_request",
      "The child decision tool accepts only audited assessment operation, artifact, receipt, and content identities; paths, raw bytes, prose, outcomes, and publication controls are unavailable.",
    );
  }
  return { auditedAssessments: item.auditedAssessments as AuditedEvidenceAssessmentIdentity[] };
}

function receiptIdentitiesMatch(receipt: EvidenceDecisionReceipt, receiptContentId: string): boolean {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return receipt.receiptId === `evidence-decision:${canonicalSha256(body)}` &&
    receiptContentId === canonicalJsonContentId(receipt);
}

/** Injects task, agent, and operation identity before delegating to the authoritative decision host. */
export class BoundedChildEvidenceDecisionBridge {
  private readonly task: TaskRecord;
  private readonly host: ChildEvidenceDecisionHost;
  private readonly nextOperationId: () => string;

  constructor(
    task: TaskRecord,
    host: ChildEvidenceDecisionHost | BoundedEvidenceDecisionHost,
    options: { nextOperationId?: () => string } = {},
  ) {
    this.task = structuredClone(task);
    this.host = host;
    this.nextOperationId = options.nextOperationId ?? (() => `operation:child:evidence-decide:${randomUUID()}`);
  }

  manifest(): ChildEvidenceDecisionToolManifest {
    const grant = this.task.grants.find((candidate) => candidate.capability === "analysis.evidence.decide");
    if (!grant?.decisionScope) {
      throw new ChildEvidenceDecisionBridgeError(
        "capability_not_granted",
        "The child task has no analysis.evidence.decide grant.",
      );
    }
    return {
      schema: "studio.child-evidence-decision-tools.v1",
      taskId: this.task.id,
      agentId: this.task.assignedAgentId,
      tool: {
        name: CHILD_EVIDENCE_DECISION_TOOL_NAME,
        capability: "analysis.evidence.decide",
        decisionScope: structuredClone(grant.decisionScope),
      },
    };
  }

  async call(value: unknown): Promise<ChildEvidenceDecisionToolResult> {
    const args = decisionArguments(value);
    this.manifest();
    const operationId = this.nextOperationId();
    const request = {
      operationId,
      taskId: this.task.id,
      agentId: this.task.assignedAgentId,
      auditedAssessments: args.auditedAssessments,
    };
    try {
      assertEvidenceDecisionRequest(request, "Child evidence decision bridge request");
      const result = await this.host.decide(request);
      validateEvidenceDecisionReceipt(result.receipt, "Child evidence decision bridge receipt", "receipt");
      if (
        result.receipt.operationId !== operationId ||
        result.receipt.authorization.taskId !== this.task.id ||
        result.receipt.authorization.agentId !== this.task.assignedAgentId ||
        !receiptIdentitiesMatch(result.receipt, result.receiptContentId)
      ) {
        throw new ChildEvidenceDecisionBridgeError(
          "operation_rejected",
          "The decision host returned a receipt outside the child bridge request.",
        );
      }
      return {
        schema: "studio.child-evidence-decision-tool-result.v1",
        capability: "analysis.evidence.decide",
        operationId,
        outputArtifactId: result.outputArtifactId,
        receiptId: result.receipt.receiptId,
        receiptContentId: result.receiptContentId,
        receipt: result.receipt,
      };
    } catch (error) {
      if (error instanceof ChildEvidenceDecisionBridgeError) throw error;
      throw new ChildEvidenceDecisionBridgeError(
        "operation_rejected",
        "The decision host rejected or failed the bounded child request.",
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

async function requestBody(request: IncomingMessage, maximumBytes = 32 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    bytes += chunk.length;
    if (bytes > maximumBytes) {
      throw new ChildEvidenceDecisionBridgeError("invalid_request", "The child decision bridge request is too large.");
    }
    chunks.push(chunk);
  }
  if (bytes === 0) throw new ChildEvidenceDecisionBridgeError("invalid_request", "The child decision bridge request is empty.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ChildEvidenceDecisionBridgeError("invalid_request", "The child decision bridge request is not valid JSON.");
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

export interface OpenChildEvidenceDecisionBridge {
  endpoint: string;
  token: string;
  manifest: ChildEvidenceDecisionToolManifest;
  close(): Promise<void>;
}

export async function openChildEvidenceDecisionBridge(
  bridge: BoundedChildEvidenceDecisionBridge,
): Promise<OpenChildEvidenceDecisionBridge> {
  const token = randomBytes(32).toString("hex");
  const manifest = bridge.manifest();
  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers.authorization !== `Bearer ${token}`) {
        json(response, 401, { ok: false, error: { code: "bridge_unavailable", message: "The child decision bridge credential is invalid." } });
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/v1/manifest" && url.search === "") {
        json(response, 200, { ok: true, manifest });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/call" && url.search === "") {
        const body = record(await requestBody(request));
        if (!body || !exact(body, ["name", "arguments"]) || body.name !== CHILD_EVIDENCE_DECISION_TOOL_NAME) {
          throw new ChildEvidenceDecisionBridgeError("invalid_request", "The child decision bridge call shape is invalid.");
        }
        json(response, 200, { ok: true, result: await bridge.call(body.arguments) });
        return;
      }
      json(response, 404, { ok: false, error: { code: "bridge_unavailable", message: "The child decision bridge endpoint is unavailable." } });
    })().catch((error: unknown) => {
      const safe = error instanceof ChildEvidenceDecisionBridgeError
        ? error
        : new ChildEvidenceDecisionBridgeError("bridge_unavailable", "The child decision bridge failed closed.");
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
    throw new Error("The child decision bridge did not bind a loopback port");
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
  ) throw new ChildEvidenceDecisionBridgeError("bridge_unavailable", "The child decision bridge endpoint is not exact loopback HTTP.");
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
    throw new ChildEvidenceDecisionBridgeError("bridge_unavailable", "The child decision bridge could not be reached.");
  }
  const value = await response.json().catch(() => null);
  const item = record(value);
  if (!item || typeof item.ok !== "boolean") {
    throw new ChildEvidenceDecisionBridgeError("bridge_unavailable", "The child decision bridge returned an open response.");
  }
  if (!response.ok || item.ok !== true) {
    const failure = record(item.error);
    const code = failure?.code;
    throw new ChildEvidenceDecisionBridgeError(
      code === "invalid_request" || code === "capability_not_granted" || code === "operation_rejected"
        ? code
        : "bridge_unavailable",
      typeof failure?.message === "string" ? failure.message : "The child decision bridge rejected the request.",
    );
  }
  return item;
}

function validateManifest(value: unknown): ChildEvidenceDecisionToolManifest {
  const manifest = record(value);
  const tool = record(manifest?.tool);
  const scope = record(tool?.decisionScope);
  if (
    !manifest || !exact(manifest, ["schema", "taskId", "agentId", "tool"]) ||
    manifest.schema !== "studio.child-evidence-decision-tools.v1" ||
    typeof manifest.taskId !== "string" || typeof manifest.agentId !== "string" ||
    !tool || !exact(tool, ["name", "capability", "decisionScope"]) ||
    tool.name !== CHILD_EVIDENCE_DECISION_TOOL_NAME || tool.capability !== "analysis.evidence.decide" ||
    !scope || !exact(scope, ["maxDecisions", "maxAuditedAssessments"]) ||
    !Number.isSafeInteger(scope.maxDecisions) || (scope.maxDecisions as number) < 1 ||
    (scope.maxDecisions as number) > MAX_EVIDENCE_DECISIONS ||
    !Number.isSafeInteger(scope.maxAuditedAssessments) || (scope.maxAuditedAssessments as number) < 1 ||
    (scope.maxAuditedAssessments as number) > MAX_EVIDENCE_DECISION_AUDITED_ASSESSMENTS
  ) throw new ChildEvidenceDecisionBridgeError("bridge_unavailable", "The child decision bridge manifest failed validation.");
  return manifest as unknown as ChildEvidenceDecisionToolManifest;
}

export async function fetchChildEvidenceDecisionManifest(
  endpoint: string,
  token: string,
): Promise<ChildEvidenceDecisionToolManifest> {
  const item = await remoteJson(endpoint, token, "/v1/manifest");
  return validateManifest(item.manifest);
}

export async function callChildEvidenceDecisionBridge(
  endpoint: string,
  token: string,
  args: { auditedAssessments: AuditedEvidenceAssessmentIdentity[] },
): Promise<ChildEvidenceDecisionToolResult> {
  const item = await remoteJson(endpoint, token, "/v1/call", {
    method: "POST",
    body: JSON.stringify({ name: CHILD_EVIDENCE_DECISION_TOOL_NAME, arguments: args }),
  });
  const result = record(item.result);
  if (
    !result || !exact(result, ["schema", "capability", "operationId", "outputArtifactId", "receiptId", "receiptContentId", "receipt"]) ||
    result.schema !== "studio.child-evidence-decision-tool-result.v1" ||
    result.capability !== "analysis.evidence.decide" ||
    typeof result.operationId !== "string" || typeof result.outputArtifactId !== "string" ||
    typeof result.receiptId !== "string" || typeof result.receiptContentId !== "string"
  ) throw new ChildEvidenceDecisionBridgeError("bridge_unavailable", "The child decision bridge result failed validation.");
  try {
    validateEvidenceDecisionReceipt(result.receipt, "Child decision bridge result", "result.receipt");
  } catch {
    throw new ChildEvidenceDecisionBridgeError("bridge_unavailable", "The child decision bridge receipt failed validation.");
  }
  const receipt = result.receipt as EvidenceDecisionReceipt;
  if (
    receipt.operationId !== result.operationId ||
    receipt.receiptId !== result.receiptId ||
    !receiptIdentitiesMatch(receipt, result.receiptContentId as string)
  ) throw new ChildEvidenceDecisionBridgeError("bridge_unavailable", "The child decision bridge result identities do not agree.");
  return result as unknown as ChildEvidenceDecisionToolResult;
}
